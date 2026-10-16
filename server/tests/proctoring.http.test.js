import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { Attempt } from "../src/models/attempt.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Evidence } from "../src/models/evidence.model.js";
import { PROCTORING_FLAG_TYPES, ProctoringFlag } from "../src/models/proctoring-flag.model.js";
import { ProctoringSession } from "../src/models/proctoring-session.model.js";
import { Result } from "../src/models/result.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { createLocalStorage } from "../src/modules/evidence/storage/local.driver.js";
import { setEvidenceStorage } from "../src/modules/evidence/storage/storage.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const API = "/api/v1/proctoring";
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const CAPTURED_AT = "2026-11-20T05:00:00.000Z";
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 3),
  ]);

let storageDir;
let seq = 0;

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
  return { token: res.body.accessToken, userId: String(user._id), password };
}

async function makeBatch(over = {}) {
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
    ...over,
  });
}

/** A candidate on the roster with an attempt in progress. */
async function candidateWithAttempt(batch, name = "Asha Devi") {
  const learnerId = oid();
  const roster = await Candidate.create({ batchId: batch._id, learnerId, name, active: true });
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
  return { ...login, roster, attempt, learnerId };
}

async function world() {
  const batch = await makeBatch();
  const otherBatch = await makeBatch();
  const asha = await candidateWithAttempt(batch, "Asha Devi");
  const bina = await candidateWithAttempt(batch, "Bina Rao");
  const outsider = await candidateWithAttempt(otherBatch, "Chitra Iyer");
  return {
    batch,
    otherBatch,
    asha,
    bina,
    outsider,
    admin: await sessionFor("aa_admin"),
    proctor: await sessionFor("proctor", { linkedProfileId: batch.proctorId }),
    otherProctor: await sessionFor("proctor", { linkedProfileId: otherBatch.proctorId }),
    assessor: await sessionFor("assessor", { linkedProfileId: batch.assessorId }),
    reviewer: await sessionFor("ab_reviewer", { abId: batch.abId }),
    otherReviewer: await sessionFor("ab_reviewer", { abId: otherBatch.abId }),
    ncvet: await sessionFor("ncvet_viewer"),
    mis: await sessionFor("mis"),
  };
}

const startSession = (who, attemptId = who.attempt._id) =>
  request(app)
    .post(`${API}/sessions`)
    .set(bearer(who.token))
    .send({ attemptId: String(attemptId) });
const sendFlag = (who, sessionId, body) =>
  request(app)
    .post(`${API}/sessions/${sessionId}/flags`)
    .set(bearer(who.token))
    .send({ clientEventId: `evt-${++seq}`, type: "tab_hidden", capturedAt: CAPTURED_AT, ...body });
const review = (who, flagId, body) =>
  request(app).patch(`${API}/flags/${flagId}/review`).set(bearer(who.token)).send(body);
const list = (who, query = {}) =>
  request(app).get(`${API}/sessions`).set(bearer(who.token)).query(query);
const detail = (who, id) => request(app).get(`${API}/sessions/${id}`).set(bearer(who.token));

function uploadSnapshot(who, batchId, fields = {}, { file = jpeg(), type = "image/jpeg" } = {}) {
  const all = {
    clientEventId: `snap-${++seq}`,
    kind: "proctor_snapshot",
    capturedAt: CAPTURED_AT,
    ...fields,
  };
  let req = request(app).post(`/api/v1/batches/${batchId}/evidence`).set(bearer(who.token));
  for (const [key, value] of Object.entries(all)) {
    if (value !== undefined) req = req.field(key, String(value));
  }
  return req.attach("file", file, { filename: "snap.jpg", contentType: type });
}

async function started(who) {
  const res = await startSession(who);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function flagged(who, sessionId, body) {
  const res = await sendFlag(who, sessionId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe("Proctoring API (server/src/modules/proctoring)", () => {
  beforeAll(async () => {
    await startMongo();
    await mongoose.syncIndexes();
    storageDir = mkdtempSync(path.join(os.tmpdir(), "aa-proctoring-test-"));
    setEvidenceStorage(createLocalStorage({ dir: storageDir }));
  });

  afterAll(async () => {
    setEvidenceStorage(undefined);
    rmSync(storageDir, { recursive: true, force: true });
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  describe("sessions", () => {
    it("starts one session per attempt and returns the config from compliance.js", async () => {
      const w = await world();
      const first = await started(w.asha);
      expect(first).toEqual({
        id: expect.any(String),
        attemptId: String(w.asha.attempt._id),
        batchId: String(w.batch._id),
        status: "active",
        config: {
          snapshotIntervalSeconds: 30,
          detectionIntervalMs: 1000,
          flagCooldownSeconds: 15,
          sustainedSeconds: { face_not_present: 5, camera_blocked: 5, camera_frozen: 8 },
        },
      });
      expect(first.config.snapshotIntervalSeconds).toBe(
        compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS,
      );

      const again = await startSession(w.asha);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.id);
      expect(await ProctoringSession.countDocuments()).toBe(1);
      const actions = (
        await AuditLog.find({ entity: "proctoringSession" }).sort({ _id: 1 }).lean()
      ).map((r) => r.action);
      expect(actions).toEqual(["proctoring.session_start", "proctoring.session_replay"]);
    });

    it("refuses another candidate's attempt, staff roles, unknown ids and unknown keys", async () => {
      const w = await world();
      expectError(await startSession(w.bina, w.asha.attempt._id), 403, "FORBIDDEN");
      for (const who of [w.admin, w.proctor, w.assessor]) {
        expectError(
          await request(app)
            .post(`${API}/sessions`)
            .set(bearer(who.token))
            .send({ attemptId: String(w.asha.attempt._id) }),
          403,
          "FORBIDDEN",
        );
      }
      expectError(await startSession(w.asha, oid()), 404, "NOT_FOUND");
      expectError(
        await request(app)
          .post(`${API}/sessions`)
          .set(bearer(w.asha.token))
          .send({ attemptId: String(w.asha.attempt._id), status: "active" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await request(app)
          .post(`${API}/sessions`)
          .set(bearer(w.asha.token))
          .send({ attemptId: String(w.asha.attempt._id), aadhaar: "123412341234" }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("refuses a new session for a closed attempt but returns an existing one", async () => {
      const w = await world();
      await Attempt.updateOne({ _id: w.bina.attempt._id }, { status: "submitted" });
      expectError(await startSession(w.bina), 409, "PROCTORING_ATTEMPT_CLOSED");

      const s = await started(w.asha);
      await Attempt.updateOne({ _id: w.asha.attempt._id }, { status: "submitted" });
      const again = await startSession(w.asha);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id: s.id, status: "ended" });
    });

    it("heartbeat updates lastSeenAt; a silent session shows as feed_lost", async () => {
      const w = await world();
      const s = await started(w.asha);
      const silent = new Date(
        Date.now() -
          (compliance.PROCTOR_FEED_LOST_INTERVALS * compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS +
            5) *
            1000,
      );
      await ProctoringSession.updateOne({ _id: s.id }, { lastSeenAt: silent });
      let res = await list(w.admin);
      expect(res.body.items[0].status).toBe("feed_lost");
      expect((await list(w.admin, { status: "feed_lost" })).body.total).toBe(1);
      expect((await list(w.admin, { status: "active" })).body.total).toBe(0);

      const beat = await request(app)
        .post(`${API}/sessions/${s.id}/heartbeat`)
        .set(bearer(w.asha.token))
        .send({});
      expect(beat.status, JSON.stringify(beat.body)).toBe(200);
      expect(beat.body.status).toBe("active");
      expect(Date.parse(beat.body.lastSeenAt)).toBeGreaterThan(silent.getTime());
      res = await list(w.admin);
      expect(res.body.items[0].status).toBe("active");

      expectError(
        await request(app)
          .post(`${API}/sessions/${s.id}/heartbeat`)
          .set(bearer(w.bina.token))
          .send({}),
        403,
        "FORBIDDEN",
      );
      expectError(
        await request(app)
          .post(`${API}/sessions/${s.id}/heartbeat`)
          .set(bearer(w.asha.token))
          .send({ lastSeenAt: CAPTURED_AT }),
        400,
        "VALIDATION_ERROR",
      );
      const audit = await AuditLog.findOne({ action: "proctoring.heartbeat" }).lean();
      expect(audit.before.lastSeenAt).toBe(silent.toISOString());
      expect(audit.after.lastSeenAt).toBe(beat.body.lastSeenAt);
    });
  });

  describe("flags", () => {
    it("sets the severity from the server table for every type", async () => {
      const w = await world();
      const s = await started(w.asha);
      const expected = {
        tab_hidden: "low",
        fullscreen_exit: "low",
        window_blur: "low",
        permission_revoked: "low",
        object_detected: "low",
        face_not_present: "medium",
        multiple_faces: "high",
        person_detected: "high",
        phone_detected: "high",
        camera_blocked: "high",
        camera_frozen: "high",
      };
      expect(Object.keys(expected).sort()).toEqual([...PROCTORING_FLAG_TYPES].sort());
      for (const type of PROCTORING_FLAG_TYPES) {
        const body = await flagged(w.asha, s.id, { type });
        expect(body.severity, type).toBe(expected[type]);
      }
      const row = await ProctoringSession.findById(s.id).lean();
      expect(row.flagCounts).toEqual({ low: 5, medium: 1, high: 5 });

      expectError(
        await sendFlag(w.asha, s.id, { type: "phone_detected", severity: "low" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(await sendFlag(w.asha, s.id, { type: "sneezing" }), 400, "VALIDATION_ERROR");
    });

    it("is idempotent on clientEventId and refuses a changed payload", async () => {
      const w = await world();
      const s = await started(w.asha);
      const body = {
        clientEventId: "same-1",
        type: "phone_detected",
        detail: { label: "cell phone", count: 1, confidence: 0.82 },
      };
      const first = await sendFlag(w.asha, s.id, body);
      expect(first.status).toBe(201);
      expect(first.body.replayed).toBe(false);
      const again = await sendFlag(w.asha, s.id, body);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id: first.body.id, replayed: true });
      expect(await ProctoringFlag.countDocuments()).toBe(1);
      expect((await ProctoringSession.findById(s.id).lean()).flagCounts.high).toBe(1);

      expectError(
        await sendFlag(w.asha, s.id, { ...body, type: "multiple_faces" }),
        409,
        "CONFLICT_IDEMPOTENT",
      );
    });

    it("keeps detail to label, count and confidence", async () => {
      const w = await world();
      const s = await started(w.asha);
      for (const detail of [
        { image: "data:image/jpeg;base64,AAAA" },
        { label: "x", name: "Asha" },
        { label: "<script>" },
        { confidence: 2 },
        { count: -1 },
      ]) {
        expectError(
          await sendFlag(w.asha, s.id, { type: "object_detected", detail }),
          400,
          "VALIDATION_ERROR",
        );
      }
      expectError(
        await sendFlag(w.asha, s.id, { type: "object_detected", detail: { pan: "ABCDE1234F" } }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("only the session's candidate may flag it", async () => {
      const w = await world();
      const s = await started(w.asha);
      expectError(await sendFlag(w.bina, s.id, {}), 403, "FORBIDDEN");
      expectError(await sendFlag(w.proctor, s.id, {}), 403, "FORBIDDEN");
      expectError(await sendFlag(w.asha, oid(), {}), 404, "NOT_FOUND");
    });
  });

  describe("snapshots in the evidence vault", () => {
    it("a candidate uploads a JPEG proctor_snapshot for their own session", async () => {
      const w = await world();
      const s = await started(w.asha);
      const res = await uploadSnapshot(w.asha, w.batch._id, { sessionId: s.id });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        kind: "proctor_snapshot",
        sessionId: s.id,
        candidateId: String(w.asha.roster._id),
        uploaderRole: "candidate",
        contentType: "image/jpeg",
      });

      const f = await flagged(w.asha, s.id, { type: "phone_detected", evidenceId: res.body.id });
      expect(f.evidenceId).toBe(res.body.id);

      // The batch's proctor and assessor can read it; another batch's proctor cannot.
      for (const who of [w.proctor, w.assessor, w.admin]) {
        const file = await request(app)
          .get(`/api/v1/evidence/${res.body.id}/file`)
          .set(bearer(who.token));
        expect(file.status, JSON.stringify(file.body)).toBe(200);
      }
      expectError(
        await request(app)
          .get(`/api/v1/evidence/${res.body.id}/file`)
          .set(bearer(w.otherProctor.token)),
        403,
        "FORBIDDEN",
      );
      expectError(
        await request(app).get(`/api/v1/evidence/${res.body.id}`).set(bearer(w.asha.token)),
        403,
        "FORBIDDEN",
      );
    });

    it("refuses other kinds, other sessions, PNG and staff snapshots", async () => {
      const w = await world();
      const asha = await started(w.asha);
      const bina = await started(w.bina);
      const outsider = await started(w.outsider);

      expectError(
        await uploadSnapshot(w.asha, w.batch._id, { kind: "photo", sessionId: undefined }),
        403,
        "FORBIDDEN",
      );
      expectError(
        await uploadSnapshot(w.asha, w.batch._id, { sessionId: bina.id }),
        403,
        "FORBIDDEN",
      );
      expectError(
        await uploadSnapshot(w.asha, w.otherBatch._id, { sessionId: outsider.id }),
        403,
        "FORBIDDEN",
      );
      expectError(await uploadSnapshot(w.asha, w.batch._id, {}), 400, "VALIDATION_ERROR");
      expectError(
        await uploadSnapshot(
          w.asha,
          w.batch._id,
          { sessionId: asha.id },
          {
            file: png(),
            type: "image/png",
          },
        ),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await uploadSnapshot(w.proctor, w.batch._id, { sessionId: asha.id }),
        403,
        "FORBIDDEN",
      );
      expect(await Evidence.countDocuments()).toBe(0);

      // A flag may not point at another session's snapshot.
      const binaSnap = await uploadSnapshot(w.bina, w.batch._id, { sessionId: bina.id });
      expect(binaSnap.status).toBe(201);
      expectError(
        await sendFlag(w.asha, asha.id, { evidenceId: binaSnap.body.id }),
        400,
        "VALIDATION_ERROR",
      );
    });
  });

  describe("lists, detail and scope", () => {
    it("lists by role scope with severity counts and filters", async () => {
      const w = await world();
      const asha = await started(w.asha);
      const bina = await started(w.bina);
      const outsider = await started(w.outsider);
      await flagged(w.asha, asha.id, { type: "phone_detected" });
      await flagged(w.asha, asha.id, { type: "tab_hidden" });
      await flagged(w.bina, bina.id, { type: "face_not_present" });

      const all = await list(w.admin);
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(3);
      const ashaRow = all.body.items.find((i) => i.id === asha.id);
      expect(ashaRow).toMatchObject({
        candidateName: "Asha Devi",
        flagCounts: { low: 1, medium: 0, high: 1 },
        unreviewedCount: 2,
        status: "active",
        invalidationRecommended: false,
      });

      expect((await list(w.ncvet)).body.total).toBe(3);
      const ids = (res) => res.body.items.map((i) => i.id).sort();
      expect(ids(await list(w.proctor))).toEqual([asha.id, bina.id].sort());
      expect(ids(await list(w.assessor))).toEqual([asha.id, bina.id].sort());
      expect(ids(await list(w.reviewer))).toEqual([asha.id, bina.id].sort());
      expect(ids(await list(w.otherProctor))).toEqual([outsider.id]);
      expect(ids(await list(w.otherReviewer))).toEqual([outsider.id]);
      expect(ids(await list(w.otherProctor, { batchId: String(w.batch._id) }))).toEqual([]);

      expect(ids(await list(w.admin, { minSeverity: "high" }))).toEqual([asha.id]);
      expect(ids(await list(w.admin, { minSeverity: "medium" }))).toEqual(
        [asha.id, bina.id].sort(),
      );
      expect(ids(await list(w.admin, { batchId: String(w.otherBatch._id) }))).toEqual([
        outsider.id,
      ]);

      expectError(await list(w.mis), 403, "FORBIDDEN");
      expectError(await list(w.asha), 403, "FORBIDDEN");
      expectError(await list(w.admin, { foo: "1" }), 400, "VALIDATION_ERROR");
    });

    it("detail carries flags oldest first; out-of-scope readers get 403", async () => {
      const w = await world();
      const s = await started(w.asha);
      await flagged(w.asha, s.id, { type: "window_blur", capturedAt: "2026-11-20T05:02:00.000Z" });
      await flagged(w.asha, s.id, { type: "camera_blocked", capturedAt: CAPTURED_AT });

      const res = await detail(w.proctor, s.id);
      expect(res.status).toBe(200);
      expect(res.body.flags.map((f) => [f.type, f.severity])).toEqual([
        ["camera_blocked", "high"],
        ["window_blur", "low"],
      ]);
      expect(res.body.flags[0].review).toBeNull();

      for (const who of [w.admin, w.assessor, w.reviewer, w.ncvet]) {
        expect((await detail(who, s.id)).status).toBe(200);
      }
      for (const who of [w.otherProctor, w.otherReviewer]) {
        expectError(await detail(who, s.id), 403, "FORBIDDEN");
      }
      for (const who of [w.mis, w.asha]) expectError(await detail(who, s.id), 403, "FORBIDDEN");
      expectError(await detail(w.admin, oid()), 404, "NOT_FOUND");
    });
  });

  describe("review decisions and warnings (P-08)", () => {
    it("warn creates a warning only the session's candidate can read", async () => {
      const w = await world();
      const s = await started(w.asha);
      const f = await flagged(w.asha, s.id, { type: "multiple_faces" });

      const res = await review(w.proctor, f.id, {
        decision: "warn",
        note: "Please sit alone in the room.",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.review).toMatchObject({ decision: "warn", decidedByRole: "proctor" });

      const warnings = await request(app)
        .get(`${API}/sessions/${s.id}/warnings`)
        .set(bearer(w.asha.token));
      expect(warnings.status).toBe(200);
      expect(warnings.body).toEqual([
        {
          id: expect.any(String),
          message: "Please sit alone in the room.",
          createdAt: expect.any(String),
        },
      ]);
      expectError(
        await request(app).get(`${API}/sessions/${s.id}/warnings`).set(bearer(w.bina.token)),
        403,
        "FORBIDDEN",
      );
      expectError(
        await request(app).get(`${API}/sessions/${s.id}/warnings`).set(bearer(w.admin.token)),
        403,
        "FORBIDDEN",
      );

      // A warn without a note uses the default message.
      const g = await flagged(w.asha, s.id, { type: "tab_hidden" });
      expect((await review(w.admin, g.id, { decision: "warn" })).status).toBe(200);
      const after = await request(app)
        .get(`${API}/sessions/${s.id}/warnings`)
        .set(bearer(w.asha.token));
      expect(after.body).toHaveLength(2);
      expect(after.body[1].message).toMatch(/follow the exam rules/);
    });

    it("roles: proctor dismisses and warns; only aa_admin recommends invalidation", async () => {
      const w = await world();
      const s = await started(w.asha);
      const out = await started(w.outsider);
      const f1 = await flagged(w.asha, s.id, { type: "phone_detected" });
      const f2 = await flagged(w.asha, s.id, { type: "phone_detected" });
      const f3 = await flagged(w.outsider, out.id, { type: "phone_detected" });

      expectError(
        await review(w.proctor, f1.id, { decision: "invalidate_recommended" }),
        403,
        "FORBIDDEN",
      );
      for (const who of [w.assessor, w.reviewer, w.ncvet, w.mis, w.asha]) {
        expectError(await review(who, f1.id, { decision: "dismiss" }), 403, "FORBIDDEN");
      }
      expectError(await review(w.proctor, f3.id, { decision: "dismiss" }), 403, "FORBIDDEN");
      expectError(await review(w.admin, oid(), { decision: "dismiss" }), 404, "NOT_FOUND");
      expectError(
        await review(w.admin, f1.id, { decision: "invalidate" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await review(w.admin, f1.id, { decision: "dismiss", severity: "low" }),
        400,
        "VALIDATION_ERROR",
      );

      expect((await review(w.proctor, f1.id, { decision: "dismiss" })).status).toBe(200);
      expectError(
        await review(w.admin, f1.id, { decision: "warn" }),
        409,
        "PROCTORING_FLAG_REVIEWED",
      );
      expect((await review(w.admin, f2.id, { decision: "invalidate_recommended" })).status).toBe(
        200,
      );
    });

    it("invalidate_recommended marks the session and never touches the attempt or result", async () => {
      const w = await world();
      const s = await started(w.asha);
      const f = await flagged(w.asha, s.id, { type: "person_detected" });
      const attemptBefore = await Attempt.findById(w.asha.attempt._id).lean();
      const resultsBefore = await Result.countDocuments();

      const res = await review(w.admin, f.id, {
        decision: "invalidate_recommended",
        note: "Second person answered questions",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const attemptAfter = await Attempt.findById(w.asha.attempt._id).lean();
      expect(attemptAfter.status).toBe("in_progress");
      expect(attemptAfter.rev).toBe(attemptBefore.rev);
      expect(attemptAfter.scores).toEqual(attemptBefore.scores);
      expect(await Result.countDocuments()).toBe(resultsBefore);

      const d = await detail(w.admin, s.id);
      expect(d.body).toMatchObject({ invalidationRecommended: true, status: "active" });
      expect(d.body.flags[0].review).toMatchObject({
        decision: "invalidate_recommended",
        note: "Second person answered questions",
        decidedByRole: "aa_admin",
      });
    });

    it("audits every decision with before and after, without note text or personal data", async () => {
      const w = await world();
      const s = await started(w.asha);
      const snap = await uploadSnapshot(w.asha, w.batch._id, { sessionId: s.id });
      const f = await flagged(w.asha, s.id, {
        type: "phone_detected",
        evidenceId: snap.body.id,
        detail: { label: "cell phone", confidence: 0.9 },
      });
      const note = "Phone visible on the desk near the keyboard";
      await review(w.proctor, f.id, { decision: "warn", note });

      const row = await AuditLog.findOne({ action: "proctoring.review_warn" }).lean();
      expect(row).toMatchObject({
        entity: "proctoringFlag",
        entityId: f.id,
        actorRole: "proctor",
        before: { flag: { decision: null, noteLength: 0 }, session: { warningCount: 0 } },
        after: {
          flag: { decision: "warn", noteLength: note.length, severity: "high" },
          session: { warningCount: 1 },
        },
      });
      expect(String(row.batchId)).toBe(String(w.batch._id));

      const rows = await AuditLog.find({ action: /^proctoring\./ }).lean();
      const text = JSON.stringify(rows);
      expect(text).not.toContain(note);
      expect(text).not.toContain("Asha");
      expect(text).not.toContain("Please sit");
      for (const secret of [w.asha.token, w.proctor.token, w.asha.password]) {
        expect(text).not.toContain(secret);
      }
      for (const r of rows) expect(r.meta?.requestBody).toBeUndefined();
    });
  });

  describe("proctor report (P-04)", () => {
    it("counts by type and severity, lists the timeline and the decisions", async () => {
      const w = await world();
      const s = await started(w.asha);
      const a = await flagged(w.asha, s.id, {
        type: "tab_hidden",
        capturedAt: "2026-11-20T05:00:00.000Z",
      });
      await flagged(w.asha, s.id, { type: "tab_hidden", capturedAt: "2026-11-20T05:01:00.000Z" });
      const c = await flagged(w.asha, s.id, {
        type: "phone_detected",
        capturedAt: "2026-11-20T05:02:00.000Z",
      });
      await review(w.proctor, a.id, { decision: "dismiss" });
      await review(w.admin, c.id, { decision: "invalidate_recommended" });

      const res = await request(app)
        .get(`${API}/sessions/${s.id}/report`)
        .set(bearer(w.reviewer.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        sessionId: s.id,
        attemptId: String(w.asha.attempt._id),
        invalidationRecommended: true,
        totals: {
          flags: 3,
          bySeverity: { low: 2, medium: 0, high: 1 },
          reviewed: 2,
          unreviewed: 1,
          warnings: 0,
        },
        byType: [
          { type: "phone_detected", severity: "high", count: 1 },
          { type: "tab_hidden", severity: "low", count: 2 },
        ],
      });
      expect(res.body.timeline.map((t) => [t.type, t.decision])).toEqual([
        ["tab_hidden", "dismiss"],
        ["tab_hidden", null],
        ["phone_detected", "invalidate_recommended"],
      ]);
      expect(res.body.decisions.map((d) => [d.flagId, d.decision, d.decidedByRole])).toEqual([
        [a.id, "dismiss", "proctor"],
        [c.id, "invalidate_recommended", "aa_admin"],
      ]);

      expectError(
        await request(app).get(`${API}/sessions/${s.id}/report`).set(bearer(w.asha.token)),
        403,
        "FORBIDDEN",
      );
      expectError(
        await request(app).get(`${API}/sessions/${s.id}/report`).set(bearer(w.otherProctor.token)),
        403,
        "FORBIDDEN",
      );
    });
  });
});
