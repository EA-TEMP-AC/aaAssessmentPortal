import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Attempt } from "../src/models/attempt.model.js";
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

async function makePaper(qualificationId, over = {}, language = "en") {
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
      language,
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
    rules: { language, quotas: [{ nosId: "NOS-01", count: 3 }] },
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

async function world() {
  const qualificationId = oid();
  await Qualification.collection.insertOne({
    _id: qualificationId,
    code: "ELE/Q0001",
    name: "Field Technician",
  });
  const english = await makePaper(qualificationId);
  const hindi = await makePaper(qualificationId, {}, "hi");
  const batch = await makeBatch(qualificationId, { testPaperId: english._id });
  const learnerId = oid();
  await Candidate.create({ batchId: batch._id, learnerId, name: "Asha Devi", active: true });
  return {
    qualificationId,
    english,
    hindi,
    batch,
    admin: await sessionFor("aa_admin"),
    candidate: await sessionFor("candidate", { linkedProfileId: learnerId }),
  };
}

const putPapers = (who, batchId, papers) =>
  request(app)
    .put(`/api/v1/batches/${batchId}/language-papers`)
    .set(bearer(who.token))
    .send({ papers });
const available = (who) => request(app).get("/api/v1/attempts/available").set(bearer(who.token));
const start = (who, batchId, paperId) =>
  request(app)
    .post("/api/v1/attempts/start")
    .set(bearer(who.token))
    .send({ batchId: String(batchId), testPaperId: String(paperId) });

describe("papers in more than one language (X-33)", () => {
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

  const entry = () => [{ language: "Hindi", testPaperId: String(w.hindi._id) }];
  const turnOn = () =>
    Batch.updateOne({ _id: w.batch._id }, { $set: { "settings.languages.theory": true } });

  it("needs the theory languages switch, and only aa_admin can set the papers", async () => {
    const off = await putPapers(w.admin, w.batch._id, entry());
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe("BATCH_FEATURE_OFF");
    await turnOn();
    expect((await putPapers(w.candidate, w.batch._id, entry())).status).toBe(403);
    const ok = await putPapers(w.admin, w.batch._id, entry());
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.languagePapers).toEqual([
      { language: "Hindi", testPaperId: String(w.hindi._id) },
    ]);
  });

  it("refuses a paper in the wrong language, the batch language, or a repeat", async () => {
    await turnOn();
    const wrong = await putPapers(w.admin, w.batch._id, [
      { language: "Tamil", testPaperId: String(w.hindi._id) },
    ]);
    expect(wrong.body.error.code).toBe("BATCH_TEST_PAPER_LANGUAGE_MISMATCH");
    const same = await putPapers(w.admin, w.batch._id, [
      { language: "English", testPaperId: String(w.hindi._id) },
    ]);
    expect(same.status).toBe(400);
    const twice = await putPapers(w.admin, w.batch._id, [
      ...entry(),
      { language: "hindi", testPaperId: String(w.hindi._id) },
    ]);
    expect(twice.status).toBe(400);
  });

  it("offers both languages, then keeps the one the candidate started", async () => {
    await turnOn();
    expect((await putPapers(w.admin, w.batch._id, entry())).status).toBe(200);

    const before = (await available(w.candidate)).body.items;
    expect(before.map((i) => i.language).sort()).toEqual(["en", "hi"]);

    const started = await start(w.candidate, w.batch._id, w.hindi._id);
    expect(started.status).toBe(201);

    const after = (await available(w.candidate)).body.items;
    expect(after.map((i) => i.paperId)).toEqual([String(w.hindi._id)]);

    // Asking for the other language gives back the one already started; there is still one attempt.
    const again = await start(w.candidate, w.batch._id, w.english._id);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(started.body.id);
    expect(await Attempt.countDocuments({ batchId: w.batch._id })).toBe(1);

    // The papers are fixed once an attempt exists.
    const locked = await putPapers(w.admin, w.batch._id, []);
    expect(locked.body.error.code).toBe("BATCH_TEST_PAPER_LOCKED");
  });

  it("does not start a paper that is not one of the batch's papers", async () => {
    const res = await start(w.candidate, w.batch._id, w.hindi._id);
    expect(res.status).toBe(404);
  });
});
