import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { Assessor } from "../src/models/assessor.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { LoginEvent } from "../src/models/login-event.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const WINDOW_START = "2026-11-20";
const WINDOW_END = "2026-11-21";
/** 10:30 IST on the first assessment day. */
const CAPTURED_AT = "2026-11-20T05:00:00.000Z";
const AB_EMAILS = ["one@ab.example", "two@ab.example"];

const oid = () => new mongoose.Types.ObjectId();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, linkedProfileId, email = `${role}@aa.example`) {
  const { password } = await createUser({ role, email, name: role, linkedProfileId });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

/** An assigned batch with an assessor, a proctor, and one rostered learner. */
async function world(overrides = {}) {
  const ab = await AwardingBody.create({
    name: "AB One",
    code: "AB-01",
    notificationEmails: AB_EMAILS,
    active: true,
  });
  const assessor = await Assessor.create({ name: "Ravi Assessor", code: "ASR-1" });
  const proctor = await Proctor.create({ name: "Priya Proctor", code: "PRC-1" });
  const learnerId = oid();
  const batch = await Batch.create({
    abId: ab._id,
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: WINDOW_START,
    assessmentEndDate: WINDOW_END,
    tpId: oid(),
    centreId: oid(),
    candidateCount: 1,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Hindi",
    state: "Maharashtra",
    status: "assessor_assigned",
    statusVersion: 3,
    assessorId: assessor._id,
    proctorId: proctor._id,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...overrides,
  });
  const candidate = await Candidate.create({
    batchId: batch._id,
    learnerId,
    name: "Asha Devi",
    active: true,
  });
  return { ab, assessor, proctor, learnerId, batch, candidate };
}

function eventBody(batch, overrides = {}) {
  return {
    clientEventId: "evt-0001",
    batchId: String(batch._id),
    type: "login",
    capturedAt: CAPTURED_AT,
    lat: 19.076012345,
    lng: 72.877654321,
    accuracy: 12.5,
    device: { deviceId: "dev-9f3a", platform: "android", appVersion: "1.0.0" },
    ...overrides,
  };
}

function post(actor, token, body) {
  return request(app).post(`/api/v1/${actor}/login-event`).set(bearer(token)).send(body);
}

describe("login events", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([LoginEvent.syncIndexes(), Batch.syncIndexes(), AuditLog.syncIndexes()]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the device time, server time, skew, and coordinates as sent", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const before = Date.now();
    const res = await post("assessor", assessor.token, eventBody(w.batch));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      clientEventId: "evt-0001",
      actorType: "assessor",
      actorId: String(w.assessor._id),
      candidateId: null,
      batchId: String(w.batch._id),
      type: "login",
      lat: 19.076012345,
      lng: 72.877654321,
      accuracy: 12.5,
      capturedAt: CAPTURED_AT,
      abEmailSentAt: null,
      replayed: false,
    });
    expect(res.body.payloadHash).toBeUndefined();

    const stored = await LoginEvent.findOne({ clientEventId: "evt-0001" }).lean();
    expect(stored.capturedAt.toISOString()).toBe(CAPTURED_AT);
    expect(stored.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.syncedAt.getTime()).toBe(stored.receivedAt.getTime());
    expect(stored.clockSkewMs).toBe(stored.receivedAt.getTime() - Date.parse(CAPTURED_AT));
    expect(stored.clockSkewFlag).toBe(Math.abs(stored.clockSkewMs) > compliance.MAX_CLOCK_SKEW_MS);
    expect(stored.lateSync).toBe(istCalendarDate(stored.receivedAt) > WINDOW_START);
    expect(stored.lat).toBe(19.076012345);
    expect(stored.lng).toBe(72.877654321);
    expect(stored.accuracy).toBe(12.5);
    expect(String(stored.userId)).toBe(assessor.userId);
  });

  it("does not flag a same-day event sent with the server's own clock", async () => {
    const today = istCalendarDate(new Date());
    const w = await world({ assessmentStartDate: today, assessmentEndDate: today });
    const assessor = await sessionFor("assessor", w.assessor._id);
    const res = await post(
      "assessor",
      assessor.token,
      eventBody(w.batch, { capturedAt: new Date().toISOString() }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.clockSkewFlag).toBe(false);
    expect(Math.abs(res.body.clockSkewMs)).toBeLessThan(compliance.MAX_CLOCK_SKEW_MS);
  });

  it("moves the batch to in_progress on the first assessor login only", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const proctor = await sessionFor("proctor", w.proctor._id);

    expect((await post("proctor", proctor.token, eventBody(w.batch))).status).toBe(200);
    expect((await Batch.findById(w.batch._id).lean()).status).toBe("assessor_assigned");

    const first = await post(
      "assessor",
      assessor.token,
      eventBody(w.batch, { clientEventId: "evt-0002" }),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    let batch = await Batch.findById(w.batch._id).lean();
    expect(batch.status).toBe("in_progress");
    expect(batch.statusVersion).toBe(4);

    const second = await post(
      "assessor",
      assessor.token,
      eventBody(w.batch, { clientEventId: "evt-0003", type: "logout" }),
    );
    expect(second.status).toBe(200);
    batch = await Batch.findById(w.batch._id).lean();
    expect(batch.status).toBe("in_progress");
    expect(batch.statusVersion).toBe(4);
    expect(await AuditLog.countDocuments({ action: "batch.login-event" })).toBe(1);
  });

  it("returns the original event for a repeat submission and creates no duplicate", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const first = await post("assessor", assessor.token, eventBody(w.batch));
    expect(first.status).toBe(200);

    // The batch has moved on; a queued resend must still be accepted.
    await Batch.updateOne({ _id: w.batch._id }, { $set: { status: "cancelled" } });
    const again = await post("assessor", assessor.token, eventBody(w.batch));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });

    expect(await LoginEvent.countDocuments({})).toBe(1);
    expect(await EmailQueue.countDocuments({})).toBe(1);
    expect(await AuditLog.countDocuments({ action: "batch.login-event" })).toBe(1);
  });

  it("creates one event when the same clientEventId arrives twice at once", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const results = await Promise.all([
      post("assessor", assessor.token, eventBody(w.batch)),
      post("assessor", assessor.token, eventBody(w.batch)),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(await LoginEvent.countDocuments({})).toBe(1);
    expect(await EmailQueue.countDocuments({})).toBe(1);
  });

  it("rejects a reused clientEventId with a different payload or a different user", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const proctor = await sessionFor("proctor", w.proctor._id);
    expect((await post("assessor", assessor.token, eventBody(w.batch))).status).toBe(200);

    expectError(
      await post("assessor", assessor.token, eventBody(w.batch, { lat: 19.5 })),
      409,
      "CONFLICT_IDEMPOTENT",
    );
    expectError(
      await post("proctor", proctor.token, eventBody(w.batch)),
      409,
      "CONFLICT_IDEMPOTENT",
    );
    expect(await LoginEvent.countDocuments({})).toBe(1);
  });

  it("rejects an actor who is not assigned to the batch", async () => {
    const w = await world();
    const otherAssessor = await Assessor.create({ name: "Other", code: "ASR-2" });
    const otherProctor = await Proctor.create({ name: "Other", code: "PRC-2" });
    const stranger = await sessionFor("assessor", otherAssessor._id, "stranger@aa.example");
    const unlinked = await sessionFor("assessor", undefined, "unlinked@aa.example");
    const proctor = await sessionFor("proctor", otherProctor._id);
    const student = await sessionFor("candidate", oid());
    const admin = await sessionFor("aa_admin");
    const assigned = await sessionFor("assessor", w.assessor._id);

    expectError(await post("assessor", stranger.token, eventBody(w.batch)), 403, "FORBIDDEN");
    expectError(await post("assessor", unlinked.token, eventBody(w.batch)), 403, "FORBIDDEN");
    expectError(await post("proctor", proctor.token, eventBody(w.batch)), 403, "FORBIDDEN");
    expectError(await post("student", student.token, eventBody(w.batch)), 403, "FORBIDDEN");
    expectError(await post("assessor", admin.token, eventBody(w.batch)), 403, "FORBIDDEN");
    // The assigned assessor may not use another actor's path.
    expectError(await post("proctor", assigned.token, eventBody(w.batch)), 403, "FORBIDDEN");
    expectError(
      await post("assessor", assigned.token, eventBody(w.batch, { batchId: String(oid()) })),
      404,
      "NOT_FOUND",
    );
    expect((await request(app).post("/api/v1/assessor/login-event").send({})).status).toBe(401);

    expect(await LoginEvent.countDocuments({})).toBe(0);
    expect(await EmailQueue.countDocuments({})).toBe(0);
    expect((await Batch.findById(w.batch._id).lean()).status).toBe("assessor_assigned");
  });

  it("accepts a rostered student and rejects a deactivated roster row", async () => {
    const w = await world();
    const student = await sessionFor("candidate", w.learnerId);
    const res = await post("student", student.token, eventBody(w.batch));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.actorType).toBe("student");
    expect(res.body.actorId).toBe(String(w.learnerId));
    expect(res.body.candidateId).toBe(String(w.candidate._id));
    expect(res.body.abEmailQueuedAt).toBeNull();
    expect(await EmailQueue.countDocuments({})).toBe(0);

    await Candidate.updateOne({ _id: w.candidate._id }, { $set: { active: false } });
    expectError(
      await post("student", student.token, eventBody(w.batch, { clientEventId: "evt-0002" })),
      403,
      "FORBIDDEN",
    );
  });

  it.each(["allocated", "accepted", "rejected", "cancelled"])(
    "rejects a batch in status %s",
    async (status) => {
      const w = await world({ status });
      const assessor = await sessionFor("assessor", w.assessor._id);
      expectError(
        await post("assessor", assessor.token, eventBody(w.batch)),
        409,
        "INVALID_TRANSITION",
      );
      expect(await LoginEvent.countDocuments({})).toBe(0);
      expect(await EmailQueue.countDocuments({})).toBe(0);
    },
  );

  it.each(["in_progress", "assessment_completed", "published", "disputed"])(
    "accepts a batch in status %s without changing it",
    async (status) => {
      const w = await world({ status });
      const assessor = await sessionFor("assessor", w.assessor._id);
      const res = await post("assessor", assessor.token, eventBody(w.batch));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const batch = await Batch.findById(w.batch._id).lean();
      expect(batch.status).toBe(status);
      expect(batch.statusVersion).toBe(3);
    },
  );

  it("rejects a capturedAt outside the IST assessment window", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const outside = [
      "2026-11-19T05:00:00.000Z",
      // 23:59:59 IST on the day before the window.
      "2026-11-19T18:29:59.000Z",
      // 00:00:00 IST on the day after the window.
      "2026-11-21T18:30:00.000Z",
      "2026-11-25T05:00:00.000Z",
    ];
    for (const capturedAt of outside) {
      const res = await post("assessor", assessor.token, eventBody(w.batch, { capturedAt }));
      expectError(res, 400, "VALIDATION_ERROR");
      expect(res.body.error.details.capturedAt).toHaveLength(1);
    }
    expect(await LoginEvent.countDocuments({})).toBe(0);
    expect((await Batch.findById(w.batch._id).lean()).status).toBe("assessor_assigned");

    // First and last instants of the window in IST, both on a different UTC date.
    const edges = ["2026-11-19T18:30:00.000Z", "2026-11-21T18:29:59.000Z"];
    for (const [index, capturedAt] of edges.entries()) {
      const res = await post(
        "assessor",
        assessor.token,
        eventBody(w.batch, { capturedAt, clientEventId: `edge-${index}` }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });

  it("rejects missing coordinates, a missing batch id, and server-owned fields", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const noFix = eventBody(w.batch, { lat: undefined, lng: undefined });
    const bad = [
      noFix,
      { ...noFix, locationStatus: "unavailable", locationUnavailableReason: "timeout" },
      eventBody(w.batch, { batchId: null }),
      eventBody(w.batch, { lat: 91 }),
      eventBody(w.batch, { capturedAt: "yesterday" }),
      eventBody(w.batch, { receivedAt: CAPTURED_AT }),
      eventBody(w.batch, { clockSkewMs: 0 }),
    ];
    for (const body of bad) {
      expectError(await post("assessor", assessor.token, body), 400, "VALIDATION_ERROR");
    }
    expect(await LoginEvent.countDocuments({})).toBe(0);
  });

  it("queues one email to the awarding body when an assessor logs in", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const proctor = await sessionFor("proctor", w.proctor._id);

    const res = await post("assessor", assessor.token, eventBody(w.batch));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.abEmailQueuedAt).toEqual(expect.any(String));
    expect(res.body.abEmailSentAt).toBeNull();

    const jobs = await EmailQueue.find({}).lean();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      to: AB_EMAILS,
      kind: "assessor_login",
      status: "pending",
      attempts: 0,
    });
    expect(jobs[0].text).toContain(CAPTURED_AT);
    expect(jobs[0].text).toContain("Ravi Assessor");
    expect(jobs[0].meta).toMatchObject({
      loginEventId: res.body.id,
      batchId: String(w.batch._id),
      capturedAt: CAPTURED_AT,
    });

    // Logout and proctor events do not notify the AB.
    await post(
      "assessor",
      assessor.token,
      eventBody(w.batch, { clientEventId: "e2", type: "logout" }),
    );
    await post("proctor", proctor.token, eventBody(w.batch, { clientEventId: "e3" }));
    expect(await LoginEvent.countDocuments({})).toBe(3);
    expect(await EmailQueue.countDocuments({})).toBe(1);
  });

  it("still records the login when the email cannot be queued, and queues it on the resend", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(EmailQueue, "create").mockRejectedValueOnce(new Error("queue is down"));

    const res = await post("assessor", assessor.token, eventBody(w.batch));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.abEmailQueuedAt).toBeNull();
    expect(await LoginEvent.countDocuments({})).toBe(1);
    expect(await EmailQueue.countDocuments({})).toBe(0);
    expect((await Batch.findById(w.batch._id).lean()).status).toBe("in_progress");

    const again = await post("assessor", assessor.token, eventBody(w.batch));
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.abEmailQueuedAt).toEqual(expect.any(String));
    expect(await EmailQueue.countDocuments({})).toBe(1);
  });

  it("still records the login when the awarding body lookup fails or finds nothing", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(AwardingBody, "findById").mockImplementationOnce(() => {
      throw new Error("lookup failed");
    });
    const failed = await post("assessor", assessor.token, eventBody(w.batch));
    expect(failed.status, JSON.stringify(failed.body)).toBe(200);
    expect(failed.body.abEmailQueuedAt).toBeNull();

    await AwardingBody.deleteMany({});
    const missing = await post(
      "assessor",
      assessor.token,
      eventBody(w.batch, { clientEventId: "evt-0002" }),
    );
    expect(missing.status).toBe(200);
    expect(missing.body.abEmailQueuedAt).toBeNull();
    expect(await EmailQueue.countDocuments({})).toBe(0);
  });

  it("writes audit rows without tokens, password data, or the email body", async () => {
    const w = await world();
    const assessor = await sessionFor("assessor", w.assessor._id);
    const res = await post("assessor", assessor.token, eventBody(w.batch));
    expect(res.status).toBe(200);
    await post("assessor", assessor.token, eventBody(w.batch));

    const rows = await AuditLog.find({
      action: { $in: ["loginEvent.create", "loginEvent.replay", "batch.login-event"] },
    }).lean();
    expect(rows.map((row) => row.action).sort()).toEqual([
      "batch.login-event",
      "loginEvent.create",
      "loginEvent.replay",
    ]);
    const created = rows.find((row) => row.action === "loginEvent.create");
    expect(created.entity).toBe("loginEvent");
    expect(created.entityId).toBe(res.body.id);
    expect(String(created.batchId)).toBe(String(w.batch._id));
    expect(String(created.abId)).toBe(String(w.ab._id));

    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(assessor.token);
    expect(dump).not.toMatch(/passwordHash|payloadHash|Bearer|authorization/i);
    expect(dump).not.toContain("ab.example");
    expect(dump).not.toContain("An assessor has logged in");
  });
});
