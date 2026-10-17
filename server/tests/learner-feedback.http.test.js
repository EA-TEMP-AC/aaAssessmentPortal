import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { LEARNER_FEEDBACK_STATUSES } from "../src/modules/batches/learner-feedback.service.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();

const abId = oid();
const otherAbId = oid();
const tpId = oid();
const assessorProfile = oid();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}) {
  const email = `${role}-${new mongoose.Types.ObjectId()}@aa.example`;
  const { password } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function makeBatch(overrides = {}) {
  const _id = oid();
  return Batch.create({
    _id,
    abId,
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId,
    centreId: oid(),
    candidateCount: 3,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Marathi",
    state: "Maharashtra",
    status: "assessment_completed",
    statusVersion: 5,
    isReassessment: false,
    firstAssessmentBatchId: _id,
    assessorId: assessorProfile,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...overrides,
  });
}

const put = (token, id, body) =>
  request(app).put(`/api/v1/batches/${id}/learner-feedback`).set(bearer(token)).send(body);
const get = (token, id) =>
  request(app).get(`/api/v1/batches/${id}/learner-feedback`).set(bearer(token));

describe("learner feedback", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([Batch.syncIndexes(), AuditLog.syncIndexes()]);
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  describe("PUT", () => {
    it("records collected feedback without changing the status", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      const res = await put(admin.token, batch._id, {
        collected: true,
        note: "Forms returned by all learners",
        collectedOn: "2026-11-21",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe("assessment_completed");
      expect(res.body.statusVersion).toBe(5);
      expect(res.body.learnerFeedback).toMatchObject({
        collected: true,
        reason: null,
        note: "Forms returned by all learners",
        collectedOn: "2026-11-21",
        recordedBy: admin.userId,
      });
      const stored = await Batch.findById(batch._id).lean();
      expect(stored.status).toBe("assessment_completed");
      expect(stored.learnerFeedback.collected).toBe(true);
    });

    it("is refused with BATCH_FEATURE_OFF when the batch switches student feedback off (X-30)", async () => {
      const batch = await makeBatch();
      await Batch.updateOne({ _id: batch._id }, { $set: { settings: { studentFeedback: false } } });
      const admin = await sessionFor("aa_admin");
      expectError(await put(admin.token, batch._id, { collected: true }), 409, "BATCH_FEATURE_OFF");
      expect((await Batch.findById(batch._id).lean()).learnerFeedback).toBeNull();
    });

    it("lets mis write", async () => {
      const batch = await makeBatch();
      const mis = await sessionFor("mis");
      const res = await put(mis.token, batch._id, { collected: false, reason: "No forms issued" });
      expect(res.status).toBe(200);
      expect(res.body.learnerFeedback).toMatchObject({
        collected: false,
        reason: "No forms issued",
        collectedOn: null,
      });
    });

    it("requires a reason when not collected", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      for (const body of [
        { collected: false },
        { collected: false, reason: "   " },
        { collected: false, reason: null },
        { collected: false, reason: "x".repeat(2001) },
      ]) {
        expectError(await put(admin.token, batch._id, body), 400, "VALIDATION_ERROR");
      }
      const res = await put(admin.token, batch._id, { collected: false });
      expect(res.body.error.details.reason).toBeDefined();
      expect((await Batch.findById(batch._id).lean()).learnerFeedback).toBeNull();
    });

    it("refuses a reason or date that contradicts collected", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      expectError(
        await put(admin.token, batch._id, { collected: true, reason: "n/a" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await put(admin.token, batch._id, {
          collected: false,
          reason: "None",
          collectedOn: "2026-11-21",
        }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("validates the body", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      for (const body of [
        {},
        { collected: "yes" },
        { collected: true, collectedOn: "2026-02-30" },
        { collected: true, collectedOn: "21/11/2026" },
        { collected: true, extra: 1 },
        { collected: true, note: "x".repeat(2001) },
      ]) {
        expectError(await put(admin.token, batch._id, body), 400, "VALIDATION_ERROR");
      }
    });

    it("replaces the one record on a second PUT", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      await put(admin.token, batch._id, {
        collected: true,
        note: "first",
        collectedOn: "2026-11-21",
      });
      const res = await put(admin.token, batch._id, { collected: false, reason: "Second look" });
      expect(res.status).toBe(200);
      expect(res.body.learnerFeedback).toMatchObject({
        collected: false,
        reason: "Second look",
        note: null,
        collectedOn: null,
      });
    });

    it.each(LEARNER_FEEDBACK_STATUSES)("is allowed on a %s batch", async (status) => {
      const batch = await makeBatch({ status });
      const admin = await sessionFor("aa_admin");
      const res = await put(admin.token, batch._id, { collected: true });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    });

    it.each(["allocated", "accepted", "rejected", "assessor_assigned", "in_progress", "cancelled"])(
      "is refused on a %s batch",
      async (status) => {
        const batch = await makeBatch({ status });
        const admin = await sessionFor("aa_admin");
        expectError(
          await put(admin.token, batch._id, { collected: true }),
          409,
          "INVALID_TRANSITION",
        );
        expect((await Batch.findById(batch._id).lean()).learnerFeedback).toBeNull();
      },
    );

    it("refuses every other role", async () => {
      const batch = await makeBatch();
      const sessions = [
        await sessionFor("ab_reviewer", { abId }),
        await sessionFor("ncvet_viewer"),
        await sessionFor("tp", { tpId }),
        await sessionFor("assessor", { linkedProfileId: assessorProfile }),
        await sessionFor("proctor", { linkedProfileId: oid() }),
        await sessionFor("candidate", { linkedProfileId: oid() }),
        await sessionFor("sme"),
      ];
      for (const s of sessions) {
        expectError(await put(s.token, batch._id, { collected: true }), 403, "FORBIDDEN");
      }
      expect((await Batch.findById(batch._id).lean()).learnerFeedback).toBeNull();
    });

    it("requires a token, and answers 404 or 400 for an unknown or malformed id", async () => {
      const batch = await makeBatch();
      const res = await request(app)
        .put(`/api/v1/batches/${batch._id}/learner-feedback`)
        .send({ collected: true });
      expect(res.status).toBe(401);
      const admin = await sessionFor("aa_admin");
      expectError(await put(admin.token, oid(), { collected: true }), 404, "NOT_FOUND");
      expectError(await put(admin.token, "nope", { collected: true }), 400, "VALIDATION_ERROR");
    });

    it("writes one audit row per write, with before and after", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      await put(admin.token, batch._id, { collected: true, note: "n1" });
      await put(admin.token, batch._id, { collected: false, reason: "r2" });
      const rows = await AuditLog.find({ action: "batch.learner_feedback" })
        .sort({ createdAt: 1 })
        .lean();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        entity: "batch",
        entityId: String(batch._id),
        actorRole: "aa_admin",
      });
      expect(String(rows[0].batchId)).toBe(String(batch._id));
      expect(String(rows[0].abId)).toBe(String(abId));
      expect(rows[0].before.learnerFeedback).toBeNull();
      expect(rows[0].after.learnerFeedback.collected).toBe(true);
      expect(rows[1].before.learnerFeedback.note).toBe("n1");
      expect(rows[1].after.learnerFeedback).toMatchObject({ collected: false, reason: "r2" });
      expect(JSON.stringify(rows)).not.toMatch(/token|password|hash/i);
    });

    it("writes no audit row for a refused write", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      await put(admin.token, batch._id, { collected: false });
      expect(await AuditLog.countDocuments({ action: "batch.learner_feedback" })).toBe(0);
    });
  });

  describe("GET", () => {
    it("returns null before anything is recorded, and the record afterwards", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      const empty = await get(admin.token, batch._id);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ batchId: String(batch._id), learnerFeedback: null });
      await put(admin.token, batch._id, { collected: false, reason: "Absent learners" });
      const res = await get(admin.token, batch._id);
      expect(res.body.learnerFeedback).toMatchObject({
        collected: false,
        reason: "Absent learners",
        recordedBy: admin.userId,
      });
    });

    it("is readable on an earlier-status batch, as null", async () => {
      const batch = await makeBatch({ status: "accepted" });
      const mis = await sessionFor("mis");
      const res = await get(mis.token, batch._id);
      expect(res.status).toBe(200);
      expect(res.body.learnerFeedback).toBeNull();
    });

    it("follows batch scope for ab_reviewer, assessor, and proctor", async () => {
      const proctorProfile = oid();
      const batch = await makeBatch({ proctorId: proctorProfile });
      await Batch.updateOne(
        { _id: batch._id },
        {
          $set: {
            learnerFeedback: { collected: true, recordedBy: oid(), recordedAt: new Date() },
          },
        },
      );
      const own = await sessionFor("ab_reviewer", { abId });
      const other = await sessionFor("ab_reviewer", { abId: otherAbId });
      const unlinked = await sessionFor("ab_reviewer");
      const assessor = await sessionFor("assessor", { linkedProfileId: assessorProfile });
      const otherAssessor = await sessionFor("assessor", { linkedProfileId: oid() });
      const proctor = await sessionFor("proctor", { linkedProfileId: proctorProfile });
      const otherProctor = await sessionFor("proctor", { linkedProfileId: oid() });

      for (const s of [own, assessor, proctor]) {
        const res = await get(s.token, batch._id);
        expect(res.status).toBe(200);
        expect(res.body.learnerFeedback.collected).toBe(true);
      }
      for (const s of [other, unlinked, otherAssessor, otherProctor]) {
        expectError(await get(s.token, batch._id), 403, "FORBIDDEN");
      }
    });

    it("lets ncvet_viewer read any batch", async () => {
      const batch = await makeBatch();
      const viewer = await sessionFor("ncvet_viewer");
      expect((await get(viewer.token, batch._id)).status).toBe(200);
    });

    it("gives candidates, training partners, and sme nothing", async () => {
      const batch = await makeBatch();
      for (const s of [
        await sessionFor("candidate", { linkedProfileId: oid() }),
        await sessionFor("tp", { tpId }),
        await sessionFor("sme"),
      ]) {
        expectError(await get(s.token, batch._id), 403, "FORBIDDEN");
      }
    });

    it("answers 404 for an unknown id", async () => {
      const admin = await sessionFor("aa_admin");
      expectError(await get(admin.token, oid()), 404, "NOT_FOUND");
    });
  });

  it("shows learnerFeedback on GET /batches/:id", async () => {
    const batch = await makeBatch();
    const admin = await sessionFor("aa_admin");
    await put(admin.token, batch._id, { collected: true });
    const res = await request(app).get(`/api/v1/batches/${batch._id}`).set(bearer(admin.token));
    expect(res.body.learnerFeedback).toMatchObject({ collected: true });
  });
});
