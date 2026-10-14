import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Result } from "../src/models/result.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import {
  addYearsToCivilDate,
  reassessmentWindow,
} from "../src/modules/batches/reassessment.service.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const oid = () => new mongoose.Types.ObjectId();

/** 00:30 IST on 26 Nov 2026: the IST date is a day ahead of the UTC date. */
const PUBLISHED_AT = new Date("2026-11-25T19:00:00.000Z");
const WINDOW_START = "2026-11-26";
const WINDOW_END = "2027-11-26";

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}, email = `${role}@aa.example`) {
  const { password } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

function reassess(token, batchId, body) {
  return request(app)
    .post(`/api/v1/batches/${batchId}/reassessments`)
    .set(bearer(token))
    .send(body);
}

function dates(start, end = start) {
  return { assessmentStartDate: start, assessmentEndDate: end };
}

async function recognition(overrides = {}) {
  await AaRecognition.create({
    sectors: ["Electronics"],
    panIndia: false,
    states: ["Maharashtra", "Gujarat"],
    startDate: "2000-01-01",
    endDate: "2999-12-31",
    ...overrides,
  });
}

/**
 * A batch with its result. Roster outcomes: Asha Pass, Bala Absent, Chitra Fail.
 * `resultStatus: null` leaves the batch without a result.
 */
async function assessedBatch({
  batch: batchOverrides = {},
  status = "published",
  resultStatus = "published",
  publishedAt = PUBLISHED_AT,
  masters,
} = {}) {
  const m = masters ?? (await newMasters());
  const _id = oid();
  const batch = await Batch.create({
    _id,
    abId: m.abId,
    qualificationId: m.qualificationId,
    type: "STT",
    mode: "blended",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId: m.tpId,
    centreId: m.centre._id,
    candidateCount: 3,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Marathi",
    state: "Maharashtra",
    status,
    statusVersion: 8,
    isReassessment: false,
    firstAssessmentBatchId: _id,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...batchOverrides,
  });
  const learnerIds = [oid(), oid(), oid()];
  const [asha, bala, chitra] = await Candidate.create(
    ["Asha Devi", "Bala Kumar", "Chitra Rao"].map((name, index) => ({
      batchId: batch._id,
      learnerId: learnerIds[index],
      name,
      externalRef: `R-${index + 1}`,
      accommodations: index === 1 ? ["scribe"] : [],
    })),
  );
  if (resultStatus) {
    const published = resultStatus === "published";
    await Result.create({
      batchId: batch._id,
      status: resultStatus,
      publishedAt: published ? publishedAt : null,
      publishedBy: published ? oid() : null,
      rows: [
        { candidateId: asha._id, outcome: "Pass" },
        { candidateId: bala._id, absent: true, outcome: "Absent" },
        { candidateId: chitra._id, outcome: "Fail" },
      ],
    });
  }
  return { ...m, batch, learnerIds, asha, bala, chitra };
}

async function newMasters() {
  const tpId = oid();
  const centre = await Centre.create({ name: "Pune Centre", tpId, state: "Maharashtra" });
  return { abId: oid(), qualificationId: oid(), tpId, centre };
}

describe("POST /batches/:id/reassessments", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Batch.syncIndexes(),
      Candidate.syncIndexes(),
      Result.syncIndexes(),
      AaRecognition.syncIndexes(),
      AuditLog.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("creates an allocated batch that inherits from the published original", async () => {
    await recognition();
    const w = await assessedBatch();
    const admin = await sessionFor("aa_admin");

    const res = await reassess(admin.token, w.batch._id, dates("2027-02-01", "2027-02-02"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      abId: String(w.abId),
      qualificationId: String(w.qualificationId),
      type: "STT",
      mode: "blended",
      tpId: String(w.tpId),
      centreId: String(w.centre._id),
      sector: "Electronics",
      ratioClass: "manufacturing",
      assessmentLanguage: "Marathi",
      state: "Maharashtra",
      assessmentStartDate: "2027-02-01",
      assessmentEndDate: "2027-02-02",
      candidateCount: 2,
      status: "allocated",
      statusVersion: 1,
      assessorId: null,
      resultId: null,
      isReassessment: true,
      reassessmentOf: String(w.batch._id),
      firstAssessmentBatchId: String(w.batch._id),
    });
    expect(res.body.id).not.toBe(String(w.batch._id));
    expect(res.body.sla.acceptDueAt).toEqual(expect.any(String));
    expect(res.body.sla.assignDueAt).toEqual(expect.any(String));
    expect(res.body.sla.resultDueAt).toEqual(expect.any(String));

    // Only the Fail and Absent learners are copied, linked to their original rows.
    const roster = await Candidate.find({ batchId: res.body.id }).sort({ name: 1 }).lean();
    expect(roster.map((row) => row.name)).toEqual(["Bala Kumar", "Chitra Rao"]);
    expect(roster.map((row) => String(row.learnerId))).toEqual([
      String(w.learnerIds[1]),
      String(w.learnerIds[2]),
    ]);
    expect(roster.map((row) => String(row.sourceOriginalCandidateId))).toEqual([
      String(w.bala._id),
      String(w.chitra._id),
    ]);
    expect(roster[0].accommodations).toEqual(["scribe"]);
    expect(roster.every((row) => row.active)).toBe(true);

    const original = await Batch.findById(w.batch._id).lean();
    expect(original.status).toBe("published");
    expect(original.statusVersion).toBe(8);

    const audit = await AuditLog.findOne({ action: "batch.reassess" }).lean();
    expect(String(audit.actorId)).toBe(admin.userId);
    expect(audit.actorRole).toBe("aa_admin");
    expect(audit.entityId).toBe(res.body.id);
    expect(String(audit.abId)).toBe(String(w.abId));
    expect(audit.meta).toMatchObject({
      reassessmentOf: String(w.batch._id),
      firstAssessmentBatchId: String(w.batch._id),
      originalPublishedAt: PUBLISHED_AT.toISOString(),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
  });

  it("lets the batch's ab_reviewer initiate and audits them as the actor", async () => {
    await recognition();
    const w = await assessedBatch();
    const reviewer = await sessionFor("ab_reviewer", { abId: w.abId });

    const res = await reassess(reviewer.token, w.batch._id, dates("2027-02-01"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const audit = await AuditLog.findOne({ action: "batch.reassess" }).lean();
    expect(String(audit.actorId)).toBe(reviewer.userId);
    expect(audit.actorRole).toBe("ab_reviewer");
  });

  it("refuses a reviewer of another awarding body, one with no abId, and other roles", async () => {
    await recognition();
    const w = await assessedBatch();
    const other = await sessionFor("ab_reviewer", { abId: oid() }, "other@ab.example");
    const unlinked = await sessionFor("ab_reviewer", {}, "unlinked@ab.example");
    const mis = await sessionFor("mis");
    const tp = await sessionFor("tp", { tpId: w.tpId });

    for (const session of [other, unlinked, mis, tp]) {
      expectError(
        await reassess(session.token, w.batch._id, dates("2027-02-01")),
        403,
        "FORBIDDEN",
      );
    }
    expect(await Batch.countDocuments({ isReassessment: true })).toBe(0);
    expect(await AuditLog.countDocuments({ action: "batch.reassess" })).toBe(0);
  });

  it.each([
    ["assessment_completed", "draft"],
    ["assessment_completed", null],
    ["result_submitted", "submitted"],
    ["ab_validated", "validated"],
    ["cancelled", null],
  ])("refuses an unpublished original (batch %s, result %s)", async (status, resultStatus) => {
    await recognition();
    const w = await assessedBatch({ status, resultStatus });
    const admin = await sessionFor("aa_admin");

    const res = await reassess(admin.token, w.batch._id, dates("2027-02-01"));
    expectError(res, 409, "REASSESS_NOT_ELIGIBLE");
    expect(res.body.error.details).toEqual({ reason: "not_published" });
    expect(await Batch.countDocuments({})).toBe(1);
    expect(await Candidate.countDocuments({})).toBe(3);
  });

  describe("window", () => {
    it.each([
      ["the IST publication date", WINDOW_START],
      ["the anniversary", WINDOW_END],
    ])("accepts a start on %s", async (_label, start) => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");

      const res = await reassess(admin.token, w.batch._id, dates(start));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.assessmentStartDate).toBe(start);
    });

    it.each([
      ["the day before the IST publication date", "2026-11-25"],
      ["the day after the anniversary", "2027-11-27"],
    ])("refuses a start on %s", async (_label, start) => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");

      const res = await reassess(admin.token, w.batch._id, dates(start));
      expectError(res, 409, "REASSESS_NOT_ELIGIBLE");
      expect(res.body.error.details).toEqual({
        reason: "window",
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });
      expect(await Batch.countDocuments({ isReassessment: true })).toBe(0);
    });

    it("lets the end date run past the anniversary when the start is inside", async () => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");

      const res = await reassess(admin.token, w.batch._id, dates(WINDOW_END, "2027-11-28"));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("counts a second reassessment from the first assessment, not from its parent", async () => {
      await recognition();
      const root = await assessedBatch();
      const parent = await assessedBatch({
        masters: root,
        publishedAt: new Date("2027-06-01T06:00:00.000Z"),
        batch: {
          isReassessment: true,
          reassessmentOf: root.batch._id,
          firstAssessmentBatchId: root.batch._id,
        },
      });
      const admin = await sessionFor("aa_admin");

      // Inside a year of the parent's publication, outside a year of the root's.
      const late = await reassess(admin.token, parent.batch._id, dates("2027-11-27"));
      expectError(late, 409, "REASSESS_NOT_ELIGIBLE");
      expect(late.body.error.details).toMatchObject({ reason: "window", windowEnd: WINDOW_END });

      const ok = await reassess(admin.token, parent.batch._id, dates(WINDOW_END));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.reassessmentOf).toBe(String(parent.batch._id));
      expect(ok.body.firstAssessmentBatchId).toBe(String(root.batch._id));
    });

    it("moves 29 February to 28 February in a non-leap year", () => {
      expect(addYearsToCivilDate("2028-02-29", 1)).toBe("2029-02-28");
      expect(addYearsToCivilDate("2027-03-01", 1)).toBe("2028-03-01");
      expect(reassessmentWindow(new Date("2028-02-28T18:30:00.000Z"))).toEqual({
        windowStart: "2028-02-29",
        windowEnd: "2029-02-28",
      });
    });
  });

  describe("a live reassessment of the same learner from the same parent (Q144)", () => {
    async function firstReassessment(w, admin, learnerIds) {
      const res = await reassess(admin.token, w.batch._id, {
        ...dates("2027-02-01", "2027-02-02"),
        ...(learnerIds ? { learnerIds: learnerIds.map(String) } : {}),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.id;
    }

    it("refuses a second batch and names the existing one for each learner", async () => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");
      const first = await firstReassessment(w, admin);

      const res = await reassess(admin.token, w.batch._id, dates("2027-03-01", "2027-03-02"));
      expectError(res, 409, "REASSESS_ALREADY_OPEN");
      expect(res.body.error.details.reason).toBe("already_open");
      expect(res.body.error.details.conflicts).toEqual([
        { learnerId: String(w.learnerIds[1]), batchId: first },
        { learnerId: String(w.learnerIds[2]), batchId: first },
      ]);
      expect(await Batch.countDocuments({ reassessmentOf: w.batch._id })).toBe(1);
    });

    it("applies to the learners being added, and lets the others through", async () => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");
      const first = await firstReassessment(w, admin, [w.learnerIds[1]]);

      const clash = await reassess(admin.token, w.batch._id, {
        ...dates("2027-03-01"),
        learnerIds: [String(w.learnerIds[1]), String(w.learnerIds[2])],
      });
      expectError(clash, 409, "REASSESS_ALREADY_OPEN");
      expect(clash.body.error.details.conflicts).toEqual([
        { learnerId: String(w.learnerIds[1]), batchId: first },
      ]);

      const other = await reassess(admin.token, w.batch._id, {
        ...dates("2027-03-01"),
        learnerIds: [String(w.learnerIds[2])],
      });
      expect(other.status, JSON.stringify(other.body)).toBe(201);
    });

    it("lets a learner be taken again once the earlier batch is cancelled or rejected", async () => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");
      for (const status of ["cancelled", "rejected"]) {
        const id = await firstReassessment(w, admin);
        await Batch.updateOne({ _id: id }, { $set: { status } });
        const again = await reassess(admin.token, w.batch._id, dates("2027-03-01"));
        expect(again.status, JSON.stringify(again.body)).toBe(201);
        await Batch.updateOne({ _id: again.body.id }, { $set: { status: "cancelled" } });
      }
    });

    it("keeps refusing while the earlier batch is in any later status", async () => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");
      const id = await firstReassessment(w, admin);
      for (const status of ["accepted", "in_progress", "published"]) {
        await Batch.updateOne({ _id: id }, { $set: { status } });
        const res = await reassess(admin.token, w.batch._id, dates("2027-03-01"));
        expectError(res, 409, "REASSESS_ALREADY_OPEN");
      }
    });

    it("ignores a learner who was removed from the earlier batch's roster", async () => {
      await recognition();
      const w = await assessedBatch();
      const admin = await sessionFor("aa_admin");
      const first = await firstReassessment(w, admin, [w.learnerIds[1]]);
      await Candidate.updateOne(
        { batchId: first, learnerId: w.learnerIds[1] },
        { $set: { active: false } },
      );
      const again = await reassess(admin.token, w.batch._id, {
        ...dates("2027-03-01"),
        learnerIds: [String(w.learnerIds[1])],
      });
      expect(again.status, JSON.stringify(again.body)).toBe(201);
    });

    it("does not count a reassessment of a different parent", async () => {
      await recognition();
      const w = await assessedBatch();
      const other = await assessedBatch({ masters: w });
      const admin = await sessionFor("aa_admin");
      await firstReassessment(w, admin);
      const res = await reassess(admin.token, other.batch._id, dates("2027-03-01"));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  it("takes only the named learners and refuses one who passed", async () => {
    await recognition();
    const w = await assessedBatch();
    const admin = await sessionFor("aa_admin");

    const passed = await reassess(admin.token, w.batch._id, {
      ...dates("2027-02-01"),
      learnerIds: [String(w.learnerIds[0]), String(w.learnerIds[2])],
    });
    expectError(passed, 409, "REASSESS_NOT_ELIGIBLE");
    expect(passed.body.error.details).toEqual({
      reason: "outcome",
      learnerIds: [String(w.learnerIds[0])],
    });

    const one = await reassess(admin.token, w.batch._id, {
      ...dates("2027-02-01"),
      learnerIds: [String(w.learnerIds[2])],
    });
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.body.candidateCount).toBe(1);
    const roster = await Candidate.find({ batchId: one.body.id }).lean();
    expect(roster.map((row) => row.name)).toEqual(["Chitra Rao"]);
  });

  it("refuses a batch where nobody failed or was absent", async () => {
    await recognition();
    const w = await assessedBatch();
    await Result.updateOne(
      { batchId: w.batch._id },
      { $set: { "rows.$[].outcome": "Pass", "rows.$[].absent": false } },
    );
    const admin = await sessionFor("aa_admin");

    const res = await reassess(admin.token, w.batch._id, dates("2027-02-01"));
    expectError(res, 409, "REASSESS_NOT_ELIGIBLE");
    expect(res.body.error.details).toEqual({ reason: "outcome", learnerIds: [] });
  });

  it("accepts another centre of the same training partner and a new language", async () => {
    await recognition();
    const w = await assessedBatch();
    const surat = await Centre.create({ name: "Surat Centre", tpId: w.tpId, state: "Gujarat" });
    const foreign = await Centre.create({ name: "Elsewhere", tpId: oid(), state: "Gujarat" });
    const admin = await sessionFor("aa_admin");

    const wrongTp = await reassess(admin.token, w.batch._id, {
      ...dates("2027-02-01"),
      centreId: String(foreign._id),
    });
    expectError(wrongTp, 400, "VALIDATION_ERROR");

    const res = await reassess(admin.token, w.batch._id, {
      ...dates("2027-02-01"),
      centreId: String(surat._id),
      assessmentLanguage: "Gujarati",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      centreId: String(surat._id),
      state: "Gujarat",
      assessmentLanguage: "Gujarati",
      sector: "Electronics",
      ratioClass: "manufacturing",
    });
  });

  it("runs the recognition check again, with the aa_admin override", async () => {
    await recognition({ sectors: ["Food"] });
    const w = await assessedBatch();
    const admin = await sessionFor("aa_admin");
    const reviewer = await sessionFor("ab_reviewer", { abId: w.abId });
    const reason = { recognitionOverrideReason: "NCVET extension letter on file" };

    const refused = await reassess(admin.token, w.batch._id, dates("2027-02-01"));
    expectError(refused, 409, "RULE_OUTSIDE_RECOGNITION");
    expect(refused.body.error.details.checks).toEqual(["sector"]);
    expectError(
      await reassess(reviewer.token, w.batch._id, { ...dates("2027-02-01"), ...reason }),
      409,
      "RULE_OUTSIDE_RECOGNITION",
    );

    const res = await reassess(admin.token, w.batch._id, { ...dates("2027-02-01"), ...reason });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.recognitionOverride).toMatchObject({
      reason: reason.recognitionOverrideReason,
      checks: ["sector"],
    });
    expect(await AuditLog.countDocuments({ action: "recognition_override" })).toBe(1);
  });

  it("validates the body and the id", async () => {
    await recognition();
    const w = await assessedBatch();
    const admin = await sessionFor("aa_admin");

    expectError(await reassess(admin.token, oid(), dates("2027-02-01")), 404, "NOT_FOUND");
    expectError(await reassess(admin.token, w.batch._id, {}), 400, "VALIDATION_ERROR");
    expectError(
      await reassess(admin.token, w.batch._id, dates("2027-02-02", "2027-02-01")),
      400,
      "VALIDATION_ERROR",
    );
    expectError(
      await reassess(admin.token, w.batch._id, { ...dates("2027-02-01"), sector: "Food" }),
      400,
      "VALIDATION_ERROR",
    );
    expectError(
      await request(app)
        .post(`/api/v1/batches/${w.batch._id}/reassessments`)
        .send(dates("2027-02-01")),
      401,
      "UNAUTHORIZED",
    );
  });
});
