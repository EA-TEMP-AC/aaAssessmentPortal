import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Result } from "../src/models/result.model.js";
import {
  GHOST_ID,
  PASS_NOS,
  advanceBatch,
  auditRows,
  bootE2e,
  dueAfter,
  expectError,
  expectStatus,
  get,
  istDateOf,
  makeWorld,
  patch,
  post,
  prepareBatch,
  resetE2e,
  sessionFor,
  shutdownE2e,
} from "./helpers/e2e.js";

/**
 * T-01 flow 7. Reassessment: a new batch for learners who failed or were absent, within one year
 * of the first result's publication date. docs/SCHEMA.md §4.2; API_CONTRACT.md
 * POST /batches/:id/reassessments; DECISIONS.md A-03, Q22 (2026-10-13), Q144 and Q146 (2026-10-14).
 */
const PUBLISHED_IST_2026_11_26 = "2026-11-25T19:00:00.000Z"; // 00:30 IST on the 26th

function setPublishedAt(batchId, iso) {
  return Result.updateOne({ batchId }, { $set: { publishedAt: new Date(iso) } });
}

function reassess(session, parent, body) {
  return post(session.token, `/batches/${parent.id}/reassessments`, body);
}

function window(start, end = start, extra = {}) {
  return { assessmentStartDate: start, assessmentEndDate: end, ...extra };
}

function cancel(world, batchId) {
  return post(world.admin.token, `/batches/${batchId}/cancel`, { reason: "Test cleanup" });
}

/** A published batch of three: Pass, Absent, Fail. Returns the learners that can be reassessed. */
async function publishedParent(world, publishedAt = PUBLISHED_IST_2026_11_26, options = {}) {
  const ctx = await prepareBatch(world, { until: "published", ...options });
  await setPublishedAt(ctx.batch.id, publishedAt);
  return { ...ctx, passed: ctx.learners[0], absent: ctx.learners[1], failed: ctx.learners[2] };
}

describe("e2e: reassessment", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  describe("window: one year from the first result's publishedAt", () => {
    it("includes the publication date and the anniversary, in IST", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const only = { learnerIds: [parent.failed.id] };

      // 19:00Z on the 25th is the 26th in IST, so the 25th is before the window.
      const early = await reassess(world.admin, parent.batch, { ...window("2026-11-25"), ...only });
      expectError(early, 409, "REASSESS_NOT_ELIGIBLE");
      expect(early.body.error.details).toEqual({
        reason: "window",
        windowStart: "2026-11-26",
        windowEnd: "2027-11-26",
      });

      // The publication date itself is in.
      const first = expectStatus(
        await reassess(world.admin, parent.batch, { ...window("2026-11-26"), ...only }),
        201,
      );
      expect(first.assessmentStartDate).toBe("2026-11-26");
      expectStatus(await cancel(world, first.id), 200);

      // The anniversary is in, and the end date may run past it.
      const last = expectStatus(
        await reassess(world.admin, parent.batch, {
          ...window("2027-11-26", "2027-11-28"),
          ...only,
        }),
        201,
      );
      expect(last.assessmentEndDate).toBe("2027-11-28");
      expectStatus(await cancel(world, last.id), 200);

      const late = await reassess(world.admin, parent.batch, { ...window("2027-11-27"), ...only });
      expectError(late, 409, "REASSESS_NOT_ELIGIBLE");
      expect(late.body.error.details).toMatchObject({
        reason: "window",
        windowStart: "2026-11-26",
        windowEnd: "2027-11-26",
      });
    });

    it("moves 29 February to 28 February in a year without one", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world, "2028-02-29T10:00:00.000Z");
      const only = { learnerIds: [parent.failed.id] };
      const ok = expectStatus(
        await reassess(world.admin, parent.batch, { ...window("2029-02-28"), ...only }),
        201,
      );
      expectStatus(await cancel(world, ok.id), 200);
      const late = await reassess(world.admin, parent.batch, { ...window("2029-03-01"), ...only });
      expectError(late, 409, "REASSESS_NOT_ELIGIBLE");
      expect(late.body.error.details).toMatchObject({
        windowStart: "2028-02-29",
        windowEnd: "2029-02-28",
      });
    });

    it("counts from the first assessment, not from the immediate parent", async () => {
      const world = await makeWorld();
      // Far-future dates keep every due instant ahead of the real clock.
      const root = await publishedParent(world, "2098-11-25T19:00:00.000Z");
      const first = expectStatus(
        await reassess(
          world.admin,
          root.batch,
          window("2099-01-12", "2099-01-12", {
            learnerIds: [root.absent.id, root.failed.id],
          }),
        ),
        201,
      );
      expect(first.firstAssessmentBatchId).toBe(root.batch.id);

      // Take the reassessment through its own lifecycle. Absent and Fail again.
      const roster = expectStatus(
        await get(world.admin.token, `/batches/${first.id}/candidates`),
        200,
      );
      const ctx = {
        world,
        batch: first,
        learners: [root.absent, root.failed],
        roster: roster.items,
        presence: [false, true],
        options: {
          capturedAt: "2099-01-12T05:00:00.000Z",
          laterCapturedAt: "2099-01-12T09:30:00.000Z",
        },
      };
      await advanceBatch(ctx, "published");
      expect(ctx.batch.status).toBe("published");
      // Published much later than the root. A window counted from here would run to 2100.
      await setPublishedAt(first.id, "2099-12-01T10:00:00.000Z");

      const outside = await reassess(world.admin, ctx.batch, window("2099-12-15", "2099-12-15"));
      expectError(outside, 409, "REASSESS_NOT_ELIGIBLE");
      expect(outside.body.error.details).toEqual({
        reason: "window",
        windowStart: "2098-11-26",
        windowEnd: "2099-11-26",
      });

      const inside = expectStatus(
        await reassess(world.admin, ctx.batch, window("2099-11-20", "2099-11-20")),
        201,
      );
      expect(inside).toMatchObject({
        isReassessment: true,
        reassessmentOf: first.id,
        firstAssessmentBatchId: root.batch.id,
      });
      const audit = (await auditRows({ batchId: inside.id })).find(
        (row) => row.action === "batch.reassess",
      );
      expect(audit.meta).toMatchObject({
        reassessmentOf: first.id,
        firstAssessmentBatchId: root.batch.id,
        originalPublishedAt: "2098-11-25T19:00:00.000Z",
        windowStart: "2098-11-26",
        windowEnd: "2099-11-26",
      });
    });
  });

  describe("unpublished original", () => {
    it("is refused at every step before publication and accepted once published", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "allocated" });
      const start = istDateOf(Date.now() + 30 * 86_400_000);
      const attempt = () => reassess(world.admin, ctx.batch, window(start));
      const refusedAt = async (stage) => {
        if (stage) await advanceBatch(ctx, stage);
        const res = await attempt();
        expectError(res, 409, "REASSESS_NOT_ELIGIBLE");
        expect(res.body.error.details.reason, stage ?? "allocated").toBe("not_published");
      };
      await refusedAt(undefined);
      await refusedAt("assigned");
      await refusedAt("drafted");
      await refusedAt("submitted");
      await refusedAt("validated");
      expect(await Batch.countDocuments({ isReassessment: true })).toBe(0);

      await advanceBatch(ctx, "published");
      const created = expectStatus(await attempt(), 201);
      expect(created.candidateCount).toBe(2);
    });

    it("checks publication before the window, and the window before the outcome", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "validated" });
      const farOff = window("2199-01-01");
      expect((await reassess(world.admin, ctx.batch, farOff)).body.error.details.reason).toBe(
        "not_published",
      );
      await advanceBatch(ctx, "published");
      const res = await reassess(world.admin, ctx.batch, {
        ...farOff,
        learnerIds: [ctx.learners[0].id],
      });
      expectError(res, 409, "REASSESS_NOT_ELIGIBLE");
      expect(res.body.error.details.reason).toBe("window");
    });
  });

  describe("who can be reassessed", () => {
    it("takes Fail and Absent by default and refuses a learner who passed", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const refused = await reassess(world.admin, parent.batch, {
        ...window("2026-12-01"),
        learnerIds: [parent.passed.id, parent.failed.id],
      });
      expectError(refused, 409, "REASSESS_NOT_ELIGIBLE");
      expect(refused.body.error.details).toEqual({
        reason: "outcome",
        learnerIds: [parent.passed.id],
      });

      const unknown = await reassess(world.admin, parent.batch, {
        ...window("2026-12-01"),
        learnerIds: [GHOST_ID],
      });
      expect(unknown.body.error.details).toEqual({ reason: "outcome", learnerIds: [GHOST_ID] });

      const created = expectStatus(
        await reassess(world.admin, parent.batch, window("2026-12-01")),
        201,
      );
      expect(created.candidateCount).toBe(2);
      const roster = await Candidate.find({ batchId: created.id })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      expect(roster.map((row) => String(row.learnerId))).toEqual([
        parent.absent.id,
        parent.failed.id,
      ]);
    });

    it("has nobody to reassess when everyone passed", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world, PUBLISHED_IST_2026_11_26, {
        presence: [true, true, true],
        rows: (ctx) => ctx.roster.map((row) => ({ candidateId: row.id, nos: [...PASS_NOS] })),
      });
      const res = await reassess(world.admin, parent.batch, window("2026-12-01"));
      expectError(res, 409, "REASSESS_NOT_ELIGIBLE");
      expect(res.body.error.details).toEqual({ reason: "outcome", learnerIds: [] });
    });
  });

  describe("REASSESS_ALREADY_OPEN", () => {
    it("refuses a learner with a live reassessment from the same parent, per learner", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const { absent, failed } = parent;
      const body = (ids) => ({ ...window("2026-12-01"), ...(ids ? { learnerIds: ids } : {}) });

      const r1 = expectStatus(await reassess(world.admin, parent.batch, body([absent.id])), 201);

      const again = await reassess(world.admin, parent.batch, body([absent.id]));
      expectError(again, 409, "REASSESS_ALREADY_OPEN");
      expect(again.body.error.details).toEqual({
        reason: "already_open",
        conflicts: [{ learnerId: absent.id, batchId: r1.id }],
      });

      // Naming one blocked and one free learner refuses the call and names only the blocked one.
      const mixed = await reassess(world.admin, parent.batch, body([absent.id, failed.id]));
      expectError(mixed, 409, "REASSESS_ALREADY_OPEN");
      expect(mixed.body.error.details.conflicts).toEqual([
        { learnerId: absent.id, batchId: r1.id },
      ]);

      // A request that names only a free learner goes through.
      const r2 = expectStatus(await reassess(world.admin, parent.batch, body([failed.id])), 201);

      // Default selection takes both, and both are blocked, in roster order.
      const all = await reassess(world.admin, parent.batch, body());
      expectError(all, 409, "REASSESS_ALREADY_OPEN");
      expect(all.body.error.details.conflicts).toEqual([
        { learnerId: absent.id, batchId: r1.id },
        { learnerId: failed.id, batchId: r2.id },
      ]);
      expect(await Batch.countDocuments({ isReassessment: true })).toBe(2);
    });

    it("lets the learner back in once the earlier batch is cancelled, rejected, or the learner is removed", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const { absent, failed } = parent;
      const body = (id) => ({ ...window("2026-12-01"), learnerIds: [id] });

      // Cancelled.
      const r1 = expectStatus(await reassess(world.admin, parent.batch, body(absent.id)), 201);
      expectStatus(await cancel(world, r1.id), 200);
      const r1b = expectStatus(await reassess(world.admin, parent.batch, body(absent.id)), 201);

      // Rejected.
      const r2 = expectStatus(await reassess(world.admin, parent.batch, body(failed.id)), 201);
      expectStatus(
        await post(world.admin.token, `/batches/${r2.id}/reject`, { reason: "No capacity" }),
        200,
      );
      const r2b = expectStatus(await reassess(world.admin, parent.batch, body(failed.id)), 201);

      // Removed from the roster (soft delete) while the batch is still live.
      const roster = expectStatus(
        await get(world.admin.token, `/batches/${r1b.id}/candidates`),
        200,
      );
      expectStatus(
        await patch(world.admin.token, `/batches/${r1b.id}/candidates/${roster.items[0].id}`, {
          active: false,
        }),
        200,
      );
      const r1c = expectStatus(await reassess(world.admin, parent.batch, body(absent.id)), 201);
      expect(new Set([r1b.id, r2b.id, r1c.id]).size).toBe(3);
    });

    it("lets the learner back in once the earlier reassessment is published, not before (Q167)", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const body = { ...window("2026-12-01"), learnerIds: [parent.failed.id] };
      const first = expectStatus(await reassess(world.admin, parent.batch, body), 201);
      for (const status of ["accepted", "in_progress", "result_submitted", "ab_validated"]) {
        await Batch.updateOne({ _id: first.id }, { $set: { status } });
        expectError(await reassess(world.admin, parent.batch, body), 409, "REASSESS_ALREADY_OPEN");
      }
      await Batch.updateOne({ _id: first.id }, { $set: { status: "published" } });
      expectStatus(await reassess(world.admin, parent.batch, body), 201);
    });
  });

  describe("what the new batch inherits", () => {
    it("copies the parent's fields, roster and stored sector, and gets fresh dues", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const parentBefore = await Batch.findById(parent.batch.id).lean();
      const resultBefore = await Result.findOne({ batchId: parent.batch.id }).lean();

      // The qualification changes after the first assessment. The reassessment keeps the parent's values.
      expectStatus(
        await patch(world.admin.token, `/qualifications/${world.qualification.id}`, {
          sector: "Construction",
          ratioClass: "services",
        }),
        200,
      );

      const body = window("2026-12-01", "2026-12-02", {
        learnerIds: [parent.absent.id, parent.failed.id],
      });
      const created = expectStatus(await reassess(world.reviewer, parent.batch, body), 201);

      expect(created).toMatchObject({
        status: "allocated",
        statusVersion: 1,
        isReassessment: true,
        reassessmentOf: parent.batch.id,
        firstAssessmentBatchId: parent.batch.id,
        abId: parent.batch.abId,
        qualificationId: parent.batch.qualificationId,
        type: parent.batch.type,
        mode: parent.batch.mode,
        tpId: parent.batch.tpId,
        centreId: parent.batch.centreId,
        state: "Maharashtra",
        sector: "Electronics",
        ratioClass: "manufacturing",
        assessmentLanguage: "Hindi",
        candidateCount: 2,
        assessorId: null,
        resultId: null,
        recognitionOverride: null,
        assessmentStartDate: "2026-12-01",
        assessmentEndDate: "2026-12-02",
      });

      // Q146: the clocks start now, as if the AB had just allocated it.
      expect(Math.abs(Date.now() - Date.parse(created.allocatedAt))).toBeLessThan(60_000);
      expect(created.sla.acceptDueAt).toBe(dueAfter(created.allocatedAt, 2));
      expect(created.sla.assignDueAt).toBe(dueAfter(created.allocatedAt, 7));
      expect(created.sla.resultDueAt).toBe(dueAfter("2026-12-02", 3));

      // Roster: one row per learner taken, linked to the first assessment's row.
      const rows = await Candidate.find({ batchId: created.id })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const original = await Candidate.find({ batchId: parent.batch.id }).lean();
      const byLearner = new Map(original.map((row) => [String(row.learnerId), row]));
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const source = byLearner.get(String(row.learnerId));
        expect(row.active).toBe(true);
        expect(row.name).toBe(source.name);
        expect(row.externalRef).toBe(source.externalRef);
        expect(String(row.sourceOriginalCandidateId)).toBe(String(source._id));
      }

      // The parent and its result are untouched.
      expect(await Batch.findById(parent.batch.id).lean()).toEqual(parentBefore);
      expect(await Result.findOne({ batchId: parent.batch.id }).lean()).toEqual(resultBefore);

      const audit = (await auditRows({ batchId: created.id })).find(
        (row) => row.action === "batch.reassess",
      );
      expect(audit.actorRole).toBe("ab_reviewer");
      expect(String(audit.actorId)).toBe(world.reviewer.userId);
      expect(audit.meta).toMatchObject({
        reassessmentOf: parent.batch.id,
        firstAssessmentBatchId: parent.batch.id,
        windowStart: "2026-11-26",
        windowEnd: "2027-11-26",
        learnerIds: [parent.absent.id, parent.failed.id],
      });
      expect(audit.meta.originalPublishedAt).toBe(PUBLISHED_IST_2026_11_26);
    });

    it("lets the request change only the dates, centre, learners, language and recognition reason", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const base = window("2026-12-01");

      const changed = expectStatus(
        await reassess(world.admin, parent.batch, {
          ...base,
          centreId: world.centre2.id,
          assessmentLanguage: "Marathi",
          learnerIds: [parent.failed.id],
        }),
        201,
      );
      expect(changed).toMatchObject({
        centreId: world.centre2.id,
        assessmentLanguage: "Marathi",
        candidateCount: 1,
      });

      for (const extra of [
        { abId: world.otherAb.id },
        { qualificationId: world.qualification.id },
        { type: "LTT" },
        { mode: "online" },
        { tpId: world.otherTp.id },
        { sector: "Healthcare" },
        { ratioClass: "services" },
        { aadhaar: "123412341234" },
      ]) {
        expectError(
          await reassess(world.admin, parent.batch, {
            ...base,
            learnerIds: [parent.absent.id],
            ...extra,
          }),
          400,
          "VALIDATION_ERROR",
        );
      }
      const wrongCentre = await reassess(world.admin, parent.batch, {
        ...base,
        learnerIds: [parent.absent.id],
        centreId: world.otherTpCentre.id,
      });
      expectError(wrongCentre, 400, "VALIDATION_ERROR");
      expect(wrongCentre.body.error.details.centreId).toBeTruthy();
      expectError(
        await reassess(world.admin, parent.batch, window("2026-12-05", "2026-12-04")),
        400,
        "VALIDATION_ERROR",
      );
      expect(await Batch.countDocuments({ isReassessment: true })).toBe(1);
    });
  });

  describe("who can start one", () => {
    it("allows aa_admin and the reviewer of the batch's own awarding body only", async () => {
      const world = await makeWorld();
      const parent = await publishedParent(world);
      const body = (id) => ({ ...window("2026-12-01"), learnerIds: [id] });
      const noAb = await sessionFor("ab_reviewer", { email: "noab@aa.example" });
      const others = {
        otherAbReviewer: world.otherReviewer,
        reviewerWithoutAb: noAb,
        mis: await sessionFor("mis"),
        tp: await sessionFor("tp", { tpId: world.tp.id }),
        assessor: parent.assessorSession,
        ncvet: await sessionFor("ncvet_viewer"),
      };
      for (const [label, session] of Object.entries(others)) {
        const res = await reassess(session, parent.batch, body(parent.absent.id));
        expect(res.status, label).toBe(403);
        expect(res.body.error.code, label).toBe("FORBIDDEN");
      }
      expect(await Batch.countDocuments({ isReassessment: true })).toBe(0);
      expectStatus(await reassess(world.reviewer, parent.batch, body(parent.absent.id)), 201);
      expectStatus(await reassess(world.admin, parent.batch, body(parent.failed.id)), 201);
      const actors = (await auditRows({ action: "batch.reassess" })).map((row) => row.actorRole);
      expect(actors).toEqual(["ab_reviewer", "aa_admin"]);
      expectError(
        await reassess(world.admin, { id: GHOST_ID }, body(parent.absent.id)),
        404,
        "NOT_FOUND",
      );
    });
  });
});
