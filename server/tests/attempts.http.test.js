import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Question } from "../src/models/question.model.js";
import { Result } from "../src/models/result.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { closeExpiredAttempts } from "../src/modules/attempts/attempt.service.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}) {
  const email = `${role}-${oid()}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: String(user._id) };
}

let seq = 0;
function makeQuestion(qualificationId, over = {}) {
  seq += 1;
  const id = oid();
  return Question.create({
    _id: id,
    rootQuestionId: id,
    qualificationId,
    nosId: "NOS-01",
    pcId: "PC-01",
    type: "mcq",
    language: "en",
    stem: `SECRET-STEM-${seq}`,
    options: [
      { key: "A", text: "SECRET-OPT-A" },
      { key: "B", text: "SECRET-OPT-B" },
    ],
    correctAnswer: "A",
    marks: 1,
    status: "approved",
    version: 1,
    isLatest: true,
    createdBy: oid(),
    ...over,
  });
}

const itemOf = (q) => ({
  questionId: q._id,
  rootQuestionId: q.rootQuestionId,
  version: q.version,
  nosId: q.nosId,
  pcId: q.pcId,
  type: q.type,
  marks: q.marks,
});

/**
 * One batch in progress with an approved paper of 6 questions, 12 marks:
 * mcq1 A (NOS-01, 1), mcq2 B (NOS-01, 1), mcq3 A (NOS-01, 1), mcq4 B (NOS-02, 1),
 * short answer (NOS-01, 3), viva (NOS-02, 5).
 */
async function world({ paper = {}, batch = {} } = {}) {
  const qualificationId = oid();
  const abId = oid();
  const assessorId = oid();
  const mcq1 = await makeQuestion(qualificationId, { correctAnswer: "A" });
  const mcq2 = await makeQuestion(qualificationId, { correctAnswer: "B" });
  const mcq3 = await makeQuestion(qualificationId, { correctAnswer: "A" });
  const mcq4 = await makeQuestion(qualificationId, { nosId: "NOS-02", correctAnswer: "B" });
  const short = await makeQuestion(qualificationId, {
    type: "short_answer",
    options: [],
    correctAnswer: "SECRET-MODEL-ANSWER",
    marks: 3,
  });
  const viva = await makeQuestion(qualificationId, {
    nosId: "NOS-02",
    type: "viva",
    options: [],
    correctAnswer: "SECRET-VIVA-GUIDE",
    marks: 5,
  });
  const questions = { mcq1, mcq2, mcq3, mcq4, short, viva };
  const testPaper = await TestPaper.create({
    qualificationId,
    status: "approved",
    seed: 1,
    rules: { language: "en", quotas: [{ nosId: "NOS-01", count: 1 }] },
    poolHash: "x",
    items: Object.values(questions).map(itemOf),
    totalMarks: 12,
    complete: true,
    createdBy: oid(),
    approvedBy: oid(),
    approvedAt: new Date(),
    ...paper,
  });
  const dbBatch = await Batch.create({
    abId,
    qualificationId,
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId: oid(),
    centreId: oid(),
    candidateCount: 2,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "English",
    state: "Maharashtra",
    status: "in_progress",
    statusVersion: 3,
    assessorId,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...batch,
  });
  const learnerId = oid();
  const otherLearnerId = oid();
  const roster = await Candidate.create({
    batchId: dbBatch._id,
    learnerId,
    name: "Asha Devi",
    active: true,
  });
  await Candidate.create({
    batchId: dbBatch._id,
    learnerId: otherLearnerId,
    name: "Bina Rao",
    active: true,
  });
  return {
    qualificationId,
    abId,
    assessorId,
    questions,
    testPaper,
    batch: dbBatch,
    learnerId,
    otherLearnerId,
    roster,
    candidate: await sessionFor("candidate", { linkedProfileId: learnerId }),
    otherCandidate: await sessionFor("candidate", { linkedProfileId: otherLearnerId }),
    assessor: await sessionFor("assessor", { linkedProfileId: assessorId }),
    reviewer: await sessionFor("ab_reviewer", { abId }),
    admin: await sessionFor("aa_admin"),
  };
}

const start = (session, w, body = {}) =>
  request(app)
    .post("/api/v1/attempts/start")
    .set(bearer(session.token))
    .send({ batchId: String(w.batch._id), testPaperId: String(w.testPaper._id), ...body });
const getAttempt = (session, id) =>
  request(app).get(`/api/v1/attempts/${id}`).set(bearer(session.token));
const putAnswers = (session, id, answers) =>
  request(app).put(`/api/v1/attempts/${id}/answers`).set(bearer(session.token)).send({ answers });
const submit = (session, id) =>
  request(app).post(`/api/v1/attempts/${id}/submit`).set(bearer(session.token)).send({});
const putMarks = (session, id, marks) =>
  request(app)
    .put(`/api/v1/attempts/${id}/manual-marks`)
    .set(bearer(session.token))
    .send({ marks });

/** Moves the clock of one attempt: seconds relative to now. */
const shift = (id, { deadline, accept }) =>
  Attempt.updateOne(
    { _id: id },
    {
      deadlineAt: new Date(Date.now() + deadline * 1000),
      acceptUntil: new Date(Date.now() + accept * 1000),
    },
  );

const qid = (w, name) => String(w.questions[name]._id);

describe("Attempt engine API (server/src/modules/attempts)", () => {
  let w;

  beforeAll(async () => {
    await startMongo();
    await Promise.all([Attempt.syncIndexes(), Candidate.syncIndexes()]);
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    w = await world();
  });

  describe("start", () => {
    it("creates one attempt, with questions but no answer keys", async () => {
      const res = await start(w.candidate, w);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        status: "in_progress",
        batchId: String(w.batch._id),
        testPaperId: String(w.testPaper._id),
        totalMarks: 12,
      });
      expect(res.body.questions).toHaveLength(6);
      expect(res.body.questions.every((q) => q.stem.startsWith("SECRET-STEM-"))).toBe(true);
      const mcq = res.body.questions.find((q) => q.questionId === qid(w, "mcq1"));
      expect(mcq.options).toEqual([
        { key: "A", text: "SECRET-OPT-A" },
        { key: "B", text: "SECRET-OPT-B" },
      ]);
      const text = JSON.stringify(res.body);
      for (const banned of [
        "correctAnswer",
        "SECRET-MODEL-ANSWER",
        "SECRET-VIVA-GUIDE",
        "scores",
      ]) {
        expect(text).not.toContain(banned);
      }
      expect(await Attempt.countDocuments()).toBe(1);
    });

    it("is idempotent: a second start returns the same attempt and keeps the timer", async () => {
      const first = await start(w.candidate, w);
      const second = await start(w.candidate, w);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.startedAt).toBe(first.body.startedAt);
      expect(second.body.deadlineAt).toBe(first.body.deadlineAt);
      expect(second.body.questions.map((q) => q.questionId)).toEqual(
        first.body.questions.map((q) => q.questionId),
      );
      expect(await Attempt.countDocuments()).toBe(1);
    });

    it("stays one attempt when two starts arrive together", async () => {
      const [a, b] = await Promise.all([start(w.candidate, w), start(w.candidate, w)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await Attempt.countDocuments()).toBe(1);
    });

    it("returns the existing attempt even after the batch has moved on", async () => {
      const first = await start(w.candidate, w);
      await Batch.updateOne({ _id: w.batch._id }, { status: "assessment_completed" });
      const again = await start(w.candidate, w);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
    });

    it("keeps the stored question order on every read", async () => {
      const first = await start(w.candidate, w);
      const ids = first.body.questions.map((q) => q.questionId);
      const stored = await Attempt.findById(first.body.id).lean();
      expect(stored.questions.map((q) => String(q.questionId))).toEqual(ids);
      const read = await getAttempt(w.candidate, first.body.id);
      expect(read.body.questions.map((q) => q.questionId)).toEqual(ids);
      expect(read.body.questions.map((q) => q.order)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("refuses a learner who is not on the roster, or is deactivated", async () => {
      const stranger = await sessionFor("candidate", { linkedProfileId: oid() });
      expectError(await start(stranger, w), 403, "FORBIDDEN");
      await Candidate.updateOne({ _id: w.roster._id }, { active: false });
      expectError(await start(w.candidate, w), 403, "FORBIDDEN");
      expect(await Attempt.countDocuments()).toBe(0);
    });

    it("refuses a batch that is not in progress", async () => {
      await Batch.updateOne({ _id: w.batch._id }, { status: "assessor_assigned" });
      const res = await start(w.candidate, w);
      expectError(res, 409, "ATTEMPT_BATCH_NOT_IN_PROGRESS");
    });

    it("treats a draft paper, an unknown paper and a paper of another qualification as not found", async () => {
      await TestPaper.updateOne({ _id: w.testPaper._id }, { status: "draft" });
      expectError(await start(w.candidate, w), 404, "NOT_FOUND");
      await TestPaper.updateOne({ _id: w.testPaper._id }, { status: "approved" });
      expectError(await start(w.candidate, w, { testPaperId: String(oid()) }), 404, "NOT_FOUND");
      const foreign = await world();
      const res = await start(w.candidate, w, { testPaperId: String(foreign.testPaper._id) });
      expectError(res, 404, "NOT_FOUND");
      expectError(await start(w.candidate, w, { batchId: String(oid()) }), 404, "NOT_FOUND");
      expect(await Attempt.countDocuments()).toBe(0);
    });

    it("refuses an incomplete paper", async () => {
      await TestPaper.updateOne({ _id: w.testPaper._id }, { complete: false });
      expectError(await start(w.candidate, w), 404, "NOT_FOUND");
    });

    it("rejects unknown keys, bad ids and national id keys", async () => {
      expectError(await start(w.candidate, w, { extra: 1 }), 400, "VALIDATION_ERROR");
      expectError(await start(w.candidate, w, { batchId: "nope" }), 400, "VALIDATION_ERROR");
      expectError(
        await start(w.candidate, w, { aadhaar: "123412341234" }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("is for candidates only", async () => {
      for (const s of [w.assessor, w.admin, w.reviewer]) {
        expectError(await start(s, w), 403, "FORBIDDEN");
      }
      const res = await request(app).post("/api/v1/attempts/start").send({});
      expect(res.status).toBe(401);
    });

    it("records the start in the audit log without question text", async () => {
      const res = await start(w.candidate, w);
      await start(w.candidate, w);
      const rows = await AuditLog.find({ entity: "attempt", action: /^attempt\.start/ }).lean();
      expect(rows.map((r) => r.action).sort()).toEqual(["attempt.start", "attempt.start_replay"]);
      const row = rows.find((r) => r.action === "attempt.start");
      expect(String(row.entityId)).toBe(res.body.id);
      expect(String(row.batchId)).toBe(String(w.batch._id));
      expect(String(row.abId)).toBe(String(w.abId));
      expect(row.after).toMatchObject({
        status: "in_progress",
        questionCount: 6,
        answeredCount: 0,
      });
      expect(JSON.stringify(rows)).not.toContain("SECRET");
    });
  });

  describe("timer and grace", () => {
    it("takes the duration from the paper", async () => {
      await TestPaper.updateOne({ _id: w.testPaper._id }, { durationMinutes: 10 });
      const res = await start(w.candidate, w);
      const ms = new Date(res.body.deadlineAt) - new Date(res.body.startedAt);
      expect(ms).toBe(10 * 60_000);
      expect(res.body.durationMinutes).toBe(10);
      expect(res.body.remainingSeconds).toBeGreaterThan(590);
      expect(res.body.remainingSeconds).toBeLessThanOrEqual(600);
      const stored = await Attempt.findById(res.body.id).lean();
      expect(stored.acceptUntil - stored.deadlineAt).toBe(compliance.ATTEMPT_GRACE_SECONDS * 1000);
    });

    it("uses the default duration when the paper gives none", async () => {
      const res = await start(w.candidate, w);
      expect(res.body.durationMinutes).toBe(compliance.ATTEMPT_DEFAULT_DURATION_MINUTES);
    });

    it("accepts a save after the deadline but inside the grace", async () => {
      const { body } = await start(w.candidate, w);
      await shift(body.id, { deadline: -5, accept: 20 });
      const res = await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "A" },
      ]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.remainingSeconds).toBe(0);
    });

    it("refuses a save after the grace, closes the attempt and audits the timeout", async () => {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [{ questionId: qid(w, "mcq1"), answer: "A" }]);
      await shift(body.id, { deadline: -60, accept: -30 });
      const res = await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq2"), answer: "B" },
      ]);
      expectError(res, 409, "ATTEMPT_TIME_UP");
      const stored = await Attempt.findById(body.id).lean();
      expect(stored).toMatchObject({ status: "timed_out", closeReason: "timeout" });
      // The late answer was not kept; the earlier one was scored.
      expect(
        stored.questions.find((q) => String(q.questionId) === qid(w, "mcq2")).answer,
      ).toBeNull();
      expect(stored.scores.obtainedMarks).toBe(1);
      const rows = await AuditLog.find({ action: "attempt.timeout" }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorRole: "system", entity: "attempt" });
      expect(String(rows[0].batchId)).toBe(String(w.batch._id));
      expect(rows[0].after).toMatchObject({ status: "timed_out", closeReason: "timeout" });
      expect(rows[0].meta.trigger).toBe("answers");
    });

    it("closes an expired attempt on read and writes the timeout once", async () => {
      const { body } = await start(w.candidate, w);
      await shift(body.id, { deadline: -60, accept: -30 });
      const first = await getAttempt(w.candidate, body.id);
      expect(first.body).toMatchObject({ status: "timed_out", closeReason: "timeout" });
      await getAttempt(w.candidate, body.id);
      expect(await AuditLog.countDocuments({ action: "attempt.timeout" })).toBe(1);
    });

    it("scores what was saved when a submit arrives after the grace", async () => {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "A" },
        { questionId: qid(w, "mcq2"), answer: "B" },
      ]);
      await shift(body.id, { deadline: -60, accept: -30 });
      const res = await submit(w.candidate, body.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "timed_out", closeReason: "timeout" });
      const stored = await Attempt.findById(body.id).lean();
      expect(stored.scores.obtainedMarks).toBe(2);
      const actions = (await AuditLog.find({ entity: "attempt" }).lean()).map((r) => r.action);
      expect(actions).toContain("attempt.timeout");
      expect(actions).toContain("attempt.submit_late");
      expect(actions).not.toContain("attempt.submit");
    });

    it("a sweep closes every expired attempt and leaves live ones", async () => {
      const a = await start(w.candidate, w);
      const b = await start(w.otherCandidate, w);
      await shift(a.body.id, { deadline: -60, accept: -30 });
      const out = await closeExpiredAttempts();
      expect(out.closed).toBe(1);
      expect((await Attempt.findById(a.body.id).lean()).status).toBe("timed_out");
      expect((await Attempt.findById(b.body.id).lean()).status).toBe("in_progress");
      expect((await closeExpiredAttempts()).closed).toBe(0);
      expect(await AuditLog.countDocuments({ action: "attempt.timeout" })).toBe(1);
    });
  });

  describe("answers", () => {
    it("saves, and the last write wins per question", async () => {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "B" },
        { questionId: qid(w, "short"), answer: "first draft" },
      ]);
      const res = await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "a" },
        { questionId: qid(w, "short"), answer: "  second draft " },
      ]);
      expect(res.status).toBe(200);
      expect(res.body.saved).toBe(2);
      const read = await getAttempt(w.candidate, body.id);
      const by = (name) => read.body.questions.find((q) => q.questionId === qid(w, name));
      expect(by("mcq1").answer).toBe("A");
      expect(by("short").answer).toBe("second draft");
      expect(by("mcq2").answer).toBeNull();
    });

    it("clears an answer with null or an empty string", async () => {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [{ questionId: qid(w, "mcq1"), answer: "A" }]);
      await putAnswers(w.candidate, body.id, [{ questionId: qid(w, "mcq1"), answer: null }]);
      let stored = await Attempt.findById(body.id).lean();
      expect(
        stored.questions.find((q) => String(q.questionId) === qid(w, "mcq1")).answer,
      ).toBeNull();
      await putAnswers(w.candidate, body.id, [{ questionId: qid(w, "short"), answer: "x" }]);
      await putAnswers(w.candidate, body.id, [{ questionId: qid(w, "short"), answer: "  " }]);
      stored = await Attempt.findById(body.id).lean();
      expect(
        stored.questions.find((q) => String(q.questionId) === qid(w, "short")).answer,
      ).toBeNull();
    });

    it("refuses an option the question does not have, and a question outside the attempt", async () => {
      const { body } = await start(w.candidate, w);
      const badOption = await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "Z" },
      ]);
      expectError(badOption, 400, "VALIDATION_ERROR");
      const stranger = await putAnswers(w.candidate, body.id, [
        { questionId: String(oid()), answer: "A" },
      ]);
      expectError(stranger, 400, "VALIDATION_ERROR");
      // One bad row saves nothing.
      const mixed = await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq2"), answer: "B" },
        { questionId: qid(w, "mcq1"), answer: "Z" },
      ]);
      expectError(mixed, 400, "VALIDATION_ERROR");
      const stored = await Attempt.findById(body.id).lean();
      expect(stored.questions.every((q) => q.answer === null)).toBe(true);
    });

    it("rejects bad bodies: unknown keys, duplicates, empty and over-long answers", async () => {
      const { body } = await start(w.candidate, w);
      const one = { questionId: qid(w, "mcq1"), answer: "A" };
      expectError(await putAnswers(w.candidate, body.id, []), 400, "VALIDATION_ERROR");
      expectError(await putAnswers(w.candidate, body.id, [one, one]), 400, "VALIDATION_ERROR");
      expectError(
        await putAnswers(w.candidate, body.id, [{ ...one, marks: 5 }]),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await putAnswers(w.candidate, body.id, [
          { questionId: qid(w, "short"), answer: "x".repeat(10001) },
        ]),
        400,
        "VALIDATION_ERROR",
      );
      const extra = await request(app)
        .put(`/api/v1/attempts/${body.id}/answers`)
        .set(bearer(w.candidate.token))
        .send({ answers: [one], extra: true });
      expectError(extra, 400, "VALIDATION_ERROR");
    });

    it("refuses a save once the attempt is submitted", async () => {
      const { body } = await start(w.candidate, w);
      await submit(w.candidate, body.id);
      const res = await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "A" },
      ]);
      expectError(res, 409, "ATTEMPT_CLOSED");
    });

    it("keeps answer text out of the audit log", async () => {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "short"), answer: "SECRET-CANDIDATE-ANSWER" },
      ]);
      const rows = await AuditLog.find({ action: "attempt.answers_save" }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].meta).toEqual({ savedCount: 1 });
      expect(JSON.stringify(await AuditLog.find().lean())).not.toContain("SECRET");
    });

    it("is for the candidate who owns the attempt", async () => {
      const { body } = await start(w.candidate, w);
      const one = [{ questionId: qid(w, "mcq1"), answer: "A" }];
      expectError(await putAnswers(w.otherCandidate, body.id, one), 403, "FORBIDDEN");
      expectError(await putAnswers(w.assessor, body.id, one), 403, "FORBIDDEN");
      expectError(await putAnswers(w.admin, body.id, one), 403, "FORBIDDEN");
      expectError(await putAnswers(w.candidate, String(oid()), one), 404, "NOT_FOUND");
    });
  });

  describe("submit and scoring", () => {
    async function submitted() {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "A" }, // right
        { questionId: qid(w, "mcq2"), answer: "A" }, // wrong
        // mcq3 left blank
        { questionId: qid(w, "mcq4"), answer: "b" }, // right, other NOS
        { questionId: qid(w, "short"), answer: "SECRET-CANDIDATE-ANSWER" },
      ]);
      const res = await submit(w.candidate, body.id);
      return { id: body.id, res };
    }

    it("scores MCQ on the server and leaves the rest for manual marking", async () => {
      const { id, res } = await submitted();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ id, status: "submitted", closeReason: "submit" });
      const stored = await Attempt.findById(id).lean();
      expect(stored.scores).toMatchObject({
        maxMarks: 12,
        obtainedMarks: 2,
        pendingMarks: 8,
        pendingCount: 2,
        complete: false,
      });
      const per = (name) => stored.questions.find((q) => String(q.questionId) === qid(w, name));
      expect(per("mcq1")).toMatchObject({
        awardedMarks: 1,
        scoreStatus: "scored",
        scoredBy: "auto",
      });
      expect(per("mcq2")).toMatchObject({ awardedMarks: 0, scoreStatus: "scored" });
      expect(per("mcq3")).toMatchObject({ awardedMarks: 0, scoreStatus: "scored" });
      expect(per("mcq4")).toMatchObject({ awardedMarks: 1, scoreStatus: "scored" });
      expect(per("short")).toMatchObject({ awardedMarks: null, scoreStatus: "pending" });
      expect(per("viva")).toMatchObject({ awardedMarks: null, scoreStatus: "pending" });
      const nos = Object.fromEntries(stored.scores.byNos.map((g) => [g.key, g]));
      expect(nos["NOS-01"]).toMatchObject({ maxMarks: 6, obtainedMarks: 1, pendingMarks: 3 });
      expect(nos["NOS-02"]).toMatchObject({ maxMarks: 6, obtainedMarks: 1, pendingMarks: 5 });
    });

    it("never tells the candidate marks or the key", async () => {
      const { id, res } = await submitted();
      const read = await getAttempt(w.candidate, id);
      for (const text of [JSON.stringify(res.body), JSON.stringify(read.body)]) {
        for (const banned of [
          "correctAnswer",
          "SECRET-MODEL-ANSWER",
          "SECRET-VIVA-GUIDE",
          "awardedMarks",
          "scores",
          "obtainedMarks",
        ]) {
          expect(text).not.toContain(banned);
        }
      }
      expect(read.body.status).toBe("submitted");
      expect(read.body.questions.find((q) => q.questionId === qid(w, "short")).answer).toBe(
        "SECRET-CANDIDATE-ANSWER",
      );
    });

    it("is idempotent: a second submit returns the same state and scores once", async () => {
      const { id, res } = await submitted();
      const again = await submit(w.candidate, id);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(res.body);
      const actions = (await AuditLog.find({ entity: "attempt" }).lean()).map((r) => r.action);
      expect(actions.filter((a) => a === "attempt.submit")).toHaveLength(1);
      expect(actions.filter((a) => a === "attempt.submit_replay")).toHaveLength(1);
    });

    it("audits the submit with counts and totals only", async () => {
      const { id } = await submitted();
      const row = await AuditLog.findOne({ action: "attempt.submit" }).lean();
      expect(String(row.entityId)).toBe(id);
      expect(row.after).toMatchObject({
        status: "submitted",
        answeredCount: 4,
        scores: { maxMarks: 12, obtainedMarks: 2, pendingCount: 2, complete: false },
      });
      expect(JSON.stringify(await AuditLog.find().lean())).not.toContain("SECRET");
    });

    it("a submit with nothing answered still scores zero", async () => {
      const { body } = await start(w.candidate, w);
      await submit(w.candidate, body.id);
      const stored = await Attempt.findById(body.id).lean();
      expect(stored.scores).toMatchObject({ obtainedMarks: 0, pendingCount: 2 });
    });

    it("is for the owner only", async () => {
      const { body } = await start(w.candidate, w);
      expectError(await submit(w.otherCandidate, body.id), 403, "FORBIDDEN");
      expectError(await submit(w.assessor, body.id), 403, "FORBIDDEN");
      expect((await Attempt.findById(body.id).lean()).status).toBe("in_progress");
    });

    it("does not write into results", async () => {
      await submitted();
      expect(await Result.countDocuments()).toBe(0);
    });
  });

  describe("manual marking", () => {
    async function closed() {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "A" },
        { questionId: qid(w, "short"), answer: "SECRET-CANDIDATE-ANSWER" },
      ]);
      await submit(w.candidate, body.id);
      return body.id;
    }

    it("lets the batch assessor mark pending questions and updates the totals", async () => {
      const id = await closed();
      const res = await putMarks(w.assessor, id, [
        { questionId: qid(w, "short"), marks: 2.5 },
        { questionId: qid(w, "viva"), marks: 5 },
      ]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.scores).toMatchObject({
        maxMarks: 12,
        obtainedMarks: 8.5,
        pendingCount: 0,
        complete: true,
      });
      const short = res.body.questions.find((q) => q.questionId === qid(w, "short"));
      expect(short).toMatchObject({
        awardedMarks: 2.5,
        scoreStatus: "scored",
        scoredBy: "manual",
        markedBy: w.assessor.userId,
      });
      expect(short.markedAt).toBeTruthy();
    });

    it("lets aa_admin mark, and a later mark replaces the earlier one", async () => {
      const id = await closed();
      await putMarks(w.admin, id, [{ questionId: qid(w, "viva"), marks: 1 }]);
      const res = await putMarks(w.admin, id, [{ questionId: qid(w, "viva"), marks: 4 }]);
      expect(res.status).toBe(200);
      expect(res.body.scores.obtainedMarks).toBe(5);
      expect(res.body.scores.pendingCount).toBe(1);
    });

    it("accepts marks at the ceiling and zero, and refuses marks above it", async () => {
      const id = await closed();
      const over = await putMarks(w.assessor, id, [
        { questionId: qid(w, "short"), marks: 3.5 },
        { questionId: qid(w, "viva"), marks: 5 },
      ]);
      expectError(over, 400, "ATTEMPT_MARKS_EXCEED_CEILING");
      expect(over.body.error.details.exceeded).toEqual([
        { questionId: qid(w, "short"), maxMarks: 3, marks: 3.5 },
      ]);
      // Nothing from the refused request was kept.
      const stored = await Attempt.findById(id).lean();
      expect(stored.scores.pendingCount).toBe(2);
      const ok = await putMarks(w.assessor, id, [
        { questionId: qid(w, "short"), marks: 3 },
        { questionId: qid(w, "viva"), marks: 0 },
      ]);
      expect(ok.status).toBe(200);
      expect(ok.body.scores.obtainedMarks).toBe(4);
    });

    it("refuses negative, over-precise and malformed marks", async () => {
      const id = await closed();
      for (const marks of [-1, 1.234, "3", null]) {
        const res = await putMarks(w.assessor, id, [{ questionId: qid(w, "short"), marks }]);
        expectError(res, 400, "VALIDATION_ERROR");
      }
      expectError(await putMarks(w.assessor, id, []), 400, "VALIDATION_ERROR");
      const dup = await putMarks(w.assessor, id, [
        { questionId: qid(w, "short"), marks: 1 },
        { questionId: qid(w, "short"), marks: 2 },
      ]);
      expectError(dup, 400, "VALIDATION_ERROR");
      const extra = await request(app)
        .put(`/api/v1/attempts/${id}/manual-marks`)
        .set(bearer(w.assessor.token))
        .send({ marks: [{ questionId: qid(w, "short"), marks: 1, remark: "x" }] });
      expectError(extra, 400, "VALIDATION_ERROR");
    });

    it("will not override a question the server scored, or take an unknown question", async () => {
      const id = await closed();
      const auto = await putMarks(w.assessor, id, [{ questionId: qid(w, "mcq1"), marks: 0 }]);
      expectError(auto, 400, "ATTEMPT_QUESTION_AUTO_SCORED");
      const unknown = await putMarks(w.assessor, id, [{ questionId: String(oid()), marks: 0 }]);
      expectError(unknown, 400, "VALIDATION_ERROR");
      const stored = await Attempt.findById(id).lean();
      expect(stored.scores.obtainedMarks).toBe(1);
    });

    it("waits until the attempt is closed", async () => {
      const { body } = await start(w.candidate, w);
      const res = await putMarks(w.assessor, body.id, [{ questionId: qid(w, "short"), marks: 1 }]);
      expectError(res, 409, "ATTEMPT_NOT_CLOSED");
    });

    it("marks a timed-out attempt", async () => {
      const { body } = await start(w.candidate, w);
      await shift(body.id, { deadline: -60, accept: -30 });
      const res = await putMarks(w.assessor, body.id, [{ questionId: qid(w, "viva"), marks: 2 }]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe("timed_out");
    });

    it("is refused for the wrong assessor, the candidate, the reviewer and other roles", async () => {
      const id = await closed();
      const marks = [{ questionId: qid(w, "short"), marks: 1 }];
      const otherAssessor = await sessionFor("assessor", { linkedProfileId: oid() });
      expectError(await putMarks(otherAssessor, id, marks), 403, "FORBIDDEN");
      expectError(await putMarks(w.candidate, id, marks), 403, "FORBIDDEN");
      expectError(await putMarks(w.reviewer, id, marks), 403, "FORBIDDEN");
      for (const role of ["sme", "tp", "mis", "proctor", "ncvet_viewer"]) {
        expectError(await putMarks(await sessionFor(role), id, marks), 403, "FORBIDDEN");
      }
      expect((await Attempt.findById(id).lean()).scores.pendingCount).toBe(2);
    });

    it("audits before and after, with ids and numbers only", async () => {
      const id = await closed();
      await putMarks(w.assessor, id, [{ questionId: qid(w, "short"), marks: 2 }]);
      const row = await AuditLog.findOne({ action: "attempt.manual_marks" }).lean();
      expect(row.actorRole).toBe("assessor");
      expect(String(row.abId)).toBe(String(w.abId));
      expect(row.before.marks).toEqual([{ questionId: qid(w, "short"), awardedMarks: null }]);
      expect(row.after.marks).toEqual([{ questionId: qid(w, "short"), awardedMarks: 2 }]);
      expect(row.before.scores.pendingCount).toBe(2);
      expect(row.after.scores.pendingCount).toBe(1);
      expect(JSON.stringify(await AuditLog.find().lean())).not.toContain("SECRET");
    });
  });

  describe("reads and privacy", () => {
    it("shows the candidate only their own attempt", async () => {
      const { body } = await start(w.candidate, w);
      expect((await getAttempt(w.candidate, body.id)).status).toBe(200);
      expectError(await getAttempt(w.otherCandidate, body.id), 403, "FORBIDDEN");
      const stranger = await sessionFor("candidate", { linkedProfileId: oid() });
      expectError(await getAttempt(stranger, body.id), 403, "FORBIDDEN");
      const noProfile = await sessionFor("candidate");
      expectError(await getAttempt(noProfile, body.id), 403, "FORBIDDEN");
    });

    it("keeps the answer key from everyone while the attempt is open", async () => {
      const { body } = await start(w.candidate, w);
      for (const s of [w.assessor, w.admin, w.reviewer]) {
        const res = await getAttempt(s, body.id);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain("correctAnswer");
        expect(JSON.stringify(res.body)).not.toContain("SECRET-MODEL-ANSWER");
      }
    });

    it("shows staff the key and marks after the attempt closes, and never the candidate", async () => {
      const { body } = await start(w.candidate, w);
      await submit(w.candidate, body.id);
      const staff = await getAttempt(w.assessor, body.id);
      const short = staff.body.questions.find((q) => q.questionId === qid(w, "short"));
      expect(short).toMatchObject({
        correctAnswer: "SECRET-MODEL-ANSWER",
        nosId: "NOS-01",
        scoreStatus: "pending",
      });
      expect(staff.body.candidateName).toBe("Asha Devi");
      expect(staff.body.scores.maxMarks).toBe(12);
      const own = await getAttempt(w.candidate, body.id);
      expect(JSON.stringify(own.body)).not.toContain("correctAnswer");
    });

    it("limits staff to their own batch or awarding body", async () => {
      const { body } = await start(w.candidate, w);
      const otherAssessor = await sessionFor("assessor", { linkedProfileId: oid() });
      const otherReviewer = await sessionFor("ab_reviewer", { abId: oid() });
      const noAb = await sessionFor("ab_reviewer");
      expectError(await getAttempt(otherAssessor, body.id), 403, "FORBIDDEN");
      expectError(await getAttempt(otherReviewer, body.id), 403, "FORBIDDEN");
      expectError(await getAttempt(noAb, body.id), 403, "FORBIDDEN");
      for (const role of ["sme", "tp", "mis", "proctor", "ncvet_viewer"]) {
        expectError(await getAttempt(await sessionFor(role), body.id), 403, "FORBIDDEN");
      }
      expect((await request(app).get(`/api/v1/attempts/${body.id}`)).status).toBe(401);
    });

    it("rejects a malformed id and an unknown id", async () => {
      expectError(await getAttempt(w.admin, "nope"), 400, "VALIDATION_ERROR");
      expectError(await getAttempt(w.admin, String(oid())), 404, "NOT_FOUND");
    });
  });

  describe("list", () => {
    let mine;
    let theirs;
    beforeEach(async () => {
      mine = (await start(w.candidate, w)).body;
      await start(w.otherCandidate, w);
      const foreign = await world();
      theirs = (await start(foreign.candidate, foreign)).body;
      await submit(w.candidate, mine.id);
    });

    const list = (session, query = "") =>
      request(app).get(`/api/v1/attempts${query}`).set(bearer(session.token));

    it("gives aa_admin every attempt, without questions or answers", async () => {
      const res = await list(w.admin);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items).toHaveLength(3);
      const row = res.body.items.find((r) => r.id === mine.id);
      expect(row).toMatchObject({
        status: "submitted",
        batchId: String(w.batch._id),
        maxMarks: 12,
        obtainedMarks: 0,
        pendingCount: 2,
        scoringComplete: false,
      });
      expect(row.questions).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("SECRET");
    });

    it("limits the assessor to their own batches", async () => {
      const res = await list(w.assessor);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map((r) => r.id)).not.toContain(theirs.id);
      const other = await list(w.assessor, `?batchId=${theirs.batchId}`);
      expect(other.body.items).toEqual([]);
    });

    it("limits the reviewer to their own awarding body", async () => {
      const res = await list(w.reviewer);
      expect(res.body.total).toBe(2);
      expect(res.body.items.every((r) => r.abId === String(w.abId))).toBe(true);
      const noAb = await list(await sessionFor("ab_reviewer"));
      expect(noAb.body.items).toEqual([]);
    });

    it("filters and pages", async () => {
      const done = await list(w.admin, "?status=submitted");
      expect(done.body.items.map((r) => r.id)).toEqual([mine.id]);
      const paper = await list(w.admin, `?testPaperId=${w.testPaper._id}`);
      expect(paper.body.total).toBe(2);
      const page = await list(w.admin, "?pageSize=2&page=2");
      expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.body.items).toHaveLength(1);
      expectError(await list(w.admin, "?bogus=1"), 400, "VALIDATION_ERROR");
      expectError(await list(w.admin, "?status=weird"), 400, "VALIDATION_ERROR");
    });

    it("refuses the candidate and the other roles", async () => {
      expectError(await list(w.candidate), 403, "FORBIDDEN");
      for (const role of ["sme", "tp", "mis", "proctor", "ncvet_viewer"]) {
        expectError(await list(await sessionFor(role)), 403, "FORBIDDEN");
      }
      expect((await request(app).get("/api/v1/attempts")).status).toBe(401);
    });
  });

  describe("summary for aa_admin", () => {
    const summary = (session, id) =>
      request(app).get(`/api/v1/attempts/${id}/summary`).set(bearer(session.token));

    it("reads totals per NOS and type, and writes nothing", async () => {
      const { body } = await start(w.candidate, w);
      await putAnswers(w.candidate, body.id, [
        { questionId: qid(w, "mcq1"), answer: "A" },
        { questionId: qid(w, "mcq4"), answer: "B" },
      ]);
      await submit(w.candidate, body.id);
      await putMarks(w.assessor, body.id, [{ questionId: qid(w, "viva"), marks: 4 }]);
      const before = await Attempt.findById(body.id).lean();
      const res = await summary(w.admin, body.id);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        attemptId: body.id,
        batchId: String(w.batch._id),
        status: "submitted",
        scoringComplete: false,
        maxMarks: 12,
        obtainedMarks: 6,
        pendingMarks: 3,
        pendingCount: 1,
      });
      expect(res.body.byNos).toEqual([
        { nosId: "NOS-01", maxMarks: 6, obtainedMarks: 1, pendingMarks: 3, pendingCount: 1 },
        { nosId: "NOS-02", maxMarks: 6, obtainedMarks: 5, pendingMarks: 0, pendingCount: 0 },
      ]);
      expect(res.body.byType.find((g) => g.type === "mcq")).toMatchObject({
        maxMarks: 4,
        obtainedMarks: 2,
      });
      expect(JSON.stringify(res.body)).not.toContain("SECRET");
      const after = await Attempt.findById(body.id).lean();
      expect(after.rev).toBe(before.rev);
      expect(await Result.countDocuments()).toBe(0);
    });

    it("waits for the attempt to close, and is for aa_admin only", async () => {
      const { body } = await start(w.candidate, w);
      expectError(await summary(w.admin, body.id), 409, "ATTEMPT_NOT_CLOSED");
      await submit(w.candidate, body.id);
      for (const s of [w.assessor, w.reviewer, w.candidate]) {
        expectError(await summary(s, body.id), 403, "FORBIDDEN");
      }
      expect((await summary(w.admin, body.id)).status).toBe(200);
    });
  });

  describe("two writers at once", () => {
    it("never loses an answer saved while the attempt is being closed", async () => {
      const { body } = await start(w.candidate, w);
      await Promise.all([
        putAnswers(w.candidate, body.id, [{ questionId: qid(w, "mcq1"), answer: "A" }]),
        submit(w.candidate, body.id),
      ]);
      const stored = await Attempt.findById(body.id).lean();
      expect(stored.status).toBe("submitted");
      const answered = stored.questions.find((q) => String(q.questionId) === qid(w, "mcq1"));
      // The save either landed before the close (and was scored) or was refused.
      expect(stored.scores.obtainedMarks).toBe(answered.awardedMarks);
    });
  });
});
