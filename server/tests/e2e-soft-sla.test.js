import { AssessorDayLock } from "../src/models/assessor-day-lock.model.js";
import { Batch } from "../src/models/batch.model.js";
import { markOverdueSlaBreaches } from "../src/modules/batches/sla-breach-job.js";
import {
  auditRows,
  bootE2e,
  createBatch,
  expectError,
  expectStatus,
  get,
  makeAssessor,
  makeWorld,
  post,
  prepareBatch,
  put,
  resetE2e,
  sessionFor,
  shutdownE2e,
  withFrozenDate,
} from "./helpers/e2e.js";

/**
 * T-01 flow 3. Soft SLA: after a due instant `aa_admin` may still accept, assign or submit
 * when a `lateReason` is sent. The step is recorded in `sla.breached`, `sla.lateActions` and the
 * audit trail. Without a reason the call fails with the SLA_* code and nothing changes.
 * docs/SCHEMA.md §2.2; API_CONTRACT.md error catalog; DECISIONS.md A-01 and A-03.
 */
const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

function makeDuePast(batchId, field) {
  return Batch.updateOne({ _id: batchId }, { $set: { [`sla.${field}`]: LONG_AGO } });
}

describe("e2e: soft SLA", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  describe("accept and reject", () => {
    it("needs a lateReason after acceptDueAt, then records the breach", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world);
      await makeDuePast(batch.id, "acceptDueAt");

      // Reads recompute the breach; nothing is stored until a late action or the nightly job.
      const read = expectStatus(await get(world.admin.token, `/batches/${batch.id}`), 200);
      expect(read.sla.breached).toContain("accept");
      expect((await Batch.findById(batch.id).lean()).sla.breached).toEqual([]);

      const refused = await post(world.admin.token, `/batches/${batch.id}/accept`, {});
      expectError(refused, 409, "SLA_ACCEPT_EXPIRED");
      expect(await Batch.findById(batch.id).lean()).toMatchObject({
        status: "allocated",
        statusVersion: 1,
      });
      // A blank reason is not a reason.
      expectError(
        await post(world.admin.token, `/batches/${batch.id}/accept`, { lateReason: "   " }),
        400,
        "VALIDATION_ERROR",
      );

      const accepted = expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/accept`, {
          lateReason: "AB confirmation delayed",
        }),
        200,
      );
      expect(accepted).toMatchObject({ status: "accepted", statusVersion: 2 });
      expect(accepted.sla.breached).toContain("accept");
      expect(accepted.sla.lateActions).toEqual([
        expect.objectContaining({
          key: "accept",
          reason: "AB confirmation delayed",
          byUserId: world.admin.userId,
        }),
      ]);
      const stored = await Batch.findById(batch.id).lean();
      expect(stored.sla.breached).toEqual(["accept"]);

      const audit = (await auditRows({ batchId: batch.id })).find(
        (row) => row.action === "sla_late_accept",
      );
      expect(audit).toBeTruthy();
      expect(audit.actorRole).toBe("aa_admin");
      expect(audit.meta).toMatchObject({ reason: "AB confirmation delayed", key: "accept" });
    });

    it("applies the same rule to a late reject, which is terminal", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world);
      await makeDuePast(batch.id, "acceptDueAt");
      expectError(
        await post(world.admin.token, `/batches/${batch.id}/reject`, { reason: "No capacity" }),
        409,
        "SLA_ACCEPT_EXPIRED",
      );
      const rejected = expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/reject`, {
          reason: "No capacity",
          lateReason: "AB mail reached us after the deadline",
        }),
        200,
      );
      expect(rejected).toMatchObject({ status: "rejected", rejectReason: "No capacity" });
      expect(rejected.sla.breached).toContain("accept");
      const audit = (await auditRows({ batchId: batch.id })).map((row) => row.action);
      expect(audit).toContain("sla_late_reject");
      expectError(
        await post(world.admin.token, `/batches/${batch.id}/accept`, { lateReason: "Too late" }),
        409,
        "INVALID_TRANSITION",
      );
    });

    it("records nothing when the action is on time, even if a lateReason is sent", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world);
      const accepted = expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/accept`, {
          lateReason: "Not needed",
        }),
        200,
      );
      expect(accepted.sla.breached).toEqual([]);
      expect(accepted.sla.lateActions).toEqual([]);
      const actions = (await auditRows({ batchId: batch.id })).map((row) => row.action);
      expect(actions).not.toContain("sla_late_accept");
    });

    it("treats the due instant itself as on time and the next millisecond as late", async () => {
      const world = await makeWorld();
      const due = new Date("2030-01-10T18:29:59.999Z");
      const onTime = await createBatch(world);
      const late = await createBatch(world);
      for (const batch of [onTime, late]) {
        await Batch.updateOne({ _id: batch.id }, { $set: { "sla.acceptDueAt": due } });
      }
      await withFrozenDate(due.toISOString(), async () => {
        const admin = await sessionFor("aa_admin", { email: "frozen1@aa.example" });
        const res = await post(admin.token, `/batches/${onTime.id}/accept`, {});
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // The assign step is also overdue at this fake date; only the accept step is under test.
        expect(res.body.sla.breached).not.toContain("accept");
        expect(res.body.sla.lateActions).toEqual([]);
      });
      await withFrozenDate(new Date(due.getTime() + 1).toISOString(), async () => {
        const admin = await sessionFor("aa_admin", { email: "frozen2@aa.example" });
        expectError(
          await post(admin.token, `/batches/${late.id}/accept`, {}),
          409,
          "SLA_ACCEPT_EXPIRED",
        );
      });
    });

    it("keeps a breach the nightly job stored and does not duplicate it on a late action", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world);
      await makeDuePast(batch.id, "acceptDueAt");
      const first = await markOverdueSlaBreaches(new Date());
      expect(first.accept).toBe(1);
      expect((await Batch.findById(batch.id).lean()).sla.breached).toEqual(["accept"]);
      // A second run adds nothing.
      expect((await markOverdueSlaBreaches(new Date())).accept).toBe(0);

      const accepted = expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/accept`, {
          lateReason: "Slow AB mail",
        }),
        200,
      );
      expect(accepted.sla.breached.filter((key) => key === "accept")).toHaveLength(1);
      expect((await Batch.findById(batch.id).lean()).sla.breached).toEqual(["accept"]);
      // The step is closed now, so a later job run leaves the stored key alone.
      await markOverdueSlaBreaches(new Date());
      expect((await Batch.findById(batch.id).lean()).sla.breached).toEqual(["accept"]);
    });
  });

  describe("assign and reassign", () => {
    for (const type of ["STT", "LTT"]) {
      it(`needs a lateReason after assignDueAt on a ${type} batch`, async () => {
        const world = await makeWorld();
        const { assessor } = await makeAssessor(world);
        const batch = await createBatch(world, { type });
        expectStatus(await post(world.admin.token, `/batches/${batch.id}/accept`), 200);
        await makeDuePast(batch.id, "assignDueAt");

        expectError(
          await post(world.admin.token, `/batches/${batch.id}/assign`, { assessorId: assessor.id }),
          409,
          "SLA_ASSIGN_EXPIRED",
        );
        // Nothing was written: still accepted, no assessor, no locks.
        expect(await Batch.findById(batch.id).lean()).toMatchObject({
          status: "accepted",
          statusVersion: 2,
          assessorId: null,
        });
        expect(await AssessorDayLock.countDocuments({})).toBe(0);

        const assigned = expectStatus(
          await post(world.admin.token, `/batches/${batch.id}/assign`, {
            assessorId: assessor.id,
            lateReason: "Assessor travel clearance delayed",
          }),
          200,
        );
        expect(assigned).toMatchObject({ status: "assessor_assigned", statusVersion: 3 });
        expect(assigned.sla.breached).toContain("assign");
        expect(assigned.sla.lateActions).toEqual([
          expect.objectContaining({ key: "assign", reason: "Assessor travel clearance delayed" }),
        ]);
        expect(await AssessorDayLock.countDocuments({ assessorId: assessor.id })).toBe(2);
        const audit = (await auditRows({ batchId: batch.id })).find(
          (row) => row.action === "sla_late_assign",
        );
        expect(audit.meta).toMatchObject({
          reason: "Assessor travel clearance delayed",
          key: "assign",
        });
      });
    }

    it("needs a lateReason to reassign once assignDueAt has passed", async () => {
      const world = await makeWorld();
      const first = await makeAssessor(world);
      const second = await makeAssessor(world);
      const batch = await createBatch(world);
      expectStatus(await post(world.admin.token, `/batches/${batch.id}/accept`), 200);
      expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/assign`, {
          assessorId: first.assessor.id,
        }),
        200,
      );
      await makeDuePast(batch.id, "assignDueAt");

      expectError(
        await post(world.admin.token, `/batches/${batch.id}/reassign`, {
          assessorId: second.assessor.id,
        }),
        409,
        "SLA_ASSIGN_EXPIRED",
      );
      expect((await Batch.findById(batch.id).lean()).assessorId.toString()).toBe(first.assessor.id);
      expect(await AssessorDayLock.countDocuments({ assessorId: first.assessor.id })).toBe(2);
      expect(await AssessorDayLock.countDocuments({ assessorId: second.assessor.id })).toBe(0);

      const reassigned = expectStatus(
        await post(world.admin.token, `/batches/${batch.id}/reassign`, {
          assessorId: second.assessor.id,
          lateReason: "Original assessor unavailable",
        }),
        200,
      );
      expect(reassigned.assessorId).toBe(second.assessor.id);
      expect(reassigned.sla.breached).toContain("assign");
      expect(await AssessorDayLock.countDocuments({ assessorId: first.assessor.id })).toBe(0);
      expect(await AssessorDayLock.countDocuments({ assessorId: second.assessor.id })).toBe(2);
    });
  });

  describe("submit result", () => {
    it("needs a lateReason after resultDueAt and logs it on the submit row", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "drafted" });
      await makeDuePast(ctx.batch.id, "resultDueAt");

      expectError(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {}),
        409,
        "SLA_RESULT_EXPIRED",
      );
      expect(await Batch.findById(ctx.batch.id).lean()).toMatchObject({
        status: "assessment_completed",
        statusVersion: 5,
      });
      expectError(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {
          lateReason: " ",
        }),
        400,
        "VALIDATION_ERROR",
      );

      const submitted = expectStatus(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {
          lateReason: "Marks verification with TP took an extra day",
        }),
        200,
      );
      expect(submitted).toMatchObject({ status: "submitted", batchStatus: "result_submitted" });
      const batch = expectStatus(await get(world.admin.token, `/batches/${ctx.batch.id}`), 200);
      expect(batch.sla.breached).toContain("result");
      expect(batch.sla.lateActions).toEqual([
        expect.objectContaining({
          key: "result",
          reason: "Marks verification with TP took an extra day",
        }),
      ]);
      const audit = (await auditRows({ batchId: ctx.batch.id })).find(
        (row) => row.action === "sla_late_submit",
      );
      expect(audit.meta).toMatchObject({
        reason: "Marks verification with TP took an extra day",
        key: "result",
      });
      const log = expectStatus(
        await get(world.admin.token, `/results/${submitted.id}/change-log`),
        200,
      );
      const submitRow = log.items.find((row) => row.action === "submit");
      expect(submitRow.reason).toBe("Marks verification with TP took an extra day");
    });

    it("reports an incomplete draft before the SLA, as the contract orders the checks", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "completed" });
      // One row only: the other two active candidates have no row.
      expectStatus(
        await put(world.admin.token, `/batches/${ctx.batch.id}/results`, {
          rows: [{ candidateId: ctx.roster[1].id, nos: [] }],
        }),
        200,
      );
      await makeDuePast(ctx.batch.id, "resultDueAt");
      const res = await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {});
      expectError(res, 409, "RESULT_INCOMPLETE");
      expect(res.body.error.details.missingCandidates.sort()).toEqual(
        [ctx.roster[0].id, ctx.roster[2].id].sort(),
      );
    });

    it("keeps the deadline when a returned result is sent again late", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "submitted" });
      await makeDuePast(ctx.batch.id, "resultDueAt");
      expectStatus(
        await post(world.reviewer.token, `/batches/${ctx.batch.id}/return-for-correction`, {
          reason: "NOS-02 theory marks do not match the marks sheet",
        }),
        200,
      );
      expectError(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {}),
        409,
        "SLA_RESULT_EXPIRED",
      );
      expectStatus(
        await post(world.admin.token, `/batches/${ctx.batch.id}/submit-result`, {
          lateReason: "Correction requested by the AB",
        }),
        200,
      );
    });
  });

  // SCHEMA §2.2 says `sla.breached` is recomputed for "open steps". The implementation treats the
  // result step as open only while the batch is `assessment_completed` (sla-breach-job.js), so a
  // batch still `assessor_assigned` or `in_progress` past `resultDueAt` is never flagged. Whether
  // that is intended is not stated anywhere in SCHEMA or DECISIONS.
  it.todo(
    "SPEC-GAP: flags a result breach on read for a batch still in progress past resultDueAt (SCHEMA §2.2 'open steps')",
  );

  it("does not let a late batch be accepted by a role other than aa_admin", async () => {
    const world = await makeWorld();
    const batch = await createBatch(world);
    await makeDuePast(batch.id, "acceptDueAt");
    for (const session of [world.reviewer, world.otherReviewer]) {
      expectError(
        await post(session.token, `/batches/${batch.id}/accept`, { lateReason: "I say so" }),
        403,
        "FORBIDDEN",
      );
    }
    expect(await Batch.findById(batch.id).lean()).toMatchObject({ status: "allocated" });
  });
});
