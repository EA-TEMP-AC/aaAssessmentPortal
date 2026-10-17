import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Question } from "../src/models/question.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const API = "/api/v1/proctoring";
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const CAPTURED_AT = "2026-11-20T05:00:00.000Z";
const LOCATION = { latitude: 19.076123, longitude: 72.877456, accuracy: 12.5 };
const COORDINATE_TEXT = ["19.076123", "72.877456"];

let seq = 0;

async function sessionFor(role, extra = {}) {
  const email = `${role}-${oid()}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: String(user._id) };
}

async function makeBatch() {
  return Batch.create({
    abId: oid(),
    qualificationId: oid(),
    type: "STT",
    mode: "online",
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
    assessorId: oid(),
    proctorId: oid(),
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
  });
}

async function candidateWithAttempt(batch) {
  const learnerId = oid();
  const roster = await Candidate.create({
    batchId: batch._id,
    learnerId,
    name: "Asha Devi",
    active: true,
  });
  const login = await sessionFor("candidate", { linkedProfileId: learnerId });
  const startedAt = new Date();
  const attempt = await Attempt.create({
    testPaperId: oid(),
    batchId: batch._id,
    abId: batch.abId,
    candidateId: roster._id,
    learnerId,
    userId: login.userId,
    status: "in_progress",
    durationMinutes: 60,
    graceSeconds: 30,
    startedAt,
    deadlineAt: new Date(startedAt.getTime() + 3_600_000),
    acceptUntil: new Date(startedAt.getTime() + 3_630_000),
    questions: [],
    rev: 0,
  });
  return { ...login, attempt, learnerId };
}

const startSession = (who) =>
  request(app)
    .post(`${API}/sessions`)
    .set(bearer(who.token))
    .send({ attemptId: String(who.attempt._id) });
const sendFlag = (who, sessionId, body) =>
  request(app)
    .post(`${API}/sessions/${sessionId}/flags`)
    .set(bearer(who.token))
    .send({
      clientEventId: `evt-${++seq}`,
      type: "face_not_present",
      capturedAt: CAPTURED_AT,
      ...body,
    });
const capture = (who, flagId) =>
  request(app).get(`${API}/flags/${flagId}/capture`).set(bearer(who.token));
const setCapture = (who, batchId, captureLocation) =>
  request(app)
    .put(`/api/v1/batches/${batchId}/capture-location`)
    .set(bearer(who.token))
    .send({ captureLocation });

/** A raw read, so the stored form is seen, not the decrypted one. */
async function rawFlag(id) {
  return mongoose.connection.db
    .collection("proctoringFlags")
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
}

describe("Location on flag photos (X-07)", () => {
  let batch;
  let asha;
  let admin;
  let tp;
  let proctor;
  let assessor;

  beforeAll(async () => {
    await startMongo();
    await mongoose.syncIndexes();
  });
  afterAll(stopMongo);
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    batch = await makeBatch();
    asha = await candidateWithAttempt(batch);
    admin = await sessionFor("aa_admin");
    tp = await sessionFor("tp", { tpId: batch.tpId });
    proctor = await sessionFor("proctor", { linkedProfileId: batch.proctorId });
    assessor = await sessionFor("assessor", { linkedProfileId: batch.assessorId });
  });

  const locationOn = () => Batch.updateOne({ _id: batch._id }, { $set: { captureLocation: true } });

  async function flagWithLocation(location = LOCATION) {
    const session = (await startSession(asha)).body;
    const res = await sendFlag(asha, session.id, { location });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { session, flag: res.body };
  }

  describe("batch setting", () => {
    it("is off by default and the session tells the browser so", async () => {
      const res = await startSession(asha);
      expect(res.status).toBe(201);
      expect(res.body.captureLocation).toBe(false);
      expect(res.body.config.flagSeverity.face_not_present).toBe("medium");
    });

    it("aa_admin turns it on, audited with before and after; other roles are refused", async () => {
      const denied = await setCapture(await sessionFor("mis"), batch._id, true);
      expect(denied.status).toBe(403);
      const res = await setCapture(admin, batch._id, true);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.captureLocation).toBe(true);
      const audit = await AuditLog.findOne({ action: "batch.set_capture_location" }).lean();
      expect(audit.before).toEqual({ captureLocation: false });
      expect(audit.after).toEqual({ captureLocation: true });
      expect((await startSession(asha)).body.captureLocation).toBe(true);
    });

    it("rejects unknown keys and non-boolean values", async () => {
      expect((await setCapture(admin, batch._id, "yes")).status).toBe(400);
      const res = await request(app)
        .put(`/api/v1/batches/${batch._id}/capture-location`)
        .set(bearer(admin.token))
        .send({ captureLocation: true, extra: 1 });
      expect(res.status).toBe(400);
    });
  });

  describe("saving a flag", () => {
    it("location off: coordinates sent anyway are not kept", async () => {
      const { flag } = await flagWithLocation();
      const row = await rawFlag(flag.id);
      expect(row.locationStatus).toBe("not_shared");
      expect(row.location ?? null).toBeNull();
    });

    it("location on, refused in the browser: the flag has no location", async () => {
      await locationOn();
      const session = (await startSession(asha)).body;
      const res = await sendFlag(asha, session.id, {});
      expect(res.status).toBe(201);
      const out = await capture(admin, res.body.id);
      expect(out.body.locationStatus).toBe("not_shared");
      expect(out.body.location).toBeNull();
    });

    it("location on, allowed: kept encrypted, not readable in the stored row", async () => {
      await locationOn();
      const { flag } = await flagWithLocation();
      const row = await rawFlag(flag.id);
      expect(row.locationStatus).toBe("captured");
      expect(row.location.startsWith("enc:v1:")).toBe(true);
      for (const text of COORDINATE_TEXT) expect(JSON.stringify(row)).not.toContain(text);
    });

    it("rejects out-of-range coordinates and unknown location keys", async () => {
      const session = (await startSession(asha)).body;
      const bad = [
        { latitude: 91, longitude: 1 },
        { latitude: 1, longitude: 181 },
        { latitude: 1, longitude: 1, city: "x" },
      ];
      for (const location of bad) {
        expect((await sendFlag(asha, session.id, { location })).status).toBe(400);
      }
    });

    it("keeps coordinates out of audit rows, access logs and the console", async () => {
      await locationOn();
      const spies = ["log", "info", "warn", "error"].map((k) =>
        vi.spyOn(console, k).mockImplementation(() => {}),
      );
      try {
        const { flag } = await flagWithLocation();
        await capture(admin, flag.id);
        await capture(proctor, flag.id);
        const audits = JSON.stringify(await AuditLog.find({}).lean());
        const access = JSON.stringify(await AccessLog.find({}).lean());
        const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
        for (const text of COORDINATE_TEXT) {
          expect(audits).not.toContain(text);
          expect(access).not.toContain(text);
          expect(logged).not.toContain(text);
        }
        expect(audits).toContain("proctoring.flag");
        expect(access).toContain("proctoringFlag");
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
  });

  describe("photo details read", () => {
    beforeEach(locationOn);

    it("gives aa_admin, the batch tp and the assigned proctor the coordinates, and logs each read", async () => {
      const { flag } = await flagWithLocation();
      for (const who of [admin, tp, proctor]) {
        const res = await capture(who, flag.id);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.locationVisible).toBe(true);
        expect(res.body.location).toEqual({
          latitude: 19.076123,
          longitude: 72.877456,
          accuracy: 12.5,
        });
      }
      const logs = await AccessLog.find({}).lean();
      expect(logs.filter((l) => l.subjectType === "proctoringFlag")).toHaveLength(3);
      expect(logs.filter((l) => l.subjectType === "learner")).toHaveLength(3);
      expect(logs.map((l) => l.actorRole).sort()).toEqual(
        ["aa_admin", "aa_admin", "proctor", "proctor", "tp", "tp"].sort(),
      );
    });

    it("gives other staff the server-made details but no coordinates, and logs nothing", async () => {
      const { flag } = await flagWithLocation();
      const hold = compliance.PROCTOR_SUSTAINED_SECONDS.face_not_present;
      const readers = [
        assessor,
        await sessionFor("ab_reviewer", { abId: batch.abId }),
        await sessionFor("ncvet_viewer"),
      ];
      for (const who of readers) {
        const res = await capture(who, flag.id);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.reason).toBe(
          `Face not visible for ${hold} ${hold === 1 ? "second" : "seconds"}`,
        );
        expect(res.body.severity).toBe("medium");
        expect(res.body.capturedAt).toBe(CAPTURED_AT);
        expect(typeof res.body.receivedAt).toBe("string");
        expect(res.body.evidenceId).toBeNull();
        expect(res.body.locationStatus).toBe("captured");
        expect(res.body.locationVisible).toBe(false);
        expect(res.body.location).toBeNull();
        expect(JSON.stringify(res.body)).not.toContain("19.076");
      }
      expect(await AccessLog.countDocuments({})).toBe(0);
    });

    it("refuses a proctor of another batch, a tp of another partner, mis and the candidate", async () => {
      const { flag } = await flagWithLocation();
      const otherProctor = await sessionFor("proctor", { linkedProfileId: oid() });
      const otherTp = await sessionFor("tp", { tpId: oid() });
      for (const who of [otherProctor, otherTp, await sessionFor("mis"), asha]) {
        expect((await capture(who, flag.id)).status).toBe(403);
      }
      expect((await capture(admin, String(oid()))).status).toBe(404);
      expect(await AccessLog.countDocuments({})).toBe(0);
    });

    it("does not serve a coordinate read that cannot be logged", async () => {
      const { flag } = await flagWithLocation();
      const spy = vi.spyOn(AccessLog, "insertMany").mockRejectedValue(new Error("down"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const res = await capture(admin, flag.id);
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain("19.076");
      } finally {
        spy.mockRestore();
        quiet.mockRestore();
      }
    });
  });

  // Found while building X-07, not fixed here (DECISIONS 823): the evidence upload accepts
  // latitude, longitude and accuracy from a candidate on a proctor_snapshot and keeps them as
  // plain numbers on the evidence row. The browser never sends them.
  it.todo("rejects location fields on a candidate's proctor_snapshot upload");

  it("the session detail says whether a flag kept a location, never the coordinates", async () => {
    await locationOn();
    const { session } = await flagWithLocation();
    const res = await request(app).get(`${API}/sessions/${session.id}`).set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.flags[0].locationStatus).toBe("captured");
    expect(JSON.stringify(res.body)).not.toContain("19.076");
  });
});

describe("Question and answer on a flag (X-23)", () => {
  let batch;
  let asha;
  let admin;
  let proctor;
  let assessor;
  let question;

  beforeAll(async () => {
    await startMongo();
    await mongoose.syncIndexes();
  });
  afterAll(stopMongo);
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    batch = await makeBatch();
    asha = await candidateWithAttempt(batch);
    admin = await sessionFor("aa_admin");
    proctor = await sessionFor("proctor", { linkedProfileId: batch.proctorId });
    assessor = await sessionFor("assessor", { linkedProfileId: batch.assessorId });
    question = await Question.create({
      qualificationId: batch.qualificationId,
      nosId: "NOS-01",
      pcId: "PC-1",
      type: "mcq",
      language: "English",
      stem: "Which tool measures current?",
      options: [
        { key: "A", text: "Ammeter" },
        { key: "B", text: "Voltmeter" },
      ],
      correctAnswer: "A",
      marks: 1,
    });
    await Attempt.updateOne(
      { _id: asha.attempt._id },
      {
        $set: {
          questions: [
            { questionId: oid(), version: 1, nosId: "N", pcId: "P", type: "mcq", marks: 1 },
            {
              questionId: question._id,
              version: 1,
              nosId: "NOS-01",
              pcId: "PC-1",
              type: "mcq",
              marks: 1,
              answer: "B",
            },
          ],
        },
      },
    );
  });

  it("keeps the place of the question and the answer saved at that moment", async () => {
    const session = (await startSession(asha)).body;
    const res = await sendFlag(asha, session.id, { questionId: String(question._id) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await rawFlag(res.body.id);
    expect(row.questionNumber).toBe(2);
    expect(row.answerAtFlag).toBe("B");
  });

  it("shows the question text to aa_admin and the proctor, not to others", async () => {
    const session = (await startSession(asha)).body;
    const res = await sendFlag(asha, session.id, { questionId: String(question._id) });
    for (const who of [admin, proctor]) {
      const out = await capture(who, res.body.id);
      expect(out.status).toBe(200);
      expect(out.body.question).toMatchObject({
        number: 2,
        text: "Which tool measures current?",
        answer: "B",
      });
      expect(out.body.question.options).toHaveLength(2);
    }
    const other = await capture(assessor, res.body.id);
    expect(other.body.question).toEqual({ number: 2, text: null, options: null, answer: "B" });
  });

  it("refuses a question that is not in the attempt, and a flag with none has no question", async () => {
    const session = (await startSession(asha)).body;
    const bad = await sendFlag(asha, session.id, { questionId: String(oid()) });
    expect(bad.status).toBe(400);
    const none = await sendFlag(asha, session.id, {});
    expect(none.status).toBe(201);
    expect((await capture(admin, none.body.id)).body.question).toBeNull();
  });
});
