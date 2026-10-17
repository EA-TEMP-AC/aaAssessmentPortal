import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { defaultBatchSettings } from "../src/config/batch-settings.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { CandidateInfo } from "../src/models/candidate-info.model.js";
import { ProctoringSession } from "../src/models/proctoring-session.model.js";
import { Question } from "../src/models/question.model.js";
import { Result } from "../src/models/result.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const CAPTURED_AT = "2026-11-20T05:00:00.000Z";

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
    stem: `STEM-${seq}`,
    options: ["A", "B", "C", "D", "E", "F", "G", "H"].map((key) => ({ key, text: `OPT-${key}` })),
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

/** One batch in progress with an approved paper of 8 mcq questions (key A is right). */
async function world({ settings, tpId = oid() } = {}) {
  const qualificationId = oid();
  const abId = oid();
  const assessorId = oid();
  const proctorId = oid();
  const questions = [];
  for (let i = 0; i < 8; i += 1) questions.push(await makeQuestion(qualificationId));
  const testPaper = await TestPaper.create({
    qualificationId,
    status: "approved",
    seed: 1,
    rules: { language: "en", quotas: [{ nosId: "NOS-01", count: 8 }] },
    poolHash: "x",
    items: questions.map(itemOf),
    totalMarks: 8,
    complete: true,
    createdBy: oid(),
    approvedBy: oid(),
    approvedAt: new Date(),
  });
  const batch = await Batch.create({
    abId,
    qualificationId,
    type: "STT",
    mode: "online",
    assessmentStartDate: istCalendarDate(new Date(Date.now() - 86_400_000)),
    assessmentEndDate: istCalendarDate(new Date(Date.now() + 86_400_000)),
    tpId,
    centreId: oid(),
    candidateCount: 2,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "en",
    state: "Maharashtra",
    status: "in_progress",
    statusVersion: 3,
    assessorId,
    proctorId,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    testPaperId: testPaper._id,
    ...(settings ? { settings } : {}),
  });
  const learnerId = oid();
  const roster = await Candidate.create({ batchId: batch._id, learnerId, name: "Asha Devi" });
  return {
    questions,
    testPaper,
    batch,
    roster,
    learnerId,
    candidate: await sessionFor("candidate", { linkedProfileId: learnerId }),
    otherCandidate: await sessionFor("candidate", { linkedProfileId: oid() }),
    admin: await sessionFor("aa_admin"),
    proctor: await sessionFor("proctor", { linkedProfileId: proctorId }),
    otherProctor: await sessionFor("proctor", { linkedProfileId: oid() }),
    assessor: await sessionFor("assessor", { linkedProfileId: assessorId }),
    otherAssessor: await sessionFor("assessor", { linkedProfileId: oid() }),
    mis: await sessionFor("mis"),
    reviewer: await sessionFor("ab_reviewer", { abId }),
    tp: await sessionFor("tp", { tpId }),
    otherTp: await sessionFor("tp", { tpId: oid() }),
    ncvet: await sessionFor("ncvet_viewer"),
  };
}

const settingsUrl = (w) => `/api/v1/batches/${w.batch._id}/settings`;
const patchSettings = (who, w, body) =>
  request(app).patch(settingsUrl(w)).set(bearer(who.token)).send(body);
const getSettings = (who, w) => request(app).get(settingsUrl(w)).set(bearer(who.token));

const start = (who, w) =>
  request(app)
    .post("/api/v1/attempts/start")
    .set(bearer(who.token))
    .send({ batchId: String(w.batch._id), testPaperId: String(w.testPaper._id) });
const getAttempt = (who, id) => request(app).get(`/api/v1/attempts/${id}`).set(bearer(who.token));
const putAnswers = (who, id, answers) =>
  request(app).put(`/api/v1/attempts/${id}/answers`).set(bearer(who.token)).send({ answers });
const submit = (who, id) =>
  request(app).post(`/api/v1/attempts/${id}/submit`).set(bearer(who.token)).send({});
const startSession = (who, attemptId) =>
  request(app)
    .post("/api/v1/proctoring/sessions")
    .set(bearer(who.token))
    .send({ attemptId: String(attemptId) });
let flagSeq = 0;
const sendFlag = (who, sessionId, type) =>
  request(app)
    .post(`/api/v1/proctoring/sessions/${sessionId}/flags`)
    .set(bearer(who.token))
    .send({ clientEventId: `evt-${++flagSeq}`, type, capturedAt: CAPTURED_AT });
const unlock = (who, sessionId) =>
  request(app)
    .post(`/api/v1/proctoring/sessions/${sessionId}/unlock`)
    .set(bearer(who.token))
    .send({});

/** Starts the candidate's attempt and its proctoring session. */
async function begin(w) {
  const res = await start(w.candidate, w);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const session = await startSession(w.candidate, res.body.id);
  expect(session.status).toBe(201);
  return { attempt: res.body, sessionId: session.body.id, session: session.body };
}

describe("batch settings (B-20)", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([Batch.syncIndexes(), AuditLog.syncIndexes(), Attempt.syncIndexes()]);
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    resetLoginRateLimit();
    await clearCollections();
  });

  describe("read and write", () => {
    it("shows today's behaviour as the defaults for a batch with no stored settings", async () => {
      const w = await world();
      expect((await Batch.findById(w.batch._id).lean()).settings).toBeUndefined();
      const res = await getSettings(w.admin, w);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ batchId: String(w.batch._id), settings: defaultBatchSettings() });
      expect(res.body.settings).toMatchObject({
        shuffleQuestions: true,
        shuffleOptions: false,
        showMarksToCandidate: false,
        questionsMandatory: false,
        flagPolicy: { action: "record", pauseAfterFlags: 3, countSeverities: ["high"] },
        imageCapture: { intervalSeconds: 30, atStartAndEnd: true },
        candidateInfoPopup: { enabled: false, fields: [] },
        captureLocation: false,
      });
    });

    it("lets only aa_admin change settings; every other role gets 403", async () => {
      const w = await world();
      for (const who of [w.mis, w.tp, w.proctor, w.assessor, w.reviewer, w.ncvet, w.candidate]) {
        expectError(await patchSettings(who, w, { shuffleOptions: true }), 403, "FORBIDDEN");
      }
      expect((await Batch.findById(w.batch._id).lean()).settings).toBeUndefined();
      expect((await patchSettings(w.admin, w, { shuffleOptions: true })).status).toBe(200);
    });

    it("lets staff read settings of their own batches only; the candidate cannot read them", async () => {
      const w = await world();
      for (const who of [w.admin, w.mis, w.tp, w.proctor, w.assessor, w.reviewer, w.ncvet]) {
        expect((await getSettings(who, w)).status).toBe(200);
      }
      for (const who of [w.otherTp, w.otherProctor, w.otherAssessor]) {
        expectError(await getSettings(who, w), 403, "FORBIDDEN");
      }
      expectError(await getSettings(w.candidate, w), 403, "FORBIDDEN");
      expectError(
        await request(app).get(`/api/v1/batches/${oid()}/settings`).set(bearer(w.admin.token)),
        404,
        "NOT_FOUND",
      );
    });

    it("merges a partial change, stores the full shape and audits before and after", async () => {
      const w = await world();
      const res = await patchSettings(w.admin, w, {
        showMarksToCandidate: true,
        flagPolicy: { action: "pause" },
        imageCapture: { intervalSeconds: 45 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.settings).toMatchObject({
        showMarksToCandidate: true,
        shuffleQuestions: true,
        flagPolicy: { action: "pause", pauseAfterFlags: 3, countSeverities: ["high"] },
        imageCapture: { intervalSeconds: 45, atStartAndEnd: true },
      });
      const stored = (await Batch.findById(w.batch._id).lean()).settings;
      expect(stored.flagPolicy).toMatchObject({
        action: "pause",
        pauseAfterFlags: 3,
        countSeverities: ["high"],
      });

      const row = await AuditLog.findOne({ action: "batch.settings_update" }).lean();
      expect(row.entityId).toBe(String(w.batch._id));
      expect(String(row.batchId)).toBe(String(w.batch._id));
      expect(row.before.settings.showMarksToCandidate).toBe(false);
      expect(row.after.settings.showMarksToCandidate).toBe(true);
      expect(row.before.settings.flagPolicy.action).toBe("record");
      expect(row.after.settings.flagPolicy.action).toBe("pause");

      // A second batch is untouched.
      const other = await world();
      expect((await getSettings(other.admin, other)).body.settings).toEqual(defaultBatchSettings());
    });

    it("validates every setting and rejects unknown keys and national IDs", async () => {
      const w = await world();
      const bad = [
        {},
        { unknownKey: true },
        { shuffleQuestions: "yes" },
        { flagPolicy: { action: "ban" } },
        { flagPolicy: { pauseAfterFlags: 0 } },
        { flagPolicy: { pauseAfterFlags: 21 } },
        { flagPolicy: { pauseAfterFlags: 2.5 } },
        { flagPolicy: { countSeverities: ["medium"] } },
        { flagPolicy: { countSeverities: ["low", "high"] } },
        { flagPolicy: { countSeverities: [] } },
        { flagPolicy: { countSeverities: ["high", "high"] } },
        { flagPolicy: { somethingElse: 1 } },
        { imageCapture: { intervalSeconds: 9 } },
        { imageCapture: { intervalSeconds: 121 } },
        { imageCapture: { intervalSeconds: 30.5 } },
        { imageCapture: { atStartAndEnd: "no" } },
        { candidateInfoPopup: { fields: ["aadhaar"] } },
        { candidateInfoPopup: { fields: ["pan"] } },
        { candidateInfoPopup: { fields: ["email", "email"] } },
        { candidateInfoPopup: { enabled: true } },
        { candidateInfoPopup: { enabled: true, fields: [] } },
        { captureLocation: 1 },
        { aadhaar: "123412341234" },
        { candidateInfoPopup: { enabled: false, voterId: "ABC1234567" } },
      ];
      for (const body of bad) {
        const res = await patchSettings(w.admin, w, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.error.code, JSON.stringify(body)).toBe("VALIDATION_ERROR");
      }
      expect((await Batch.findById(w.batch._id).lean()).settings).toBeUndefined();
      expect(await AuditLog.countDocuments({ action: "batch.settings_update" })).toBe(0);

      const ok = await patchSettings(w.admin, w, {
        flagPolicy: { countSeverities: ["high", "medium"], pauseAfterFlags: 20, action: "pause" },
        imageCapture: { intervalSeconds: 10 },
        candidateInfoPopup: { enabled: true, fields: ["gender", "email"] },
        captureLocation: true,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.settings.flagPolicy.countSeverities).toEqual(["medium", "high"]);
      expect(ok.body.settings.candidateInfoPopup.fields).toEqual(["email", "gender"]);
      expect(ok.body.settings.captureLocation).toBe(true);
    });

    it("keeps the pop-up fields when it is switched off and on again", async () => {
      const w = await world();
      await patchSettings(w.admin, w, { candidateInfoPopup: { enabled: true, fields: ["email"] } });
      const off = await patchSettings(w.admin, w, { candidateInfoPopup: { enabled: false } });
      expect(off.body.settings.candidateInfoPopup).toEqual({ enabled: false, fields: ["email"] });
      const on = await patchSettings(w.admin, w, { candidateInfoPopup: { enabled: true } });
      expect(on.body.settings.candidateInfoPopup).toEqual({ enabled: true, fields: ["email"] });
    });
  });

  describe("shuffling", () => {
    const idsOf = (view) => view.questions.map((q) => q.questionId);

    it("keeps today's shuffled, stored question order by default and shows it again on resume", async () => {
      const w = await world();
      const first = await start(w.candidate, w);
      expect(first.status).toBe(201);
      const resumed = await start(w.candidate, w);
      expect(resumed.status).toBe(200);
      expect(idsOf(resumed.body)).toEqual(idsOf(first.body));
      expect(idsOf((await getAttempt(w.candidate, first.body.id)).body)).toEqual(idsOf(first.body));
      expect([...idsOf(first.body)].sort()).toEqual(w.questions.map((q) => String(q._id)).sort());
      // Seeded by the attempt id: no stored attempt row holds a seed or a random number.
      const stored = await Attempt.findById(first.body.id).lean();
      expect(stored.questions.map((q) => String(q.questionId))).toEqual(idsOf(first.body));
    });

    it("keeps the paper order when shuffleQuestions is off", async () => {
      const w = await world({ settings: { shuffleQuestions: false } });
      const res = await start(w.candidate, w);
      expect(idsOf(res.body)).toEqual(w.questions.map((q) => String(q._id)));
    });

    it("shuffles options per attempt, the same on every read, and marks by key", async () => {
      const w = await world({ settings: { shuffleOptions: true } });
      const a = await start(w.candidate, w);
      const keysOf = (view) => view.questions.map((q) => q.options.map((o) => o.key).join(""));
      const original = "ABCDEFGH";
      expect(keysOf(a.body).some((k) => k !== original)).toBe(true);
      for (const q of a.body.questions) {
        expect(
          q.options
            .map((o) => o.key)
            .sort()
            .join(""),
        ).toBe(original);
        for (const o of q.options) expect(o.text).toBe(`OPT-${o.key}`);
      }
      const again = await getAttempt(w.candidate, a.body.id);
      expect(keysOf(again.body)).toEqual(keysOf(a.body));
      expect(keysOf((await start(w.candidate, w)).body)).toEqual(keysOf(a.body));

      // The candidate answers with option keys; the key A is right wherever it is shown.
      const saved = await putAnswers(
        w.candidate,
        a.body.id,
        a.body.questions.map((q) => ({ questionId: q.questionId, answer: "A" })),
      );
      expect(saved.status).toBe(200);
      expect((await submit(w.candidate, a.body.id)).status).toBe(200);
      const stored = await Attempt.findById(a.body.id).lean();
      expect(stored.scores.obtainedMarks).toBe(8);
      expect(stored.shuffleOptions).toBe(true);
      expect(a.body.shuffleOptions).toBe(true);
    });

    it("keeps option order when shuffleOptions is off, and a later change does not move an open attempt", async () => {
      const w = await world();
      const a = await start(w.candidate, w);
      for (const q of a.body.questions) {
        expect(q.options.map((o) => o.key).join("")).toBe("ABCDEFGH");
      }
      await patchSettings(w.admin, w, { shuffleOptions: true });
      const again = await getAttempt(w.candidate, a.body.id);
      for (const q of again.body.questions) {
        expect(q.options.map((o) => o.key).join("")).toBe("ABCDEFGH");
      }
    });
  });

  describe("result display and mandatory questions", () => {
    it("shows no marks to the candidate by default", async () => {
      const w = await world();
      const a = await start(w.candidate, w);
      const done = await submit(w.candidate, a.body.id);
      expect(done.status).toBe(200);
      expect(done.body.marks).toBeNull();
      const view = await getAttempt(w.candidate, a.body.id);
      expect(view.body.marks).toBeNull();
      expect(view.body.settings.showMarksToCandidate).toBe(false);
      expect(JSON.stringify(view.body)).not.toContain("obtainedMarks");
    });

    it("holds the marks until the result is validated by default (X-12, DECISIONS 805)", async () => {
      const w = await world({ settings: { showMarksToCandidate: true } });
      const a = await start(w.candidate, w);
      await putAnswers(w.candidate, a.body.id, [
        { questionId: a.body.questions[0].questionId, answer: "A" },
      ]);
      const done = await submit(w.candidate, a.body.id);
      expect(done.body.marks).toBeNull();
      expect((await getAttempt(w.candidate, a.body.id)).body.marks).toBeNull();
      await Result.create({ batchId: w.batch._id, status: "validated", rows: [] });
      const later = await getAttempt(w.candidate, a.body.id);
      expect(later.body.marks).toMatchObject({ maxMarks: 8, complete: true });
    });

    it("shows the totals after the attempt closes when marksAfterValidation is off", async () => {
      const w = await world({
        settings: { showMarksToCandidate: true, marksAfterValidation: false },
      });
      const a = await start(w.candidate, w);
      expect((await getAttempt(w.candidate, a.body.id)).body.marks).toBeNull();
      await putAnswers(w.candidate, a.body.id, [
        { questionId: a.body.questions[0].questionId, answer: "A" },
        { questionId: a.body.questions[1].questionId, answer: "A" },
        { questionId: a.body.questions[2].questionId, answer: "B" },
      ]);
      const done = await submit(w.candidate, a.body.id);
      expect(done.body.marks).toEqual({ obtainedMarks: 2, maxMarks: 8, complete: true });
      expect((await getAttempt(w.candidate, a.body.id)).body.marks).toEqual(done.body.marks);
      // Never per-question marks or keys for the candidate.
      expect(JSON.stringify(done.body)).not.toContain("correctAnswer");
    });

    it("allows submit with unanswered questions by default", async () => {
      const w = await world();
      const a = await start(w.candidate, w);
      expect((await submit(w.candidate, a.body.id)).status).toBe(200);
    });

    it("blocks submit while any question is unanswered when questionsMandatory is on", async () => {
      const w = await world({ settings: { questionsMandatory: true } });
      const a = await start(w.candidate, w);
      const answers = a.body.questions.map((q) => ({ questionId: q.questionId, answer: "B" }));
      await putAnswers(w.candidate, a.body.id, answers.slice(0, 5));
      const blocked = await submit(w.candidate, a.body.id);
      expectError(blocked, 409, "ATTEMPT_UNANSWERED_QUESTIONS");
      expect(blocked.body.error.details).toEqual({ unansweredCount: 3 });
      expect((await Attempt.findById(a.body.id).lean()).status).toBe("in_progress");

      // Clearing an answer makes it unanswered again.
      await putAnswers(w.candidate, a.body.id, [
        ...answers.slice(5),
        { questionId: answers[0].questionId, answer: null },
      ]);
      expect((await submit(w.candidate, a.body.id)).body.error.details.unansweredCount).toBe(1);

      await putAnswers(w.candidate, a.body.id, [answers[0]]);
      expect((await submit(w.candidate, a.body.id)).status).toBe(200);
    });

    it("still closes an unfinished attempt at the deadline when questions are mandatory", async () => {
      const w = await world({ settings: { questionsMandatory: true } });
      const a = await start(w.candidate, w);
      await Attempt.updateOne(
        { _id: a.body.id },
        {
          deadlineAt: new Date(Date.now() - 120_000),
          acceptUntil: new Date(Date.now() - 60_000),
        },
      );
      const late = await submit(w.candidate, a.body.id);
      expect(late.status).toBe(200);
      expect(late.body.status).toBe("timed_out");
    });
  });

  describe("flag policy", () => {
    const POLICY = { flagPolicy: { action: "pause", pauseAfterFlags: 2 } };

    it("only records by default: nothing interrupts the candidate", async () => {
      const w = await world();
      const { attempt, sessionId } = await begin(w);
      for (let i = 0; i < 6; i += 1) {
        const res = await sendFlag(w.candidate, sessionId, "multiple_faces");
        expect(res.status).toBe(201);
        expect(res.body.paused).toBe(false);
      }
      const saved = await putAnswers(w.candidate, attempt.id, [
        { questionId: attempt.questions[0].questionId, answer: "A" },
      ]);
      expect(saved.status).toBe(200);
      expect((await getAttempt(w.candidate, attempt.id)).body.paused).toBe(false);
      expect((await Attempt.findById(attempt.id).lean()).pause).toBeUndefined();
    });

    it("pauses when the counted flags reach the limit; low and uncounted flags do not count", async () => {
      const w = await world({ settings: POLICY });
      const { attempt, sessionId } = await begin(w);
      await putAnswers(w.candidate, attempt.id, [
        { questionId: attempt.questions[0].questionId, answer: "A" },
      ]);

      // low and medium do not count with the default ["high"].
      for (const type of ["tab_hidden", "face_not_present", "window_blur"]) {
        expect((await sendFlag(w.candidate, sessionId, type)).body.paused).toBe(false);
      }
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(false);
      const fourth = await sendFlag(w.candidate, sessionId, "phone_detected");
      expect(fourth.status).toBe(201);
      expect(fourth.body.paused).toBe(true);

      const stored = await Attempt.findById(attempt.id).lean();
      expect(stored.pause.active).toBe(true);
      expect(stored.pause.timesPaused).toBe(1);
      expect(stored.status).toBe("in_progress");
      // The clock is not touched and nothing about the result changes.
      expect(stored.deadlineAt).toEqual(new Date(attempt.deadlineAt));

      const view = await getAttempt(w.candidate, attempt.id);
      expect(view.body.paused).toBe(true);
      expect(view.body.status).toBe("in_progress");
      // Saved answers stay safe.
      expect(view.body.questions[0].answer).toBe("A");

      const audit = await AuditLog.findOne({ action: "attempt.pause" }).lean();
      expect(audit.actorRole).toBe("system");
      expect(audit.before).toEqual({ paused: false });
      expect(audit.after.paused).toBe(true);
      expect(audit.meta).toMatchObject({ trigger: "flag_policy", countedFlags: 2, limit: 2 });
    });

    it("counts medium flags too when the batch says so", async () => {
      const w = await world({
        settings: {
          flagPolicy: { action: "pause", pauseAfterFlags: 2, countSeverities: ["medium", "high"] },
        },
      });
      const { sessionId } = await begin(w);
      expect((await sendFlag(w.candidate, sessionId, "face_not_present")).body.paused).toBe(false);
      expect((await sendFlag(w.candidate, sessionId, "id_unreadable")).body.paused).toBe(true);
    });

    it("refuses answer saves and submit with ATTEMPT_PAUSED until unlocked", async () => {
      const w = await world({ settings: POLICY });
      const { attempt, sessionId } = await begin(w);
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      await sendFlag(w.candidate, sessionId, "multiple_faces");

      const q0 = attempt.questions[0].questionId;
      const save = await putAnswers(w.candidate, attempt.id, [{ questionId: q0, answer: "B" }]);
      expectError(save, 409, "ATTEMPT_PAUSED");
      expect(save.body.error.message).toBe("Your test is paused. Please contact your proctor.");
      expectError(await submit(w.candidate, attempt.id), 409, "ATTEMPT_PAUSED");
      const stored = await Attempt.findById(attempt.id).lean();
      expect(stored.status).toBe("in_progress");
      expect(stored.questions[0].answer).toBeNull();

      // Flags keep being recorded while paused, and the heartbeat tells the page.
      const more = await sendFlag(w.candidate, sessionId, "multiple_faces");
      expect(more.status).toBe(201);
      expect(more.body.paused).toBe(true);
      const beat = await request(app)
        .post(`/api/v1/proctoring/sessions/${sessionId}/heartbeat`)
        .set(bearer(w.candidate.token))
        .send({});
      expect(beat.body.paused).toBe(true);
    });

    it("holds the clock while paused and gives the time back on unlock when extendOnUnlock is on (X-12)", async () => {
      const w = await world({
        settings: { flagPolicy: { action: "pause", pauseAfterFlags: 2, extendOnUnlock: true } },
      });
      const { attempt, sessionId } = await begin(w);
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      const paused = await Attempt.findById(attempt.id).lean();
      expect(paused.pause.clockStopped).toBe(true);

      // Paused for two minutes, and the original deadline has passed meanwhile: still open.
      const deadline = new Date(Date.now() - 30_000);
      await Attempt.updateOne(
        { _id: attempt.id },
        {
          deadlineAt: deadline,
          acceptUntil: new Date(Date.now() - 1000),
          "pause.pausedAt": new Date(Date.now() - 120_000),
        },
      );
      const held = await getAttempt(w.candidate, attempt.id);
      expect(held.body.status).toBe("in_progress");
      expect(held.body.paused).toBe(true);
      expect(held.body.clockHeld).toBe(true);

      const res = await unlock(w.admin, sessionId);
      expect(res.status).toBe(200);
      const after = await Attempt.findById(attempt.id).lean();
      const added = (after.deadlineAt.getTime() - deadline.getTime()) / 1000;
      expect(added).toBeGreaterThanOrEqual(119);
      expect(added).toBeLessThanOrEqual(125);
      expect(after.pause.clockStopped).toBe(false);
      expect(after.pause.secondsGivenBack).toBeGreaterThanOrEqual(119);
      const row = await AuditLog.findOne({ action: "proctoring.unlock" }).lean();
      expect(row.after.secondsGivenBack).toBeGreaterThanOrEqual(119);
    });

    it("still times the attempt out while paused: the clock keeps running", async () => {
      const w = await world({ settings: POLICY });
      const { attempt, sessionId } = await begin(w);
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      await putAnswers(w.candidate, attempt.id, [
        { questionId: attempt.questions[0].questionId, answer: "A" },
      ]).then((res) => expect(res.status).toBe(409));
      await Attempt.updateOne(
        { _id: attempt.id },
        { deadlineAt: new Date(Date.now() - 120_000), acceptUntil: new Date(Date.now() - 60_000) },
      );
      const view = await getAttempt(w.candidate, attempt.id);
      expect(view.body.status).toBe("timed_out");
      expect(view.body.paused).toBe(false);
    });

    it("unlocks from the session page: aa_admin and the batch proctor only; the count restarts", async () => {
      const w = await world({ settings: POLICY });
      const { attempt, sessionId } = await begin(w);
      expectError(await unlock(w.admin, sessionId), 409, "PROCTORING_NOT_PAUSED");

      await sendFlag(w.candidate, sessionId, "multiple_faces");
      await sendFlag(w.candidate, sessionId, "multiple_faces");

      const detail = await request(app)
        .get(`/api/v1/proctoring/sessions/${sessionId}`)
        .set(bearer(w.proctor.token));
      expect(detail.body.paused).toBe(true);
      expect(detail.body.lock).toMatchObject({
        paused: true,
        timesPaused: 1,
        countedFlags: 2,
        policy: { action: "pause", pauseAfterFlags: 2, countSeverities: ["high"] },
      });
      const list = await request(app).get("/api/v1/proctoring/sessions").set(bearer(w.admin.token));
      expect(list.body.items[0].paused).toBe(true);

      for (const who of [
        w.candidate,
        w.otherProctor,
        w.assessor,
        w.mis,
        w.tp,
        w.reviewer,
        w.ncvet,
      ]) {
        expectError(await unlock(who, sessionId), 403, "FORBIDDEN");
      }
      expect((await Attempt.findById(attempt.id).lean()).pause.active).toBe(true);

      const res = await unlock(w.proctor, sessionId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.lock).toMatchObject({ paused: false, countedFlags: 0, timesPaused: 1 });
      expect((await Attempt.findById(attempt.id).lean()).pause.lastUnlockedAt).toBeTruthy();
      expect((await ProctoringSession.findById(sessionId).lean()).policyFlagCount).toBe(0);

      const row = await AuditLog.findOne({ action: "proctoring.unlock" }).lean();
      expect(row.actorRole).toBe("proctor");
      expect(row.before).toEqual({ paused: true, countedFlags: 2 });
      expect(row.after).toMatchObject({ paused: false, countedFlags: 0 });

      // Saving works again, and the count starts from zero: one flag is not enough.
      const q0 = attempt.questions[0].questionId;
      expect(
        (await putAnswers(w.candidate, attempt.id, [{ questionId: q0, answer: "A" }])).status,
      ).toBe(200);
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(false);
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(true);
      expect((await Attempt.findById(attempt.id).lean()).pause.timesPaused).toBe(2);

      // aa_admin may unlock any batch.
      expect((await unlock(w.admin, sessionId)).status).toBe(200);
      expect((await submit(w.candidate, attempt.id)).status).toBe(200);
      // A closed attempt cannot be unlocked.
      expectError(await unlock(w.admin, sessionId), 409, "PROCTORING_ATTEMPT_CLOSED");
    });

    it("does not change a result: a pause never fails or scores anything", async () => {
      const w = await world({ settings: POLICY });
      const { attempt, sessionId } = await begin(w);
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      const stored = await Attempt.findById(attempt.id).lean();
      expect(stored.scores).toBeNull();
      expect(stored.closeReason).toBeNull();
    });
  });

  describe("camera images", () => {
    it("gives the session config the compliance interval and start/end photos by default", async () => {
      const w = await world();
      const { session } = await begin(w);
      expect(session.config.snapshotIntervalSeconds).toBe(30);
      expect(session.config.snapshotAtStartAndEnd).toBe(true);
      expect(session.paused).toBe(false);
    });

    it("uses the batch interval and start/end switch, and keeps them for the running session", async () => {
      const w = await world({
        settings: { imageCapture: { intervalSeconds: 45, atStartAndEnd: false } },
      });
      const { session, sessionId } = await begin(w);
      expect(session.config.snapshotIntervalSeconds).toBe(45);
      expect(session.config.snapshotAtStartAndEnd).toBe(false);
      expect((await ProctoringSession.findById(sessionId).lean()).snapshotIntervalSeconds).toBe(45);

      await patchSettings(w.admin, w, { imageCapture: { intervalSeconds: 90 } });
      const replay = await startSession(w.candidate, session.attemptId);
      expect(replay.status).toBe(200);
      expect(replay.body.config.snapshotIntervalSeconds).toBe(45);
    });
  });

  describe("candidate pop-up", () => {
    const enable = (w, fields = ["email", "fatherName", "gender", "dateOfBirth"]) =>
      patchSettings(w.admin, w, { candidateInfoPopup: { enabled: true, fields } });
    const infoUrl = (w) => `/api/v1/batches/${w.batch._id}/candidate-info`;
    const full = {
      email: "Asha.Devi@Example.com",
      fatherName: "Ramesh Devi",
      gender: "female",
      dateOfBirth: "2001-04-09",
    };
    const putInfo = (who, w, body) =>
      request(app).put(infoUrl(w)).set(bearer(who.token)).send(body);

    it("is off by default: nothing is asked and nothing can be saved", async () => {
      const w = await world();
      const mine = await request(app)
        .get(`${infoUrl(w)}/mine`)
        .set(bearer(w.candidate.token));
      expect(mine.body).toMatchObject({ enabled: false, fields: [], submitted: false });
      expectError(
        await putInfo(w.candidate, w, { email: "a@b.in" }),
        409,
        "CANDIDATE_INFO_NOT_ENABLED",
      );
    });

    it("asks only the chosen fields, requires all of them, and rejects others", async () => {
      const w = await world();
      await enable(w, ["email", "dateOfBirth"]);
      const mine = await request(app)
        .get(`${infoUrl(w)}/mine`)
        .set(bearer(w.candidate.token));
      expect(mine.body).toMatchObject({
        enabled: true,
        fields: ["email", "dateOfBirth"],
        submitted: false,
      });
      expectError(await putInfo(w.candidate, w, { email: "a@b.in" }), 400, "VALIDATION_ERROR");
      expectError(
        await putInfo(w.candidate, w, {
          email: "a@b.in",
          dateOfBirth: "2001-04-09",
          gender: "male",
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await putInfo(w.candidate, w, { email: "not-an-email", dateOfBirth: "2001-04-09" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await putInfo(w.candidate, w, { email: "a@b.in", dateOfBirth: "2001-02-30" }),
        400,
        "VALIDATION_ERROR",
      );
      for (const key of ["aadhaar", "pan", "voterId", "passportNumber"]) {
        expectError(
          await putInfo(w.candidate, w, {
            email: "a@b.in",
            dateOfBirth: "2001-04-09",
            [key]: "X1234567",
          }),
          400,
          "VALIDATION_ERROR",
        );
      }
      expect(await CandidateInfo.countDocuments()).toBe(0);
    });

    it("stores the answers encrypted and never writes them to audit rows", async () => {
      const w = await world();
      await enable(w);
      const res = await putInfo(w.candidate, w, full);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        batchId: String(w.batch._id),
        submitted: true,
        fields: ["email", "fatherName", "gender", "dateOfBirth"],
      });
      const raw = await mongoose.connection.db.collection("candidateInfo").findOne({});
      for (const key of ["email", "fatherName", "gender", "dateOfBirth"]) {
        expect(raw[key]).toMatch(/^enc:v1:/);
      }
      expect(JSON.stringify(raw)).not.toContain("Ramesh");
      expect(JSON.stringify(raw)).not.toContain("2001-04-09");

      const rows = await AuditLog.find({}).lean();
      const dump = JSON.stringify(rows);
      for (const secret of ["Ramesh", "2001-04-09", "asha.devi@example.com", "female"]) {
        expect(dump.toLowerCase()).not.toContain(secret.toLowerCase());
      }
      const row = rows.find((r) => r.action === "batch.candidate_info_save");
      expect(row.meta.fields).toEqual(["email", "fatherName", "gender", "dateOfBirth"]);

      const mine = await request(app)
        .get(`${infoUrl(w)}/mine`)
        .set(bearer(w.candidate.token));
      expect(mine.body.submitted).toBe(true);
      expect(JSON.stringify(mine.body)).not.toContain("Ramesh");

      // A second save replaces the first (one row per candidate).
      await putInfo(w.candidate, w, { ...full, fatherName: "Suresh Devi" });
      expect(await CandidateInfo.countDocuments()).toBe(1);
    });

    it("shows the values only to aa_admin and the tp of the batch, and logs the read", async () => {
      const w = await world();
      await enable(w);
      await putInfo(w.candidate, w, full);

      for (const who of [w.admin, w.tp]) {
        const res = await request(app).get(infoUrl(w)).set(bearer(who.token));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({
          candidateName: "Asha Devi",
          email: "asha.devi@example.com",
          fatherName: "Ramesh Devi",
          gender: "female",
          dateOfBirth: "2001-04-09",
        });
      }
      for (const who of [
        w.otherTp,
        w.mis,
        w.proctor,
        w.assessor,
        w.reviewer,
        w.ncvet,
        w.candidate,
      ]) {
        expectError(await request(app).get(infoUrl(w)).set(bearer(who.token)), 403, "FORBIDDEN");
      }
      const logs = await AccessLog.find({ subjectId: String(w.learnerId) }).lean();
      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(logs[0].fields).toEqual(["email", "fatherName", "gender", "dateOfBirth"]);
      expect(JSON.stringify(logs)).not.toContain("Ramesh");
    });

    it("shows the candidate which fields to fill in on the attempt, and lets only the roster candidate save", async () => {
      const w = await world();
      await enable(w, ["gender"]);
      const a = await start(w.candidate, w);
      expect(a.body.settings.candidateInfoPopup).toEqual({ enabled: true, fields: ["gender"] });
      expectError(await putInfo(w.otherCandidate, w, { gender: "male" }), 403, "FORBIDDEN");
      for (const who of [w.admin, w.tp, w.proctor]) {
        expectError(await putInfo(who, w, { gender: "male" }), 403, "FORBIDDEN");
      }
    });
  });

  describe("behaviour checks (X-16)", () => {
    it("switches looking-away and voice checks per batch and tells the browser", async () => {
      const w = await world();
      const before = await getSettings(w.admin, w);
      expect(before.body.settings.detectLookingAway).toBe(true);
      expect(before.body.settings.detectVoice).toBe(true);
      const res = await patchSettings(w.admin, w, { detectVoice: false });
      expect(res.status).toBe(200);
      expect(res.body.settings.detectVoice).toBe(false);
      expect(res.body.settings.detectLookingAway).toBe(true);
      const a = await start(w.candidate, w);
      const session = await request(app)
        .post("/api/v1/proctoring/sessions")
        .set(bearer(w.candidate.token))
        .send({ attemptId: a.body.id });
      expect(session.body.config.disabledFlags).toEqual(["voice_detected"]);
      expectError(await patchSettings(w.admin, w, { detectVoice: "no" }), 400, "VALIDATION_ERROR");
      expectError(await patchSettings(w.proctor, w, { detectVoice: true }), 403, "FORBIDDEN");
    });
  });

  describe("ThinkExam switches (X-28)", () => {
    const startSessionFor = async (w) => {
      const a = await start(w.candidate, w);
      const res = await request(app)
        .post("/api/v1/proctoring/sessions")
        .set(bearer(w.candidate.token))
        .send({ attemptId: a.body.id });
      expect(res.status).toBe(201);
      return res.body;
    };

    it("shows today's behaviour as the defaults for every new switch", async () => {
      const w = await world();
      const { settings } = (await getSettings(w.admin, w)).body;
      expect(settings).toMatchObject({
        proctoringType: "automatic",
        aiEnabled: true,
        ufmEvidence: "image",
        downloadSessionVideo: false,
        downloadFlagVideo: false,
        allowPracticalVideo: true,
        allowVivaVideo: true,
        assessorGeolocation: true,
        assessorAnnexureM: true,
        assessorFeedback: false,
        studentAttendance: true,
        studentFeedback: true,
        languages: { theory: false, practical: false, viva: false },
        allowOjtImages: false,
        flagPolicy: { pauseAfterUnlock: 3 },
        imageCapture: { enabled: true },
      });
    });

    it("stores each switch, keeps the others, and rejects wrong values and unknown keys", async () => {
      const w = await world();
      const res = await patchSettings(w.admin, w, {
        proctoringType: "manual",
        aiEnabled: false,
        assessorGeolocation: true,
        studentAttendance: false,
        languages: { viva: true },
        allowOjtImages: true,
        flagPolicy: { pauseAfterUnlock: 5 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.settings).toMatchObject({
        proctoringType: "manual",
        aiEnabled: false,
        assessorGeolocation: true,
        studentAttendance: false,
        languages: { theory: false, practical: false, viva: true },
        allowOjtImages: true,
        flagPolicy: { pauseAfterUnlock: 5, pauseAfterFlags: 3 },
      });
      for (const bad of [
        { proctoringType: "both" },
        { aiEnabled: "yes" },
        { languages: { science: true } },
        { flagPolicy: { pauseAfterUnlock: 0 } },
        { flagPolicy: { pauseAfterUnlock: 21 } },
        { imageCapture: { enabled: "no" } },
        { aadhaarVerification: true },
      ]) {
        expectError(await patchSettings(w.admin, w, bad), 400, "VALIDATION_ERROR");
      }
      const row = await AuditLog.findOne({ action: "batch.settings_update" }).lean();
      expect(row.after.settings.proctoringType).toBe("manual");
    });

    it("manual proctoring and AI off both switch off every model-based flag", async () => {
      for (const change of [{ proctoringType: "manual" }, { aiEnabled: false }]) {
        const w = await world();
        await patchSettings(w.admin, w, change);
        const session = await startSessionFor(w);
        expect(session.config.disabledFlags).toEqual(
          expect.arrayContaining([
            "face_not_present",
            "multiple_faces",
            "phone_detected",
            "face_mismatch",
            "looking_away",
            "voice_detected",
          ]),
        );
        expect(session.config.disabledFlags).not.toContain("camera_blocked");
      }
    });

    it("turns the pictures taken during the exam off without calling the session feed lost", async () => {
      const w = await world();
      await patchSettings(w.admin, w, { imageCapture: { enabled: false } });
      const session = await startSessionFor(w);
      expect(session.config.snapshotIntervalSeconds).toBe(0);
      const stored = await ProctoringSession.findById(session.id).lean();
      expect(stored.periodicImagesOff).toBe(true);
      await ProctoringSession.updateOne(
        { _id: session.id },
        { $set: { lastSeenAt: new Date(Date.now() - 3_600_000) } },
      );
      const detail = await request(app)
        .get(`/api/v1/proctoring/sessions/${session.id}`)
        .set(bearer(w.admin.token));
      expect(detail.body.status).toBe("active");
    });

    it("uses the 'after unlocking' number once the exam has been unlocked", async () => {
      const w = await world({
        settings: { flagPolicy: { action: "pause", pauseAfterFlags: 2, pauseAfterUnlock: 3 } },
      });
      const { attempt, sessionId } = await begin(w);
      await sendFlag(w.candidate, sessionId, "multiple_faces");
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(true);
      expect((await unlock(w.admin, sessionId)).status).toBe(200);
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(false);
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(false);
      expect((await sendFlag(w.candidate, sessionId, "multiple_faces")).body.paused).toBe(true);
      expect((await Attempt.findById(attempt.id).lean()).pause.timesPaused).toBe(2);
    });

    it("needs the exam video for the video evidence and the two downloads", async () => {
      const w = await world();
      for (const bad of [
        { ufmEvidence: "video" },
        { downloadSessionVideo: true },
        { downloadFlagVideo: true },
      ]) {
        expectError(await patchSettings(w.admin, w, bad), 400, "VALIDATION_ERROR");
      }
      const ok = await patchSettings(w.admin, w, {
        requireScreenShare: true,
        recordVideo: true,
        ufmEvidence: "video",
        downloadSessionVideo: true,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expectError(await patchSettings(w.admin, w, { recordVideo: false }), 400, "VALIDATION_ERROR");
    });
  });

  describe("pass rule, marking type and TP contact (X-29)", () => {
    const putSpoc = (who, w, body) =>
      request(app).put(`/api/v1/batches/${w.batch._id}/tp-spoc`).set(bearer(who.token)).send(body);

    it("defaults to the qualification's rule and typed marks", async () => {
      const w = await world();
      expect((await getSettings(w.admin, w)).body.settings).toMatchObject({
        passCriteria: "qualification",
        passPercentage: 50,
        practicalMarking: "marks",
        vivaMarking: "marks",
      });
    });

    it("stores the rule and the marking type, and rejects wrong values", async () => {
      const w = await world();
      const ok = await patchSettings(w.admin, w, {
        passCriteria: "overall",
        passPercentage: 60,
        practicalMarking: "rubric",
        vivaMarking: "rubric",
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.settings).toMatchObject({ passCriteria: "overall", passPercentage: 60 });
      for (const bad of [
        { passCriteria: "any" },
        { passPercentage: 0 },
        { passPercentage: 101 },
        { passPercentage: 50.5 },
        { practicalMarking: "stars" },
        { vivaMarking: true },
      ]) {
        expectError(await patchSettings(w.admin, w, bad), 400, "VALIDATION_ERROR");
      }
    });

    it("locks the rule once marks were saved, but other settings stay open", async () => {
      const w = await world();
      await Result.collection.insertOne({ batchId: w.batch._id, status: "draft", rows: [] });
      expectError(
        await patchSettings(w.admin, w, { passPercentage: 70 }),
        409,
        "BATCH_SETTINGS_LOCKED",
      );
      expectError(
        await patchSettings(w.admin, w, { practicalMarking: "rubric" }),
        409,
        "BATCH_SETTINGS_LOCKED",
      );
      expect((await patchSettings(w.admin, w, { shuffleOptions: true })).status).toBe(200);
      // Saving the same value again is not a change.
      expect((await patchSettings(w.admin, w, { passPercentage: 50 })).status).toBe(200);
    });

    it("sets the TP contact: the batch's own tp, aa_admin and mis only; name needed; not in the audit", async () => {
      const w = await world();
      const body = { name: "Nitin Sharma", contact: "+91 98765 43210" };
      const ok = await putSpoc(w.tp, w, body);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.tpSpoc).toEqual(body);
      expect((await putSpoc(w.admin, w, { name: "Asha" })).body.tpSpoc).toEqual({
        name: "Asha",
        contact: null,
      });
      expect((await putSpoc(w.mis, w, body)).status).toBe(200);
      expectError(await putSpoc(w.otherTp, w, body), 403, "FORBIDDEN");
      for (const who of [w.proctor, w.assessor, w.candidate]) {
        expectError(await putSpoc(who, w, body), 403, "FORBIDDEN");
      }
      for (const bad of [
        { contact: "98765" },
        { name: "" },
        { name: "A", contact: "abc 123 4567" },
        { name: "A", aadhaar: "123412341234" },
      ]) {
        expectError(await putSpoc(w.admin, w, bad), 400, "VALIDATION_ERROR");
      }
      const rows = await AuditLog.find({ action: "batch.set_tp_spoc" }).lean();
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toMatch(/Nitin|98765/);
    });
  });

  describe("mock safeguard (X-22)", () => {
    it("refuses the mock switch on a batch linked to a scheme, allows it otherwise", async () => {
      const w = await world();
      await Batch.updateOne({ _id: w.batch._id }, { $set: { schemeId: oid() } });
      expectError(
        await patchSettings(w.admin, w, { skipPaperApproval: true }),
        409,
        "BATCH_MOCK_NOT_ALLOWED",
      );
      expect((await getSettings(w.admin, w)).body.settings.skipPaperApproval).toBe(false);
      // Switching it off, or changing something else, is never blocked.
      expect((await patchSettings(w.admin, w, { skipPaperApproval: false })).status).toBe(200);
      await Batch.updateOne({ _id: w.batch._id }, { $set: { schemeId: null } });
      expect((await patchSettings(w.admin, w, { skipPaperApproval: true })).status).toBe(200);
    });
  });

  describe("screen sharing (X-21)", () => {
    it("is off by default, switched per batch, and told to the candidate's list", async () => {
      const w = await world();
      expect((await getSettings(w.admin, w)).body.settings.requireScreenShare).toBe(false);
      const res = await patchSettings(w.admin, w, { requireScreenShare: true });
      expect(res.status).toBe(200);
      expect(res.body.settings.requireScreenShare).toBe(true);
      const list = await request(app)
        .get("/api/v1/attempts/available")
        .set(bearer(w.candidate.token));
      expect(list.status).toBe(200);
      expect(list.body.items[0].requireScreenShare).toBe(true);
      expectError(
        await patchSettings(w.admin, w, { requireScreenShare: "yes" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await patchSettings(w.proctor, w, { requireScreenShare: false }),
        403,
        "FORBIDDEN",
      );
    });

    it("accepts the screen_share_stopped flag with high severity", async () => {
      const w = await world();
      const { sessionId } = await begin(w);
      const res = await sendFlag(w.candidate, sessionId, "screen_share_stopped");
      expect(res.status).toBe(201);
      expect(res.body.severity).toBe("high");
    });
  });

  describe("location", () => {
    it("lets aa_admin choose which roles see the coordinates (X-12)", async () => {
      const w = await world();
      expect((await getSettings(w.admin, w)).body.settings.locationVisibleTo).toEqual([
        "tp",
        "proctor",
      ]);
      const res = await patchSettings(w.admin, w, {
        locationVisibleTo: ["proctor", "assessor", "tp"],
      });
      expect(res.status).toBe(200);
      // Stored in a fixed order, whatever order was sent.
      expect(res.body.settings.locationVisibleTo).toEqual(["tp", "assessor", "proctor"]);
      expect(
        (await patchSettings(w.admin, w, { locationVisibleTo: [] })).body.settings
          .locationVisibleTo,
      ).toEqual([]);
      for (const bad of [["candidate"], ["aa_admin"], ["tp", "tp"], "tp"]) {
        expectError(
          await patchSettings(w.admin, w, { locationVisibleTo: bad }),
          400,
          "VALIDATION_ERROR",
        );
      }
      expectError(
        await patchSettings(w.proctor, w, { locationVisibleTo: ["tp"] }),
        403,
        "FORBIDDEN",
      );
    });

    it("is off by default and switched by aa_admin; the exam page gets the flag", async () => {
      const w = await world();
      const a = await start(w.candidate, w);
      expect(a.body.settings.captureLocation).toBe(false);
      await patchSettings(w.admin, w, { captureLocation: true });
      expect((await getSettings(w.admin, w)).body.settings.captureLocation).toBe(true);
      expect((await getAttempt(w.candidate, a.body.id)).body.settings.captureLocation).toBe(true);
    });
  });
});
