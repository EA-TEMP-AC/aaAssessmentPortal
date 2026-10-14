import { AssessorDayLock } from "../src/models/assessor-day-lock.model.js";
import { Batch } from "../src/models/batch.model.js";
import {
  addQualification,
  auditRows,
  bootE2e,
  createAssessor,
  createBatch,
  createProctor,
  expectError,
  expectStatus,
  makeAssessor,
  makeWorld,
  patch,
  post,
  resetE2e,
  shutdownE2e,
} from "./helpers/e2e.js";

/**
 * T-01 flow 4. Assessor rules at assign and reassign time: ToA, maximum AAs, assessor-to-learner
 * ratio, clash across centres, same-centre warning, lock release, and language.
 * docs/SCHEMA.md §3.9, §4.1; API_CONTRACT.md POST /batches/:id/assign and /reassign;
 * DECISIONS.md A-03 (language) and Q79 (same centre).
 */

async function acceptedBatch(world, overrides) {
  const batch = await createBatch(world, overrides);
  expectStatus(await post(world.admin.token, `/batches/${batch.id}/accept`), 200);
  return batch;
}

function assign(world, batch, assessor, extra = {}) {
  return post(world.admin.token, `/batches/${batch.id}/assign`, {
    assessorId: assessor.id,
    ...extra,
  });
}

function reassign(world, batch, assessor, extra = {}) {
  return post(world.admin.token, `/batches/${batch.id}/reassign`, {
    assessorId: assessor.id,
    ...extra,
  });
}

async function locksOf(assessor) {
  return AssessorDayLock.find({ assessorId: assessor.id }).sort({ istDate: 1 }).lean();
}

describe("e2e: assessor rules", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);

  describe("RULE_TOA_INVALID", () => {
    it("refuses a missing ToA and a ToA that does not cover every assessment day", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world); // 2099-06-15 to 2099-06-16
      const cases = {
        "no ToA": { toa: null },
        "expired the day before the last assessment day": {
          toa: { certNo: "T-1", issuedOn: "2024-01-01", expiresOn: "2099-06-15" },
        },
        "issued after the first assessment day": {
          toa: { certNo: "T-2", issuedOn: "2099-06-16", expiresOn: "2100-01-01" },
        },
        "expired long ago": {
          toa: { certNo: "T-3", issuedOn: "2020-01-01", expiresOn: "2021-01-01" },
        },
      };
      for (const [label, overrides] of Object.entries(cases)) {
        const { assessor } = await makeAssessor(world, overrides);
        const res = await assign(world, batch, assessor);
        expect(res.status, label).toBe(409);
        expect(res.body.error.code, label).toBe("RULE_TOA_INVALID");
      }
      expect(await Batch.findById(batch.id).lean()).toMatchObject({
        status: "accepted",
        assessorId: null,
      });
      expect(await AssessorDayLock.countDocuments({})).toBe(0);
    });

    it("accepts a ToA that covers the window exactly", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const { assessor } = await makeAssessor(world, {
        toa: { certNo: "T-OK", issuedOn: "2099-06-15", expiresOn: "2099-06-16" },
      });
      expectStatus(await assign(world, batch, assessor), 200);
    });

    // SCHEMA §2 defines TOA_VALIDITY_YEARS = 3 (NCVET:FR §D) and compliance.js exports it, but
    // nothing reads it: an assessor can be saved with a ToA that runs for 76 years.
    it.todo(
      "SPEC-GAP: rejects a ToA longer than TOA_VALIDITY_YEARS when the assessor is saved (constant is never used)",
    );
  });

  describe("RULE_MAX_AAS", () => {
    it("refuses an assessor who already works with four other AAs", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const { assessor: busy } = await makeAssessor(world, { otherAaCount: 4 });
      expectError(await assign(world, batch, busy), 409, "RULE_MAX_AAS");
      const { assessor: ok } = await makeAssessor(world, { otherAaCount: 3 });
      expectStatus(await assign(world, batch, ok), 200);
    });

    it("does not count this AA twice once the assessor is on one of its live batches", async () => {
      const world = await makeWorld();
      const first = await acceptedBatch(world);
      const second = await acceptedBatch(world, {
        assessmentStartDate: "2099-07-13",
        assessmentEndDate: "2099-07-14",
      });
      const { assessor } = await makeAssessor(world, { otherAaCount: 3 });
      expectStatus(await assign(world, first, assessor), 200);
      // They now also work with a fourth other AA. They were already on this AA's batch.
      expectStatus(
        await patch(world.admin.token, `/assessors/${assessor.id}`, { otherAaCount: 4 }),
        200,
      );
      expectStatus(await assign(world, second, assessor), 200);
    });

    it("counts the assessor again once their only batch here is cancelled", async () => {
      const world = await makeWorld();
      const first = await acceptedBatch(world);
      const second = await acceptedBatch(world, {
        assessmentStartDate: "2099-07-13",
        assessmentEndDate: "2099-07-14",
      });
      const { assessor } = await makeAssessor(world, { otherAaCount: 3 });
      expectStatus(await assign(world, first, assessor), 200);
      expectStatus(
        await patch(world.admin.token, `/assessors/${assessor.id}`, { otherAaCount: 4 }),
        200,
      );
      expectStatus(
        await post(world.admin.token, `/batches/${first.id}/cancel`, { reason: "Centre closed" }),
        200,
      );
      expectError(await assign(world, second, assessor), 409, "RULE_MAX_AAS");
    });
  });

  describe("RULE_RATIO", () => {
    // SCHEMA §2: manufacturing 25, services 35, school_education 60, other has no cap.
    // Every qualification below is in the Electronics sector, so a cap that followed the
    // sector instead of the ratio class would give the wrong number for three of the four.
    const classes = [
      { ratioClass: "manufacturing", max: 25 },
      { ratioClass: "services", max: 35 },
      { ratioClass: "school_education", max: 60 },
    ];

    for (const { ratioClass, max } of classes) {
      it(`caps a ${ratioClass} batch at ${max} candidates and lets aa_admin override with a reason`, async () => {
        const world = await makeWorld();
        const qualification = await addQualification(world, {
          code: `Q-${ratioClass}`,
          ratioClass,
        });
        const atLimit = await acceptedBatch(world, {
          qualificationId: qualification.id,
          candidateCount: max,
        });
        const over = await acceptedBatch(world, {
          qualificationId: qualification.id,
          candidateCount: max + 1,
          assessmentStartDate: "2099-07-13",
          assessmentEndDate: "2099-07-14",
        });
        expect(over.ratioClass).toBe(ratioClass);

        const a = await makeAssessor(world);
        const ok = expectStatus(await assign(world, atLimit, a.assessor), 200);
        expect(ok.ratioOverride).toBeNull();

        const b = await makeAssessor(world);
        const refused = await assign(world, over, b.assessor);
        expectError(refused, 409, "RULE_RATIO");
        expect(refused.body.error.details).toMatchObject({
          ratioClass,
          candidateCount: max + 1,
          max,
        });
        expect(await Batch.findById(over.id).lean()).toMatchObject({
          status: "accepted",
          assessorId: null,
        });
        expect(await locksOf(b.assessor)).toHaveLength(0);

        const overridden = expectStatus(
          await assign(world, over, b.assessor, {
            ratioOverrideReason: "AB approved larger cohort",
          }),
          200,
        );
        expect(overridden.status).toBe("assessor_assigned");
        expect(overridden.ratioOverride).toMatchObject({
          reason: "AB approved larger cohort",
          byUserId: world.admin.userId,
        });
        const audit = (await auditRows({ batchId: over.id })).find(
          (row) => row.action === "ratio_override",
        );
        expect(audit.meta.reason).toBe("AB approved larger cohort");
        expect(audit.actorRole).toBe("aa_admin");
      });
    }

    it("does not apply a cap to the 'other' ratio class", async () => {
      const world = await makeWorld();
      const qualification = await addQualification(world, { code: "Q-other", ratioClass: "other" });
      const batch = await acceptedBatch(world, {
        qualificationId: qualification.id,
        candidateCount: 500,
      });
      const { assessor } = await makeAssessor(world);
      const res = expectStatus(await assign(world, batch, assessor), 200);
      expect(res.ratioOverride).toBeNull();
    });

    it("ignores an override reason when the batch is within the cap", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world, { candidateCount: 10 });
      const { assessor } = await makeAssessor(world);
      const res = expectStatus(
        await assign(world, batch, assessor, { ratioOverrideReason: "Not needed" }),
        200,
      );
      expect(res.ratioOverride).toBeNull();
      const actions = (await auditRows({ batchId: batch.id })).map((row) => row.action);
      expect(actions).not.toContain("ratio_override");
    });

    it("rejects a blank override reason as a validation error", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world, { candidateCount: 26 });
      const { assessor } = await makeAssessor(world);
      expectError(
        await assign(world, batch, assessor, { ratioOverrideReason: "  " }),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("RULE_ASSESSOR_CLASH", () => {
    it("refuses an overlapping range at another centre and leaves no partial locks", async () => {
      const world = await makeWorld();
      const first = await acceptedBatch(world); // 15–16 June at centre one
      const clashing = await acceptedBatch(world, {
        centreId: world.centre2.id,
        assessmentStartDate: "2099-06-16",
        assessmentEndDate: "2099-06-17",
      });
      const { assessor } = await makeAssessor(world);
      expectStatus(await assign(world, first, assessor), 200);

      expectError(await assign(world, clashing, assessor), 409, "RULE_ASSESSOR_CLASH");
      expect(await Batch.findById(clashing.id).lean()).toMatchObject({
        status: "accepted",
        statusVersion: 2,
        assessorId: null,
      });
      // 15 June and 16 June only. Nothing was left for 17 June by the failed attempt.
      const locks = await locksOf(assessor);
      expect(locks.map((lock) => lock.istDate)).toEqual(["2099-06-15", "2099-06-16"]);
      expect(locks.every((lock) => lock.batchIds.length === 1)).toBe(true);
    });

    it("allows the next day at another centre, and the same days for a different assessor", async () => {
      const world = await makeWorld();
      const first = await acceptedBatch(world);
      const nextDay = await acceptedBatch(world, {
        centreId: world.centre2.id,
        assessmentStartDate: "2099-06-17",
        assessmentEndDate: "2099-06-18",
      });
      const sameDays = await acceptedBatch(world, {
        centreId: world.centre2.id,
      });
      const { assessor } = await makeAssessor(world);
      const other = await makeAssessor(world);
      expectStatus(await assign(world, first, assessor), 200);
      expectStatus(await assign(world, nextDay, assessor), 200);
      expectStatus(await assign(world, sameDays, other.assessor), 200);
    });
  });

  describe("same assessor, same centre, same day", () => {
    it("is allowed, merges the locks, and warns when either batch has fewer than 10 candidates", async () => {
      const world = await makeWorld();
      const big = await acceptedBatch(world, { candidateCount: 20 });
      const small = await acceptedBatch(world, { candidateCount: 5 });
      const { assessor } = await makeAssessor(world);

      const first = expectStatus(await assign(world, big, assessor), 200);
      expect(first.warnings).toBeUndefined();
      const second = expectStatus(await assign(world, small, assessor), 200);
      expect(second.warnings).toEqual([
        expect.objectContaining({
          code: "SAME_CENTRE_LOW_CANDIDATES",
          details: expect.objectContaining({
            threshold: 10,
            otherBatchId: big.id,
            istDates: ["2099-06-15", "2099-06-16"],
            candidateCounts: { [small.id]: 5, [big.id]: 20 },
          }),
        }),
      ]);

      const locks = await locksOf(assessor);
      expect(locks).toHaveLength(2);
      for (const lock of locks) {
        expect(lock.batchIds.map(String).sort()).toEqual([big.id, small.id].sort());
      }
      const warned = (await auditRows({ batchId: small.id })).filter(
        (row) => row.action === "assessor_same_centre_warning",
      );
      expect(warned).toHaveLength(1);
    });

    it("gives no warning when both batches have at least 10 candidates", async () => {
      const world = await makeWorld();
      const a = await acceptedBatch(world, { candidateCount: 20 });
      const b = await acceptedBatch(world, { candidateCount: 10 });
      const { assessor } = await makeAssessor(world);
      expectStatus(await assign(world, a, assessor), 200);
      const second = expectStatus(await assign(world, b, assessor), 200);
      expect(second.warnings).toBeUndefined();
      expect(await locksOf(assessor)).toHaveLength(2);
    });
  });

  describe("cancel and reassign release locks", () => {
    it("frees the assessor's days when the batch is cancelled", async () => {
      const world = await makeWorld();
      const first = await acceptedBatch(world);
      const second = await acceptedBatch(world, { centreId: world.centre2.id });
      const { assessor } = await makeAssessor(world);
      expectStatus(await assign(world, first, assessor), 200);
      expectError(await assign(world, second, assessor), 409, "RULE_ASSESSOR_CLASH");

      const cancelled = expectStatus(
        await post(world.admin.token, `/batches/${first.id}/cancel`, {
          reason: "Centre flooded; AB agreed to cancel",
        }),
        200,
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.cancelledAt).toBeTruthy();
      expect(await locksOf(assessor)).toHaveLength(0);
      expectStatus(await assign(world, second, assessor), 200);
      expect(await locksOf(assessor)).toHaveLength(2);
    });

    it("keeps a day locked while another batch of the same assessor and centre still holds it", async () => {
      const world = await makeWorld();
      const a = await acceptedBatch(world, { candidateCount: 20 });
      const b = await acceptedBatch(world, { candidateCount: 20 });
      const elsewhere = await acceptedBatch(world, { centreId: world.centre2.id });
      const { assessor } = await makeAssessor(world);
      expectStatus(await assign(world, a, assessor), 200);
      expectStatus(await assign(world, b, assessor), 200);

      expectStatus(
        await post(world.admin.token, `/batches/${a.id}/cancel`, { reason: "No show" }),
        200,
      );
      const left = await locksOf(assessor);
      expect(left).toHaveLength(2);
      expect(left.every((lock) => lock.batchIds.map(String).join() === b.id)).toBe(true);
      expectError(await assign(world, elsewhere, assessor), 409, "RULE_ASSESSOR_CLASH");

      expectStatus(
        await post(world.admin.token, `/batches/${b.id}/cancel`, { reason: "No show" }),
        200,
      );
      expect(await locksOf(assessor)).toHaveLength(0);
      expectStatus(await assign(world, elsewhere, assessor), 200);
    });

    it("moves the locks to the new assessor on reassign", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const elsewhere = await acceptedBatch(world, { centreId: world.centre2.id });
      const x = await makeAssessor(world);
      const z = await makeAssessor(world);
      expectStatus(await assign(world, batch, x.assessor), 200);
      expectError(await assign(world, elsewhere, x.assessor), 409, "RULE_ASSESSOR_CLASH");

      const moved = expectStatus(await reassign(world, batch, z.assessor), 200);
      expect(moved).toMatchObject({
        status: "assessor_assigned",
        assessorId: z.assessor.id,
        statusVersion: 4,
      });
      expect(await locksOf(x.assessor)).toHaveLength(0);
      expect(await locksOf(z.assessor)).toHaveLength(2);
      // The first assessor is free again.
      expectStatus(await assign(world, elsewhere, x.assessor), 200);
    });

    it("keeps the old assessor and their locks when the new one clashes", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const other = await acceptedBatch(world, { centreId: world.centre2.id });
      const x = await makeAssessor(world);
      const z = await makeAssessor(world);
      expectStatus(await assign(world, batch, x.assessor), 200);
      expectStatus(await assign(world, other, z.assessor), 200);

      expectError(await reassign(world, batch, z.assessor), 409, "RULE_ASSESSOR_CLASH");
      const stored = await Batch.findById(batch.id).lean();
      expect(String(stored.assessorId)).toBe(x.assessor.id);
      expect(stored).toMatchObject({ status: "assessor_assigned", statusVersion: 3 });
      expect(await locksOf(x.assessor)).toHaveLength(2);
      expect(
        (await locksOf(z.assessor)).every((lock) => lock.batchIds.map(String).join() === other.id),
      ).toBe(true);
    });

    it("does not allow reassigning once the assessment has started", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const x = await makeAssessor(world);
      const z = await makeAssessor(world);
      expectStatus(await assign(world, batch, x.assessor), 200);
      expectStatus(
        await post(x.session.token, "/assessor/login-event", {
          clientEventId: "evt-reassign-1",
          batchId: batch.id,
          type: "login",
          capturedAt: "2099-06-15T05:00:00.000Z",
          locationStatus: "unavailable",
          locationUnavailableReason: "position_unavailable",
        }),
        200,
      );
      expectError(await reassign(world, batch, z.assessor), 409, "INVALID_TRANSITION");
    });
  });

  describe("RULE_ASSESSOR_LANGUAGE", () => {
    it("refuses an assessor who does not speak the batch language, and one with no languages", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world, { assessmentLanguage: "Marathi" });
      const hindiOnly = await makeAssessor(world, { languages: ["Hindi", "English"] });
      const none = await makeAssessor(world, { languages: [] });
      expectError(await assign(world, batch, hindiOnly.assessor), 409, "RULE_ASSESSOR_LANGUAGE");
      expectError(await assign(world, batch, none.assessor), 409, "RULE_ASSESSOR_LANGUAGE");
      expect(await Batch.findById(batch.id).lean()).toMatchObject({
        status: "accepted",
        assessorId: null,
      });
      expect(await AssessorDayLock.countDocuments({})).toBe(0);
    });

    it("compares languages ignoring case and surrounding spaces", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world, { assessmentLanguage: "  HINDI " });
      const { assessor } = await makeAssessor(world, { languages: [" hindi "] });
      const res = expectStatus(await assign(world, batch, assessor), 200);
      expect(res.assessmentLanguage).toBe("HINDI");
      const actions = (await auditRows({ batchId: batch.id })).map((row) => row.action);
      expect(actions).not.toContain("assessor_language_override");
    });

    it("lets aa_admin override with a reason, which is audit-logged", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world, { assessmentLanguage: "Marathi" });
      const { assessor } = await makeAssessor(world, { languages: ["Hindi"] });
      expectError(
        await assign(world, batch, assessor, { languageOverrideReason: "  " }),
        400,
        "VALIDATION_ERROR",
      );
      const proctor = await createProctor(world, { languages: ["Marathi"] });
      const res = expectStatus(
        await assign(world, batch, assessor, {
          proctorId: proctor.id,
          languageOverrideReason: "A Marathi-speaking proctor will be present",
        }),
        200,
      );
      expect(res.status).toBe("assessor_assigned");
      const audit = (await auditRows({ batchId: batch.id })).find(
        (row) => row.action === "assessor_language_override",
      );
      expect(audit.actorRole).toBe("aa_admin");
      expect(audit.meta.reason).toBe("A Marathi-speaking proctor will be present");
    });

    it("applies the same rule, and the same override, to reassign", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world, { assessmentLanguage: "Hindi" });
      const speaker = await makeAssessor(world, { languages: ["Hindi"] });
      const other = await makeAssessor(world, { languages: ["Tamil"] });
      expectStatus(await assign(world, batch, speaker.assessor), 200);

      expectError(await reassign(world, batch, other.assessor), 409, "RULE_ASSESSOR_LANGUAGE");
      expect(String((await Batch.findById(batch.id).lean()).assessorId)).toBe(speaker.assessor.id);
      expect(await locksOf(speaker.assessor)).toHaveLength(2);

      const moved = expectStatus(
        await reassign(world, batch, other.assessor, {
          languageOverrideReason: "Replacement will be paired with a Hindi speaker",
        }),
        200,
      );
      expect(moved.assessorId).toBe(other.assessor.id);
      const actions = (await auditRows({ batchId: batch.id })).map((row) => row.action);
      expect(actions).toContain("assessor_language_override");
    });
  });

  describe("concurrent requests", () => {
    it("lets exactly one of two parallel accepts through", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world);
      const send = () => post(world.admin.token, `/batches/${batch.id}/accept`, {});
      const results = await Promise.all([send(), send()]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const loser = results.find((res) => res.status === 409);
      expect(loser.body.error.code).toBe("INVALID_TRANSITION");
      expect(await Batch.findById(batch.id).lean()).toMatchObject({
        status: "accepted",
        statusVersion: 2,
      });
    });

    it("lets exactly one of two parallel assigns win and leaves no locks for the loser", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const first = await makeAssessor(world);
      const second = await makeAssessor(world);
      const results = await Promise.all([
        assign(world, batch, first.assessor),
        assign(world, batch, second.assessor),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const winnerIndex = results.findIndex((res) => res.status === 200);
      const winner = [first, second][winnerIndex].assessor;
      const loser = [first, second][1 - winnerIndex].assessor;
      expect(results[1 - winnerIndex].body.error.code).toBe("INVALID_TRANSITION");
      const stored = await Batch.findById(batch.id).lean();
      expect(stored).toMatchObject({ status: "assessor_assigned", statusVersion: 3 });
      expect(String(stored.assessorId)).toBe(winner.id);
      expect(await locksOf(winner)).toHaveLength(2);
      expect(await locksOf(loser)).toHaveLength(0);
    });

    it("lets one assessor take only one of two overlapping batches at different centres", async () => {
      const world = await makeWorld();
      const here = await acceptedBatch(world);
      const there = await acceptedBatch(world, { centreId: world.centre2.id });
      const { assessor } = await makeAssessor(world);
      const results = await Promise.all([
        assign(world, here, assessor),
        assign(world, there, assessor),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const loserIndex = results.findIndex((res) => res.status === 409);
      expect(results[loserIndex].body.error.code).toBe("RULE_ASSESSOR_CLASH");
      const won = [here, there][1 - loserIndex];
      const lost = [here, there][loserIndex];
      const locks = await locksOf(assessor);
      expect(locks).toHaveLength(2);
      expect(locks.every((lock) => lock.batchIds.map(String).join() === won.id)).toBe(true);
      expect(await Batch.findById(lost.id).lean()).toMatchObject({
        status: "accepted",
        assessorId: null,
      });
    });
  });

  describe("people who cannot be assigned", () => {
    it("refuses an inactive or unknown assessor and an inactive proctor", async () => {
      const world = await makeWorld();
      const batch = await acceptedBatch(world);
      const inactive = await createAssessor(world, { active: false });
      expectError(await assign(world, batch, inactive), 400, "VALIDATION_ERROR");
      expectError(
        await assign(world, batch, { id: "0123456789abcdef01234567" }),
        400,
        "VALIDATION_ERROR",
      );
      const { assessor } = await makeAssessor(world);
      const proctor = await createProctor(world, { active: false });
      expectError(
        await assign(world, batch, assessor, { proctorId: proctor.id }),
        400,
        "VALIDATION_ERROR",
      );
      expect(await Batch.findById(batch.id).lean()).toMatchObject({ status: "accepted" });
    });
  });
});
