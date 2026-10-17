import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { ExamVideoChunk } from "../src/models/exam-video-chunk.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { deleteExpiredVideo } from "../src/modules/proctoring/video.service.js";
import { setVideoDirForTests } from "../src/modules/proctoring/video-storage.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const API = "/api/v1/proctoring";
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

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

const WEBM_FIRST = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from("first-piece"),
]);
const WEBM_NEXT = Buffer.from("second-piece");

const startSession = (who) =>
  request(app)
    .post(`${API}/sessions`)
    .set(bearer(who.token))
    .send({ attemptId: String(who.attempt._id) });
const sendPiece = (who, sessionId, track, seq, bytes) =>
  request(app)
    .post(`${API}/sessions/${sessionId}/video/${track}/${seq}`)
    .set(bearer(who.token))
    .set("Content-Type", "video/webm")
    .send(bytes);
const listVideo = (who, sessionId) =>
  request(app).get(`${API}/sessions/${sessionId}/video`).set(bearer(who.token));
const watch = (who, sessionId, track) =>
  request(app)
    .get(`${API}/sessions/${sessionId}/video/${track}`)
    .set(bearer(who.token))
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

describe("Exam video (X-27)", () => {
  let dir;
  let batch;
  let asha;
  let admin;
  let proctor;
  let tp;
  let assessor;
  let sessionId;

  beforeAll(async () => {
    await startMongo();
    await mongoose.syncIndexes();
    dir = mkdtempSync(path.join(os.tmpdir(), "exam-video-"));
    setVideoDirForTests(dir);
  });
  afterAll(async () => {
    setVideoDirForTests(null);
    rmSync(dir, { recursive: true, force: true });
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    batch = await makeBatch();
    asha = await candidateWithAttempt(batch);
    admin = await sessionFor("aa_admin");
    proctor = await sessionFor("proctor", { linkedProfileId: batch.proctorId });
    tp = await sessionFor("tp", { tpId: batch.tpId });
    assessor = await sessionFor("assessor", { linkedProfileId: batch.assessorId });
  });

  const turnOn = (extra = {}) =>
    Batch.updateOne(
      { _id: batch._id },
      { $set: { settings: { requireScreenShare: true, recordVideo: true, ...extra } } },
    );
  const begin = async () => {
    const res = await startSession(asha);
    expect(res.status).toBe(201);
    sessionId = res.body.id;
    return res.body;
  };

  it("tells the browser to record only when the batch setting is on", async () => {
    expect((await begin()).config.recordVideo).toBe(false);
  });

  it("tells the browser to record, and how often to send, when the setting is on", async () => {
    await turnOn();
    const body = await begin();
    expect(body.config.recordVideo).toBe(true);
    expect(body.config.videoChunkSeconds).toBe(10);
  });

  it("refuses a piece when the batch does not record video", async () => {
    await begin();
    const res = await sendPiece(asha, sessionId, "camera", 0, WEBM_FIRST);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VIDEO_NOT_ENABLED");
  });

  it("saves pieces, is idempotent, refuses a different piece in the same place and a non-WebM start", async () => {
    await turnOn();
    await begin();
    const one = await sendPiece(asha, sessionId, "camera", 0, WEBM_FIRST);
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect((await sendPiece(asha, sessionId, "camera", 0, WEBM_FIRST)).status).toBe(200);
    const clash = await sendPiece(
      asha,
      sessionId,
      "camera",
      0,
      Buffer.concat([WEBM_FIRST, Buffer.from("x")]),
    );
    expect(clash.status).toBe(409);
    expect((await sendPiece(asha, sessionId, "screen", 0, Buffer.from("not webm"))).status).toBe(
      400,
    );
    expect((await sendPiece(asha, sessionId, "audio", 0, WEBM_FIRST)).status).toBe(400);
    expect((await sendPiece(asha, sessionId, "camera", 99999, WEBM_FIRST)).status).toBe(400);
    expect(await ExamVideoChunk.countDocuments()).toBe(1);
    const row = await ExamVideoChunk.findOne().lean();
    expect(row.expiresAt.getTime() - row.receivedAt.getTime()).toBe(90 * 86_400_000);
  });

  it("only the candidate of the session can send pieces", async () => {
    await turnOn();
    await begin();
    for (const who of [admin, proctor, tp, assessor]) {
      expect((await sendPiece(who, sessionId, "camera", 0, WEBM_FIRST)).status).toBe(403);
    }
    const other = await candidateWithAttempt(await makeBatch());
    expect((await sendPiece(other, sessionId, "camera", 0, WEBM_FIRST)).status).toBe(403);
  });

  it("joins the pieces in order for aa_admin, logs the look, and follows videoVisibleTo", async () => {
    await turnOn();
    await begin();
    await sendPiece(asha, sessionId, "camera", 1, WEBM_NEXT);
    await sendPiece(asha, sessionId, "camera", 0, WEBM_FIRST);
    const list = await listVideo(admin, sessionId);
    expect(list.status).toBe(200);
    expect(list.body.tracks.camera).toMatchObject({ pieces: 2, complete: true });
    expect(list.body.tracks.screen.pieces).toBe(0);
    expect(list.body.retentionDays).toBe(90);

    const file = await watch(admin, sessionId, "camera");
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body, Buffer.concat([WEBM_FIRST, WEBM_NEXT]))).toBe(0);
    expect(await AccessLog.countDocuments({ subjectId: sessionId })).toBe(1);

    // Default: aa_admin and the batch's proctor. Not the training partner or the assessor.
    expect((await listVideo(proctor, sessionId)).status).toBe(200);
    expect((await listVideo(tp, sessionId)).status).toBe(403);
    expect((await watch(assessor, sessionId, "camera")).status).toBe(403);
    // The AA admin can widen or narrow it later.
    await turnOn({ videoVisibleTo: ["tp"] });
    expect((await listVideo(tp, sessionId)).status).toBe(200);
    expect((await listVideo(proctor, sessionId)).status).toBe(403);
    expect((await watch(admin, sessionId, "screen")).status).toBe(404);
  });

  it("saving a copy needs the batch's download switch, is limited to the video viewers and is logged (X-28)", async () => {
    await turnOn();
    await begin();
    await sendPiece(asha, sessionId, "camera", 0, WEBM_FIRST);
    const download = (who) =>
      request(app)
        .get(`/api/v1/proctoring/sessions/${sessionId}/video/camera?download=1`)
        .set(bearer(who.token));
    expect((await watch(admin, sessionId, "camera")).status).toBe(200);
    const listed = await request(app)
      .get(`/api/v1/proctoring/sessions/${sessionId}/video`)
      .set(bearer(admin.token));
    expect(listed.body.canDownload).toBe(false);
    expect((await download(admin)).status).toBe(403);
    await Batch.updateOne({ _id: batch._id }, { $set: { "settings.downloadSessionVideo": true } });
    const ok = await download(admin);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-disposition"]).toBe(
      `attachment; filename="exam-${sessionId}-camera.webm"`,
    );
    expect((await download(proctor)).status).toBe(200);
    expect((await download(tp)).status).toBe(403);
    expect((await download(asha)).status).toBe(403);
    const logged = await AccessLog.find({}).lean();
    expect(JSON.stringify(logged)).toContain("exam_video_camera_download");
  });

  it("deletes pieces and files after the retention date and writes one audit row", async () => {
    await turnOn();
    await begin();
    await sendPiece(asha, sessionId, "camera", 0, WEBM_FIRST);
    expect(await deleteExpiredVideo(new Date())).toBe(0);
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await deleteExpiredVideo(later)).toBe(1);
    expect(await ExamVideoChunk.countDocuments()).toBe(0);
    expect((await watch(admin, sessionId, "camera")).status).toBe(404);
    const rows = await AuditLog.find({ action: "exam_video.expire" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ removed: 1 });
  });

  it("the video settings: needs screen sharing, valid roles and failure action", async () => {
    const patch = (body) =>
      request(app)
        .patch(`/api/v1/batches/${batch._id}/settings`)
        .set(bearer(admin.token))
        .send(body);
    expect((await patch({ recordVideo: true })).status).toBe(400);
    expect((await patch({ requireScreenShare: true, recordVideo: true })).status).toBe(200);
    // Switching sharing off while recording is on is refused too.
    expect((await patch({ requireScreenShare: false })).status).toBe(400);
    const ok = await patch({ videoFailureAction: "require", videoVisibleTo: ["proctor", "tp"] });
    expect(ok.body.settings).toMatchObject({
      recordVideo: true,
      videoFailureAction: "require",
      videoVisibleTo: ["tp", "proctor"],
    });
    expect((await patch({ videoFailureAction: "stop" })).status).toBe(400);
    expect((await patch({ videoVisibleTo: ["candidate"] })).status).toBe(400);
    expect((await patch({ videoVisibleTo: [] })).body.settings.videoVisibleTo).toEqual([]);
  });

  it("accepts the recording_failed flag with medium severity", async () => {
    await turnOn();
    await begin();
    const res = await request(app)
      .post(`${API}/sessions/${sessionId}/flags`)
      .set(bearer(asha.token))
      .send({
        clientEventId: "evt-rec-1",
        type: "recording_failed",
        capturedAt: "2026-11-20T05:00:00.000Z",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.severity).toBe("medium");
  });
});
