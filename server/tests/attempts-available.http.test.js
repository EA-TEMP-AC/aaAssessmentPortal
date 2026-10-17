import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AttendanceRecord } from "../src/models/attendance-record.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const day = (offset) => istCalendarDate(new Date(Date.now() + offset * 86_400_000));

async function sessionFor(role, extra = {}) {
  const email = `${role}-${oid()}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: String(user._id) };
}

async function makePaper(qualificationId, over = {}) {
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const id = oid();
    await Question.create({
      _id: id,
      rootQuestionId: id,
      qualificationId,
      nosId: "NOS-01",
      pcId: "PC-01",
      type: "mcq",
      language: "en",
      stem: `SECRET-STEM-${id}`,
      options: [
        { key: "A", text: "SECRET-OPT-A" },
        { key: "B", text: "SECRET-OPT-B" },
      ],
      correctAnswer: "A",
      marks: 2,
      status: "approved",
      version: 1,
      isLatest: true,
      createdBy: oid(),
    });
    ids.push(id);
  }
  return TestPaper.create({
    qualificationId,
    status: "approved",
    seed: 1,
    rules: { language: "en", quotas: [{ nosId: "NOS-01", count: 3 }] },
    poolHash: "x",
    items: ids.map((id) => ({
      questionId: id,
      rootQuestionId: id,
      version: 1,
      nosId: "NOS-01",
      pcId: "PC-01",
      type: "mcq",
      marks: 2,
    })),
    totalMarks: 6,
    complete: true,
    createdBy: oid(),
    approvedBy: oid(),
    approvedAt: new Date(),
    ...over,
  });
}

async function makeBatch(qualificationId, over = {}) {
  return Batch.create({
    abId: oid(),
    qualificationId,
    type: "STT",
    mode: "offline",
    assessmentStartDate: day(-1),
    assessmentEndDate: day(1),
    tpId: oid(),
    centreId: oid(),
    candidateCount: 1,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "English",
    state: "Maharashtra",
    status: "in_progress",
    statusVersion: 3,
    assessorId: oid(),
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...over,
  });
}

/** The candidate is on batch A (in progress) with one paper; batch B is someone else's. */
async function world() {
  // Only code and name are read here, so the row skips the full qualification fixture.
  const qualificationId = oid();
  await Qualification.collection.insertOne({
    _id: qualificationId,
    code: "ELE/Q0001",
    name: "Field Technician",
  });
  const paper = await makePaper(qualificationId, { durationMinutes: 45 });
  const batch = await makeBatch(qualificationId, { testPaperId: paper._id });
  const learnerId = oid();
  const roster = await Candidate.create({
    batchId: batch._id,
    learnerId,
    name: "Asha Devi",
    active: true,
  });

  const otherQualificationId = oid();
  const otherPaper = await makePaper(otherQualificationId);
  const otherBatch = await makeBatch(otherQualificationId, { testPaperId: otherPaper._id });
  const otherLearnerId = oid();
  await Candidate.create({
    batchId: otherBatch._id,
    learnerId: otherLearnerId,
    name: "Bina Rao",
    active: true,
  });
  // The other learner is also on batch A, so their attempts on the same paper exist too.
  const otherRosterA = await Candidate.create({
    batchId: batch._id,
    learnerId: otherLearnerId,
    name: "Bina Rao",
    active: true,
  });
  return {
    qualificationId,
    paper,
    batch,
    roster,
    otherPaper,
    otherBatch,
    otherRosterA,
    candidate: await sessionFor("candidate", { linkedProfileId: learnerId }),
    otherCandidate: await sessionFor("candidate", { linkedProfileId: otherLearnerId }),
  };
}

const available = (session) =>
  request(app).get("/api/v1/attempts/available").set(bearer(session.token));
const start = (session, batchId, paperId) =>
  request(app)
    .post("/api/v1/attempts/start")
    .set(bearer(session.token))
    .send({ batchId: String(batchId), testPaperId: String(paperId) });

async function itemsOf(session) {
  const res = await available(session);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items;
}

describe("GET /api/v1/attempts/available (B-19)", () => {
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

  it("lists the papers of the candidate's batch, with counts and duration", async () => {
    const items = await itemsOf(w.candidate);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      batchId: String(w.batch._id),
      batchName: `ELE/Q0001 Field Technician, ${day(-1)} to ${day(1)}`,
      assessmentStartDate: day(-1),
      assessmentEndDate: day(1),
      captureLocation: false,
      requireScreenShare: false,
      paperId: String(w.paper._id),
      paperCode: expect.any(String),
      paperName: "Field Technician (en)",
      language: "en",
      questionCount: 3,
      durationMinutes: 45,
      attempt: null,
      startable: { ok: true },
    });
  });

  it("shows the stored paper name instead of a code", async () => {
    await TestPaper.updateOne({ _id: w.paper._id }, { name: "Field Technician, round 2" });
    const [item] = await itemsOf(w.candidate);
    expect(item.paperName).toBe("Field Technician, round 2");
    expect(item.paperName).not.toMatch(/^Paper /);
  });

  it("uses the default duration when the paper has none", async () => {
    await TestPaper.updateOne({ _id: w.paper._id }, { durationMinutes: null });
    const [item] = await itemsOf(w.candidate);
    expect(item.durationMinutes).toBe(compliance.ATTEMPT_DEFAULT_DURATION_MINUTES);
  });

  describe("scope", () => {
    it("never lists another batch's papers", async () => {
      const ids = (await itemsOf(w.candidate)).map((i) => i.paperId);
      expect(ids).not.toContain(String(w.otherPaper._id));
    });

    it("lists nothing for an inactive roster row", async () => {
      await Candidate.updateOne({ _id: w.roster._id }, { active: false });
      expect(await itemsOf(w.candidate)).toEqual([]);
    });

    it("lists nothing for a batch that is not in progress", async () => {
      await Batch.updateOne({ _id: w.batch._id }, { status: "assigned" });
      expect(await itemsOf(w.candidate)).toEqual([]);
    });

    it("skips a paper that is not approved and complete", async () => {
      await TestPaper.updateOne({ _id: w.paper._id }, { status: "draft" });
      expect(await itemsOf(w.candidate)).toEqual([]);
      await TestPaper.updateOne({ _id: w.paper._id }, { status: "approved", complete: false });
      expect(await itemsOf(w.candidate)).toEqual([]);
    });

    it("lists only the paper set on the batch (D5), not other papers of the qualification", async () => {
      const second = await makePaper(w.qualificationId);
      let items = await itemsOf(w.candidate);
      expect(items.map((i) => i.paperId)).toEqual([String(w.paper._id)]);
      await Batch.updateOne({ _id: w.batch._id }, { testPaperId: second._id });
      items = await itemsOf(w.candidate);
      expect(items.map((i) => i.paperId)).toEqual([String(second._id)]);
    });

    it("lists nothing for a batch with no paper set, and start says why", async () => {
      await Batch.updateOne({ _id: w.batch._id }, { $unset: { testPaperId: "" } });
      expect(await itemsOf(w.candidate)).toEqual([]);
      const res = await start(w.candidate, w.batch._id, w.paper._id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ATTEMPT_NO_TEST_PAPER");
    });

    it("refuses to start another approved paper of the same qualification", async () => {
      const second = await makePaper(w.qualificationId);
      const res = await start(w.candidate, w.batch._id, second._id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(await Attempt.countDocuments()).toBe(0);
    });

    it("lists nothing for a candidate with no linked learner", async () => {
      const loose = await sessionFor("candidate");
      expect(await itemsOf(loose)).toEqual([]);
    });

    it("never shows another candidate's attempt", async () => {
      expect((await start(w.otherCandidate, w.batch._id, w.paper._id)).status).toBe(201);
      const [item] = await itemsOf(w.candidate);
      expect(item.attempt).toBeNull();
      expect(item.startable).toEqual({ ok: true });
    });
  });

  it.each(["aa_admin", "mis", "sme", "assessor", "proctor", "tp", "ab_reviewer", "ncvet_viewer"])(
    "refuses role %s with 403",
    async (role) => {
      const session = await sessionFor(role, { linkedProfileId: oid(), abId: oid() });
      const res = await available(session);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    },
  );

  it("refuses unknown query keys", async () => {
    const res = await request(app)
      .get("/api/v1/attempts/available?batchId=x")
      .set(bearer(w.candidate.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns no question ids, text, options, keys or marks", async () => {
    await start(w.candidate, w.batch._id, w.paper._id);
    const res = await available(w.candidate);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/SECRET/);
    expect(text).not.toMatch(/questionId|correctAnswer|marks|stem|options|scores/i);
    const questionIds = (await Question.find().distinct("_id")).map(String);
    for (const id of questionIds) expect(text).not.toContain(id);
  });

  describe("attempt states", () => {
    it("in progress: shows the attempt and can resume", async () => {
      const started = await start(w.candidate, w.batch._id, w.paper._id);
      const [item] = await itemsOf(w.candidate);
      expect(item.attempt).toEqual({
        id: started.body.id,
        status: "in_progress",
        startedAt: started.body.startedAt,
        deadline: started.body.deadlineAt,
        remainingSeconds: expect.any(Number),
      });
      expect(item.attempt.remainingSeconds).toBeGreaterThan(44 * 60);
      expect(item.attempt.remainingSeconds).toBeLessThanOrEqual(45 * 60);
      expect(item.startable).toEqual({ ok: true });
    });

    it("an open attempt stays listed with Resume after the batch window and status move on (Q702)", async () => {
      await start(w.candidate, w.batch._id, w.paper._id);
      await Batch.updateOne(
        { _id: w.batch._id },
        {
          status: "assessment_completed",
          assessmentStartDate: day(-5),
          assessmentEndDate: day(-1),
        },
      );
      const [item] = await itemsOf(w.candidate);
      expect(item.paperId).toBe(String(w.paper._id));
      expect(item.attempt.status).toBe("in_progress");
      expect(item.attempt.remainingSeconds).toBeGreaterThan(0);
      expect(item.startable).toEqual({ ok: true });
      // Start itself replays the open attempt, so Resume works.
      const again = await start(w.candidate, w.batch._id, w.paper._id);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe("in_progress");
    });

    it("an open attempt past its deadline shows no time left and cannot resume", async () => {
      const started = await start(w.candidate, w.batch._id, w.paper._id);
      await Attempt.updateOne(
        { _id: started.body.id },
        { deadlineAt: new Date(Date.now() - 5_000), acceptUntil: new Date(Date.now() + 25_000) },
      );
      const [item] = await itemsOf(w.candidate);
      expect(item.attempt.status).toBe("in_progress");
      expect(item.attempt.remainingSeconds).toBe(0);
      expect(item.startable).toEqual({ ok: false, reason: "ATTEMPT_TIME_UP" });
    });

    it("a closed attempt stays listed as completed after the batch is no longer in progress (X-13)", async () => {
      const started = await start(w.candidate, w.batch._id, w.paper._id);
      await request(app)
        .post(`/api/v1/attempts/${started.body.id}/submit`)
        .set(bearer(w.candidate.token))
        .send({});
      await Batch.updateOne({ _id: w.batch._id }, { status: "assessment_completed" });
      const items = await itemsOf(w.candidate);
      expect(items).toHaveLength(1);
      expect(items[0].attempt.status).toBe("submitted");
      expect(items[0].startable).toEqual({ ok: false, reason: "ATTEMPT_CLOSED" });
    });

    it("a batch with no attempt of this candidate is still not listed once it has moved on (X-13)", async () => {
      await Batch.updateOne({ _id: w.batch._id }, { status: "assessment_completed" });
      expect(await itemsOf(w.candidate)).toEqual([]);
    });

    it("submitted: cannot start again", async () => {
      const started = await start(w.candidate, w.batch._id, w.paper._id);
      await request(app)
        .post(`/api/v1/attempts/${started.body.id}/submit`)
        .set(bearer(w.candidate.token))
        .send({});
      const [item] = await itemsOf(w.candidate);
      expect(item.attempt.status).toBe("submitted");
      expect(item.startable).toEqual({ ok: false, reason: "ATTEMPT_CLOSED" });
      // Start replays the closed attempt and makes no new one.
      const again = await start(w.candidate, w.batch._id, w.paper._id);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe("submitted");
      expect(await Attempt.countDocuments({ candidateId: w.roster._id })).toBe(1);
    });

    it("timed out: an expired open attempt closes on the list read", async () => {
      const started = await start(w.candidate, w.batch._id, w.paper._id);
      await Attempt.updateOne(
        { _id: started.body.id },
        { deadlineAt: new Date(Date.now() - 60_000), acceptUntil: new Date(Date.now() - 30_000) },
      );
      const [item] = await itemsOf(w.candidate);
      expect(item.attempt.status).toBe("timed_out");
      expect(item.startable).toEqual({ ok: false, reason: "ATTEMPT_CLOSED" });
      expect((await Attempt.findById(started.body.id).lean()).status).toBe("timed_out");
    });
  });

  describe("mock-test batches (X-19)", () => {
    it("lists and starts a draft paper only when the batch skips the reviewer's approval", async () => {
      await TestPaper.updateOne({ _id: w.paper._id }, { status: "draft" });
      // Not approved and the batch does not skip approval: not listed, and start looks the same.
      expect(await itemsOf(w.candidate)).toEqual([]);
      expect((await start(w.candidate, w.batch._id, w.paper._id)).status).toBe(404);

      await Batch.updateOne({ _id: w.batch._id }, { $set: { "settings.skipPaperApproval": true } });
      const items = await itemsOf(w.candidate);
      expect(items).toHaveLength(1);
      expect(items[0].startable).toEqual({ ok: true });
      expect((await start(w.candidate, w.batch._id, w.paper._id)).status).toBe(201);

      // An incomplete paper is never usable, whatever the setting.
      await TestPaper.updateOne({ _id: w.otherPaper._id }, { status: "draft", complete: false });
      await Batch.updateOne(
        { _id: w.otherBatch._id },
        { $set: { "settings.skipPaperApproval": true } },
      );
      expect((await start(w.otherCandidate, w.otherBatch._id, w.otherPaper._id)).status).toBe(404);
    });
  });

  describe("list and start agree", () => {
    const absent = () =>
      AttendanceRecord.create({
        batchId: w.batch._id,
        candidateId: w.roster._id,
        present: false,
        capturedAt: new Date(),
        receivedAt: new Date(),
        assessorId: oid(),
        recordedBy: oid(),
      });

    it.each([
      [
        "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW",
        "before the window",
        () =>
          Batch.updateOne(
            { _id: w.batch._id },
            { assessmentStartDate: day(2), assessmentEndDate: day(3) },
          ),
      ],
      [
        "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW",
        "after the window",
        () =>
          Batch.updateOne(
            { _id: w.batch._id },
            { assessmentStartDate: day(-3), assessmentEndDate: day(-2) },
          ),
      ],
      [
        "ATTEMPT_LANGUAGE_MISMATCH",
        "a Hindi paper on an English batch",
        () => TestPaper.updateOne({ _id: w.paper._id }, { "rules.language": "hi" }),
      ],
      ["ATTEMPT_CANDIDATE_ABSENT", "an absent candidate", () => absent()],
      [
        "ATTEMPT_PAPER_UNAVAILABLE",
        "a paper with a deleted question",
        () => Question.deleteOne({ _id: w.paper.items[0].questionId }),
      ],
    ])("%s (%s)", async (code, _label, arrange) => {
      await arrange();
      const [item] = await itemsOf(w.candidate);
      expect(item.startable).toEqual({ ok: false, reason: code });
      const res = await start(w.candidate, w.batch._id, w.paper._id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
    });

    it("startable: true, and start creates the attempt", async () => {
      const [item] = await itemsOf(w.candidate);
      expect(item.startable).toEqual({ ok: true });
      expect((await start(w.candidate, w.batch._id, w.paper._id)).status).toBe(201);
    });

    it("an English-name batch matches an 'en' paper", async () => {
      const [item] = await itemsOf(w.candidate);
      expect(item.startable.ok).toBe(true);
    });
  });
});
