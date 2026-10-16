import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
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

const makePaper = (qualificationId, over = {}) =>
  TestPaper.create({
    qualificationId,
    name: "Paper",
    status: "approved",
    seed: 1,
    rules: { language: "en", quotas: [{ nosId: "NOS-01", count: 1 }] },
    poolHash: "x",
    items: [],
    totalMarks: 0,
    complete: true,
    createdBy: oid(),
    approvedBy: oid(),
    approvedAt: new Date(),
    ...over,
  });

const makeBatch = (qualificationId, over = {}) =>
  Batch.create({
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

describe("PUT /api/v1/batches/:id/test-paper (B-18a, D5)", () => {
  let qualificationId;
  let batch;
  let paper;
  let admin;

  const put = (session, id, body) =>
    request(app).put(`/api/v1/batches/${id}/test-paper`).set(bearer(session.token)).send(body);
  const setPaper = (p = paper, session = admin) =>
    put(session, batch._id, { testPaperId: String(p._id) });

  beforeAll(async () => {
    await startMongo();
    await Attempt.syncIndexes();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    qualificationId = oid();
    batch = await makeBatch(qualificationId);
    paper = await makePaper(qualificationId);
    admin = await sessionFor("aa_admin");
  });

  it("sets the paper and returns it on the batch, audited with before and after", async () => {
    const res = await setPaper();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.testPaperId).toBe(String(paper._id));
    expect((await Batch.findById(batch._id).lean()).testPaperId).toEqual(paper._id);

    const get = await request(app).get(`/api/v1/batches/${batch._id}`).set(bearer(admin.token));
    expect(get.body.testPaperId).toBe(String(paper._id));

    const row = await AuditLog.findOne({ action: "batch.set_test_paper" }).lean();
    expect(row).toMatchObject({
      actorRole: "aa_admin",
      entity: "batch",
      before: { testPaperId: null },
      after: { testPaperId: String(paper._id) },
    });
  });

  it("shows no paper on a batch that has none", async () => {
    const get = await request(app).get(`/api/v1/batches/${batch._id}`).set(bearer(admin.token));
    expect(get.body.testPaperId).toBeNull();
  });

  it("changes the paper before any attempt, and audits the old and new id", async () => {
    const second = await makePaper(qualificationId);
    expect((await setPaper()).status).toBe(200);
    const res = await setPaper(second);
    expect(res.status).toBe(200);
    expect(res.body.testPaperId).toBe(String(second._id));
    const rows = await AuditLog.find({ action: "batch.set_test_paper" })
      .sort({ createdAt: 1 })
      .lean();
    expect(rows).toHaveLength(2);
    expect(rows[1].before.testPaperId).toBe(String(paper._id));
    expect(rows[1].after.testPaperId).toBe(String(second._id));
  });

  it("refuses a draft, a submitted and an incomplete paper", async () => {
    for (const over of [{ status: "draft" }, { status: "submitted" }, { complete: false }]) {
      const bad = await makePaper(qualificationId, over);
      const res = await setPaper(bad);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("BATCH_TEST_PAPER_NOT_APPROVED");
    }
    expect((await Batch.findById(batch._id).lean()).testPaperId).toBeNull();
  });

  it("refuses a paper of another qualification", async () => {
    const res = await setPaper(await makePaper(oid()));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BATCH_TEST_PAPER_QUALIFICATION_MISMATCH");
  });

  it("refuses a paper whose language differs from the batch, and accepts a matching name or code", async () => {
    const hindi = await makePaper(qualificationId, { "rules.language": "hi" });
    const res = await setPaper(hindi);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BATCH_TEST_PAPER_LANGUAGE_MISMATCH");
    // The batch says "English", the paper says "en": they match.
    expect((await setPaper()).status).toBe(200);
    const named = await makePaper(qualificationId, { "rules.language": " english " });
    expect((await setPaper(named)).status).toBe(200);
  });

  it("returns 404 for an unknown batch or paper, and 400 for bad bodies", async () => {
    expect((await put(admin, oid(), { testPaperId: String(paper._id) })).status).toBe(404);
    expect((await put(admin, batch._id, { testPaperId: String(oid()) })).status).toBe(404);
    for (const body of [
      {},
      { testPaperId: "nope" },
      { testPaperId: null },
      { testPaperId: String(paper._id), extra: 1 },
    ]) {
      const res = await put(admin, batch._id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await put(admin, "not-an-id", { testPaperId: String(paper._id) })).status).toBe(400);
  });

  it("is refused once an attempt exists on the batch", async () => {
    const second = await makePaper(qualificationId);
    expect((await setPaper()).status).toBe(200);
    const roster = await Candidate.create({
      batchId: batch._id,
      learnerId: oid(),
      name: "Asha Devi",
      active: true,
    });
    await Attempt.create({
      testPaperId: paper._id,
      batchId: batch._id,
      abId: batch.abId,
      candidateId: roster._id,
      learnerId: roster.learnerId,
      userId: oid(),
      status: "submitted",
      startedAt: new Date(),
      deadlineAt: new Date(),
      acceptUntil: new Date(),
      graceSeconds: 30,
      durationMinutes: 20,
      questions: [],
    });
    const res = await setPaper(second);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BATCH_TEST_PAPER_LOCKED");
    // Setting the same paper again is refused too: nothing changes after the first attempt.
    expect((await setPaper()).status).toBe(409);
    expect((await Batch.findById(batch._id).lean()).testPaperId).toEqual(paper._id);
    expect(await AuditLog.countDocuments({ action: "batch.set_test_paper" })).toBe(1);
  });

  it("is for aa_admin only", async () => {
    for (const role of [
      "mis",
      "sme",
      "assessor",
      "proctor",
      "candidate",
      "tp",
      "ab_reviewer",
      "ncvet_viewer",
    ]) {
      const session = await sessionFor(role, { abId: batch.abId, linkedProfileId: oid() });
      const res = await setPaper(paper, session);
      expect(res.status, role).toBe(403);
    }
    expect(
      (await request(app).put(`/api/v1/batches/${batch._id}/test-paper`).send({})).status,
    ).toBe(401);
    expect((await Batch.findById(batch._id).lean()).testPaperId).toBeNull();
    expect(await AuditLog.countDocuments({ action: "batch.set_test_paper" })).toBe(0);
  });
});
