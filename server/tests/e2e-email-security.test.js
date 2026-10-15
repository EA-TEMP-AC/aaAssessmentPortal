import mongoose from "mongoose";
import request from "supertest";
import { EMAIL_MAX_ATTEMPTS, EMAIL_SENDING_STALE_MS } from "../src/config/email.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { Learner } from "../src/models/learner.model.js";
import { LoginEvent } from "../src/models/login-event.model.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { User } from "../src/models/user.model.js";
import { claimNextEmail, reclaimStaleEmails } from "../src/modules/email/email-queue.service.js";
import { processDueEmails } from "../src/modules/email/email-worker.js";
import {
  API,
  CAPTURED_AT,
  GHOST_ID,
  app,
  auditRows,
  bearer,
  bootE2e,
  createBatch,
  createLearners,
  expectError,
  expectStatus,
  fieldDevice,
  get,
  loginEventBody,
  makeWorld,
  oid,
  patch,
  post,
  postCsv,
  prepareBatch,
  put,
  resetE2e,
  sessionFor,
  shutdownE2e,
} from "./helpers/e2e.js";

/**
 * T-01 flow 9. Email queue and security.
 * docs/SCHEMA.md §3.1, §3.2, §3.11, §3.12, PII rule; API_CONTRACT.md Auth, Users, login-event;
 * DECISIONS.md Q152 and Q155 (2026-10-14).
 */
function okTransport() {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/** Fails every send and echoes the mail text in its message, as a careless SMTP library might. */
function leakyFailingTransport() {
  const calls = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      const err = new Error(`SMTP refused the message: ${message.text}`);
      err.code = "ESOCKET";
      throw err;
    },
  };
}

function rawMail(id) {
  return EmailQueue.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
}

function minutes(n) {
  return n * 60_000;
}

describe("e2e: email queue and security", () => {
  beforeAll(bootE2e);
  afterAll(shutdownE2e);
  beforeEach(resetE2e);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("assessor login mail", () => {
    it("queues exactly one mail per login event, with the time and place in the body", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "assigned" });
      const token = ctx.assessorSession.token;
      const batchId = ctx.batch.id;
      const queued = () => EmailQueue.find({ kind: "assessor_login" }).sort({ _id: 1 }).lean();

      const first = loginEventBody(batchId, { clientEventId: "evt-mail-1" });
      const login = expectStatus(await post(token, "/assessor/login-event", first), 200);
      expect(login.replayed).toBe(false);
      expect(login.abEmailQueuedAt).toBeTruthy();
      let mails = await queued();
      expect(mails).toHaveLength(1);
      expect([...mails[0].to].sort()).toEqual(["one@ab.example", "two@ab.example"]);
      expect(mails[0].subject).toContain(batchId);
      expect(mails[0].text).toContain(`Captured at (device clock): ${CAPTURED_AT}`);
      expect(mails[0].text).toContain("Location: 19.076012345, 72.877654321 (accuracy 12.5 m)");
      expect(mails[0]).toMatchObject({ status: "pending", attempts: 0, reclaims: 0 });
      expect(mails[0].meta).toMatchObject({ loginEventId: login.id, batchId });

      // A replay of the same event, and a conflicting reuse of its id, queue nothing more.
      const replay = expectStatus(await post(token, "/assessor/login-event", first), 200);
      expect(replay).toMatchObject({ id: login.id, replayed: true });
      expectError(
        await post(token, "/assessor/login-event", { ...first, lat: 20.5 }),
        409,
        "CONFLICT_IDEMPOTENT",
      );
      expect(await queued()).toHaveLength(1);

      // A second login event is a new event: one more mail, and the batch is already in progress.
      expectStatus(
        await post(
          token,
          "/assessor/login-event",
          loginEventBody(batchId, { clientEventId: "evt-mail-2" }),
        ),
        200,
      );
      expect(await queued()).toHaveLength(2);
      expect(await Batch.findById(batchId).lean()).toMatchObject({
        status: "in_progress",
        statusVersion: 4,
      });

      // Logout sends nothing.
      expectStatus(
        await post(
          token,
          "/assessor/login-event",
          loginEventBody(batchId, { clientEventId: "evt-mail-3", type: "logout" }),
        ),
        200,
      );
      expect(await queued()).toHaveLength(2);

      // No GPS fix: still mailed, and the body says why there is no location.
      const noFix = expectStatus(
        await post(token, "/assessor/login-event", {
          clientEventId: "evt-mail-4",
          batchId,
          type: "login",
          capturedAt: CAPTURED_AT,
          locationStatus: "unavailable",
          locationUnavailableReason: "position_unavailable",
          device: fieldDevice,
        }),
        200,
      );
      expect(noFix).toMatchObject({ missingGpsFix: true, lat: null, lng: null });
      mails = await queued();
      expect(mails).toHaveLength(3);
      expect(mails[2].text).toContain("Location: Unavailable (position_unavailable)");

      // No batch attached: stored, but no mail (SCHEMA §3.11).
      const detached = expectStatus(
        await post(token, "/assessor/login-event", {
          clientEventId: "evt-mail-5",
          batchId: null,
          type: "login",
          capturedAt: CAPTURED_AT,
          locationStatus: "unavailable",
          locationUnavailableReason: "no_batch_yet",
        }),
        200,
      );
      expect(detached).toMatchObject({ batchId: null, abEmailQueuedAt: null });
      expect(await queued()).toHaveLength(3);
      expect(await LoginEvent.countDocuments({})).toBe(5);
    });

    it("queues one mail when the same event arrives twice at once", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "assigned" });
      const body = loginEventBody(ctx.batch.id, { clientEventId: "evt-race-1" });
      const send = () => post(ctx.assessorSession.token, "/assessor/login-event", body);
      const [a, b] = await Promise.all([send(), send()]);
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
      expect(await LoginEvent.countDocuments({ clientEventId: "evt-race-1" })).toBe(1);
      expect(await EmailQueue.countDocuments({ kind: "assessor_login" })).toBe(1);
      expect(await Batch.findById(ctx.batch.id).lean()).toMatchObject({ statusVersion: 4 });
    });

    it("never fails the login API when the queue is down, and a replay queues the mail", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "assigned" });
      const token = ctx.assessorSession.token;
      const body = loginEventBody(ctx.batch.id, { clientEventId: "evt-down-1" });

      vi.spyOn(EmailQueue, "create").mockRejectedValueOnce(new Error("queue is down"));
      const first = expectStatus(await post(token, "/assessor/login-event", body), 200);
      expect(first.abEmailQueuedAt).toBeNull();
      // The batch still started, and the event is stored.
      expect(await Batch.findById(ctx.batch.id).lean()).toMatchObject({
        status: "in_progress",
        statusVersion: 4,
      });
      expect(await LoginEvent.countDocuments({ clientEventId: "evt-down-1" })).toBe(1);
      expect(await EmailQueue.countDocuments({})).toBe(0);

      // The queue is back. The replay tries the enqueue again, and only once.
      const replay = expectStatus(await post(token, "/assessor/login-event", body), 200);
      expect(replay).toMatchObject({ id: first.id, replayed: true });
      expect(replay.abEmailQueuedAt).toBeTruthy();
      expect(await EmailQueue.countDocuments({ kind: "assessor_login" })).toBe(1);
      expectStatus(await post(token, "/assessor/login-event", body), 200);
      expect(await EmailQueue.countDocuments({ kind: "assessor_login" })).toBe(1);
    });

    it("sends the queued mail through the worker and then drops nothing the AB needs", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "assigned" });
      expectStatus(
        await post(
          ctx.assessorSession.token,
          "/assessor/login-event",
          loginEventBody(ctx.batch.id, { clientEventId: "evt-send-1" }),
        ),
        200,
      );
      const transport = okTransport();
      const results = await processDueEmails(transport, new Date(Date.now() + 1000));
      expect(results.map((r) => r.status)).toEqual(["sent"]);
      expect(transport.sent).toHaveLength(1);
      expect([...transport.sent[0].to].sort()).toEqual(["one@ab.example", "two@ab.example"]);
      expect(transport.sent[0].text).toContain("An assessor has logged in");
      // A second tick finds nothing due.
      expect(await processDueEmails(transport, new Date(Date.now() + 2000))).toEqual([]);
    });
  });

  describe("temporary password mail", () => {
    async function resetByEmail(world, target) {
      const res = await post(world.admin.token, `/users/${target.userId}/password-reset`, {
        sendEmail: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const job = await EmailQueue.findOne({ kind: "password_reset" }).sort({ _id: -1 }).lean();
      const temporary = /Temporary password: (\S+)/.exec(job.text)[1];
      return { res, job, temporary };
    }

    it("keeps the password out of every response and audit row, and unsets the text after a send", async () => {
      const world = await makeWorld({ recognition: false });
      const target = await sessionFor("mis", {
        email: "target@aa.example",
        password: "Original-Pass-9",
      });
      const { res, job, temporary } = await resetByEmail(world, target);
      expect(res.body).toEqual({ emailQueued: true });
      expect(job).toMatchObject({ to: ["target@aa.example"], status: "pending" });
      expect(JSON.stringify(res.body)).not.toContain(temporary);

      // The old password is dead, the temporary one works, and it must be changed.
      const old = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: "target@aa.example", password: "Original-Pass-9", device: target.device });
      expect(old.status).toBe(401);
      const viaTemp = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: "target@aa.example", password: temporary, device: target.device });
      expect(viaTemp.status).toBe(200);
      expect(viaTemp.body.user.mustChangePassword).toBe(true);

      const audits = JSON.stringify(await AuditLog.find({}).lean());
      expect(audits).not.toContain(temporary);
      expect(audits).not.toContain("Original-Pass-9");

      const transport = okTransport();
      const results = await processDueEmails(transport, new Date(Date.now() + 1000));
      expect(results.map((r) => r.status)).toEqual(["sent"]);
      expect(transport.sent[0].text).toContain(temporary);
      const stored = await rawMail(String(job._id));
      expect(stored.status).toBe("sent");
      expect(stored.sentAt).toBeTruthy();
      expect(Object.hasOwn(stored, "text")).toBe(false);
      expect(JSON.stringify(stored)).not.toContain(temporary);
    });

    it("keeps the text only while retries remain, and unsets it when the last attempt fails", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const world = await makeWorld({ recognition: false });
      const target = await sessionFor("mis", { email: "target2@aa.example" });
      const { job, temporary } = await resetByEmail(world, target);
      const transport = leakyFailingTransport();

      let now = new Date(job.nextAttemptAt.getTime() + 1000);
      for (let attempt = 1; attempt <= EMAIL_MAX_ATTEMPTS; attempt += 1) {
        const results = await processDueEmails(transport, now);
        expect(results).toHaveLength(1);
        const row = await rawMail(String(job._id));
        expect(row.attempts).toBe(attempt);
        // Whatever the transport said, only a code is kept.
        expect(row.lastError).toMatch(/^Email send failed \(ESOCKET\)$/);
        expect(JSON.stringify(row)).not.toContain("SMTP refused");
        if (attempt < EMAIL_MAX_ATTEMPTS) {
          expect(row.status).toBe("pending");
          expect(row.text).toContain(temporary); // still needed for the next try
          expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
          now = new Date(row.nextAttemptAt.getTime() + 1000);
        } else {
          expect(row.status).toBe("failed");
          expect(Object.hasOwn(row, "text")).toBe(false);
        }
      }
      expect(transport.calls).toHaveLength(EMAIL_MAX_ATTEMPTS);
      // A failed job is never tried again.
      expect(await processDueEmails(transport, new Date(now.getTime() + 86_400_000))).toEqual([]);
      expect(JSON.stringify(await rawMail(String(job._id)))).not.toContain(temporary);
      // Nothing the worker logged carries the password.
      expect(JSON.stringify(errors.mock.calls)).not.toContain(temporary);
    });

    it("still answers 202 and resets the password when the queue is down", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const world = await makeWorld({ recognition: false });
      const target = await sessionFor("mis", { email: "target3@aa.example" });
      vi.spyOn(EmailQueue, "create").mockRejectedValueOnce(new Error("queue is down"));
      const res = await post(world.admin.token, `/users/${target.userId}/password-reset`, {
        sendEmail: true,
      });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ emailQueued: false });
      expect(await EmailQueue.countDocuments({})).toBe(0);
      const user = await User.findById(target.userId).lean();
      expect(user.mustChangePassword).toBe(true);
      // Every session of that user was revoked by the reset, mail or not.
      expect(await RefreshToken.countDocuments({ userId: target.userId, revokedAt: null })).toBe(0);
    });
  });

  describe("stale send reclaim", () => {
    it("returns a stuck send to pending at most twice, then fails it and unsets the text", async () => {
      const world = await makeWorld({ recognition: false });
      const target = await sessionFor("mis", { email: "stuck@aa.example" });
      expectStatus(
        await post(world.admin.token, `/users/${target.userId}/password-reset`, {
          sendEmail: true,
        }),
        202,
      );
      const job = await EmailQueue.findOne({ kind: "password_reset" }).lean();
      const id = String(job._id);
      const t0 = new Date(job.nextAttemptAt.getTime() + 1000);

      // First claim; the worker then dies.
      expect((await claimNextEmail(t0)).attempts).toBe(1);
      // Inside ten minutes nothing is reclaimed.
      expect(
        await reclaimStaleEmails(new Date(t0.getTime() + EMAIL_SENDING_STALE_MS - 1000)),
      ).toEqual({
        requeued: 0,
        failed: 0,
      });
      expect((await rawMail(id)).status).toBe("sending");

      let now = new Date(t0.getTime() + EMAIL_SENDING_STALE_MS + 1000);
      expect(await reclaimStaleEmails(now)).toEqual({ requeued: 1, failed: 0 });
      expect(await rawMail(id)).toMatchObject({ status: "pending", reclaims: 1, attempts: 1 });
      expect((await rawMail(id)).nextAttemptAt.getTime()).toBe(now.getTime());

      // Second claim, second death.
      expect((await claimNextEmail(now)).attempts).toBe(2);
      now = new Date(now.getTime() + EMAIL_SENDING_STALE_MS + 1000);
      expect(await reclaimStaleEmails(now)).toEqual({ requeued: 1, failed: 0 });
      expect(await rawMail(id)).toMatchObject({ status: "pending", reclaims: 2, attempts: 2 });

      // Third claim: stuck again, and the limit of two reclaims is used up.
      expect((await claimNextEmail(now)).attempts).toBe(3);
      now = new Date(now.getTime() + EMAIL_SENDING_STALE_MS + 1000);
      expect(await reclaimStaleEmails(now)).toEqual({ requeued: 0, failed: 1 });
      const failed = await rawMail(id);
      expect(failed).toMatchObject({ status: "failed", reclaims: 2, attempts: 3 });
      expect(failed.lastError).toBe("Email send interrupted (STALE_CLAIM)");
      expect(Object.hasOwn(failed, "text")).toBe(false);

      // Nothing sends or reclaims it again.
      const transport = okTransport();
      expect(await processDueEmails(transport, new Date(now.getTime() + 3_600_000))).toEqual([]);
      expect(transport.sent).toHaveLength(0);
      expect(await reclaimStaleEmails(new Date(now.getTime() + 3_600_000))).toEqual({
        requeued: 0,
        failed: 0,
      });
    });

    it("does not count a failed send and its backoff as a reclaim", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const world = await makeWorld({ recognition: false });
      const target = await sessionFor("mis", { email: "backoff@aa.example" });
      expectStatus(
        await post(world.admin.token, `/users/${target.userId}/password-reset`, {
          sendEmail: true,
        }),
        202,
      );
      const job = await EmailQueue.findOne({ kind: "password_reset" }).lean();
      const now = new Date(job.nextAttemptAt.getTime() + 1000);
      await processDueEmails(leakyFailingTransport(), now);
      const after = await rawMail(String(job._id));
      expect(after).toMatchObject({ status: "pending", attempts: 1, reclaims: 0 });
      // Ten minutes later the job is merely waiting, not stuck: nothing to reclaim.
      expect(await reclaimStaleEmails(new Date(now.getTime() + minutes(11)))).toEqual({
        requeued: 0,
        failed: 0,
      });
    });
  });

  describe("mustChangePassword and change-password", () => {
    it("forces a new password after an admin-set one, and revokes the user's other sessions", async () => {
      const world = await makeWorld({ recognition: false });
      const temporary = "Temporary-Pass-1";
      const chosen = "Battery-Staple-7";
      const created = expectStatus(
        await post(world.admin.token, "/users", {
          email: "newhire@aa.example",
          name: "New Hire",
          role: "mis",
          password: temporary,
        }),
        201,
      );
      expect(created).toMatchObject({ mustChangePassword: true, role: "mis" });
      expect(created).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(created)).not.toContain(temporary);

      const deviceA = { deviceId: "dev-A", platform: "web", appVersion: "1.0.0" };
      const deviceB = { deviceId: "dev-B", platform: "android", appVersion: "1.0.0" };
      const login = (password, device) =>
        request(app)
          .post(`${API}/auth/login`)
          .send({ email: "newhire@aa.example", password, device });
      const a = await login(temporary, deviceA);
      const b = await login(temporary, deviceB);
      expect(a.status).toBe(200);
      expect(a.body.user.mustChangePassword).toBe(true);
      const tokenA = a.body.accessToken;

      // Refused changes: wrong current, same password, too short, unknown key, no token.
      const wrong = await post(tokenA, "/auth/change-password", {
        currentPassword: "Not-The-Password-1",
        newPassword: chosen,
      });
      expectError(wrong, 400, "VALIDATION_ERROR"); // Q152: not 401
      expect(wrong.body.error.details.currentPassword).toBeTruthy();
      const same = await post(tokenA, "/auth/change-password", {
        currentPassword: temporary,
        newPassword: temporary,
      });
      expectError(same, 400, "VALIDATION_ERROR");
      expect(same.body.error.details.newPassword).toBeTruthy();
      expectError(
        await post(tokenA, "/auth/change-password", {
          currentPassword: temporary,
          newPassword: "short",
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await post(tokenA, "/auth/change-password", {
          currentPassword: temporary,
          newPassword: chosen,
          role: "aa_admin",
        }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await post(undefined, "/auth/change-password", {
          currentPassword: temporary,
          newPassword: chosen,
        }),
        401,
        "UNAUTHORIZED",
      );
      expect((await User.findOne({ email: "newhire@aa.example" }).lean()).mustChangePassword).toBe(
        true,
      );

      // The change, naming this session's refresh token.
      const changed = expectStatus(
        await post(tokenA, "/auth/change-password", {
          currentPassword: temporary,
          newPassword: chosen,
          refreshToken: a.body.refreshToken,
        }),
        200,
      );
      expect(changed.user).toMatchObject({ role: "mis", mustChangePassword: false });
      expect(await User.findOne({ email: "newhire@aa.example" }).lean()).toMatchObject({
        mustChangePassword: false,
      });

      const refresh = (token, device) =>
        request(app).post(`${API}/auth/refresh`).send({ refreshToken: token, device });
      // The other device can no longer refresh; this one can.
      expect((await refresh(b.body.refreshToken, deviceB)).status).toBe(401);
      const kept = await refresh(a.body.refreshToken, deviceA);
      expect(kept.status).toBe(200);
      expect(kept.body.user.mustChangePassword).toBe(false);
      // An access token already issued to the other device keeps working until it expires.
      expect((await get(b.body.accessToken, "/batches")).status).toBe(200);

      expect((await login(temporary, deviceA)).status).toBe(401);
      const fresh = await login(chosen, deviceA);
      expect(fresh.status).toBe(200);
      expect(fresh.body.user.mustChangePassword).toBe(false);

      const audit = await auditRows({ entity: "user" });
      const changedRow = audit.find((row) => row.action === "auth.password_changed");
      expect(changedRow.meta).toMatchObject({ revokedRefreshTokens: 1, keptCurrentSession: true });
      expect(audit.map((row) => row.action)).toContain("auth.password_change_failed");
      const everything = JSON.stringify(await AuditLog.find({}).lean());
      for (const secret of [temporary, chosen, "Not-The-Password-1", a.body.refreshToken, tokenA]) {
        expect(everything).not.toContain(secret);
      }
    });

    it("revokes every session, this one included, when no refresh token is named", async () => {
      const user = await sessionFor("mis", {
        email: "solo@aa.example",
        password: "Temporary-Pass-1",
        mustChangePassword: true,
      });
      expect(user.user.mustChangePassword).toBe(true);
      expectStatus(
        await post(user.token, "/auth/change-password", {
          currentPassword: "Temporary-Pass-1",
          newPassword: "Battery-Staple-7",
        }),
        200,
      );
      const res = await request(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: user.refreshToken, device: user.device });
      expect(res.status).toBe(401);
      const row = (await auditRows({ action: "auth.password_changed" }))[0];
      expect(row.meta).toMatchObject({ revokedRefreshTokens: 1, keptCurrentSession: false });
    });

    it("sets mustChangePassword again when an admin sets a new password", async () => {
      const world = await makeWorld({ recognition: false });
      const user = await sessionFor("mis", { email: "again@aa.example" });
      expect(user.user.mustChangePassword).toBe(false);
      const reset = await post(world.admin.token, `/users/${user.userId}/password-reset`, {
        newPassword: "Admin-Chosen-1",
      });
      expect(reset.status).toBe(204);
      const login = await request(app)
        .post(`${API}/auth/login`)
        .send({ email: "again@aa.example", password: "Admin-Chosen-1", device: user.device });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      const stale = await request(app)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: user.refreshToken, device: user.device });
      expect(stale.status).toBe(401);
      const everything = JSON.stringify(await AuditLog.find({}).lean());
      expect(everything).not.toContain("Admin-Chosen-1");
    });
  });

  describe("refresh-token reuse", () => {
    async function twoDevices() {
      const user = await sessionFor("mis", { email: "reuse@aa.example" });
      const other = await request(app)
        .post(`${API}/auth/login`)
        .send({
          email: "reuse@aa.example",
          password: user.password,
          device: { deviceId: "dev-other", platform: "android", appVersion: "1.0.0" },
        });
      expect(other.status).toBe(200);
      return { user, other: other.body };
    }

    const refresh = (refreshToken, device) =>
      request(app).post(`${API}/auth/refresh`).send({ refreshToken, device });

    it("rotates on every refresh and treats a used token as theft", async () => {
      const { user, other } = await twoDevices();
      const rotated = await refresh(user.refreshToken, user.device);
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(user.refreshToken);

      // The first token was used. Presenting it again is reuse: refused, and the family is revoked.
      const reuse = await refresh(user.refreshToken, user.device);
      expectError(reuse, 401, "UNAUTHORIZED");
      expect((await auditRows({ action: "auth.refresh_reuse_detected" })).length).toBe(1);
      // The token that came from the rotation is dead as well.
      expectError(await refresh(rotated.body.refreshToken, user.device), 401, "UNAUTHORIZED");
      // Another device of the same user is not touched.
      const untouched = await refresh(other.refreshToken, {
        deviceId: "dev-other",
        platform: "android",
        appVersion: "1.0.0",
      });
      expect(untouched.status).toBe(200);
      // An access token issued before the theft is still valid until it expires.
      expect((await get(rotated.body.accessToken, "/batches")).status).toBe(200);
    });

    it("refuses another device's id without revoking the token", async () => {
      const { user } = await twoDevices();
      const wrongDevice = await refresh(user.refreshToken, {
        deviceId: "dev-thief",
        platform: "web",
        appVersion: "1.0.0",
      });
      expectError(wrongDevice, 401, "UNAUTHORIZED");
      expect((await auditRows({ action: "auth.refresh_failed" })).length).toBe(1);
      expect((await auditRows({ action: "auth.refresh_reuse_detected" })).length).toBe(0);
      expect((await refresh(user.refreshToken, user.device)).status).toBe(200);
      expectError(await refresh("rt_not-a-real-token", user.device), 401, "UNAUTHORIZED");
    });

    it("lets only one of two parallel refreshes of the same token succeed", async () => {
      const { user } = await twoDevices();
      const [a, b] = await Promise.all([
        refresh(user.refreshToken, user.device),
        refresh(user.refreshToken, user.device),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 401]);
    });

    it("stores only the hash of a refresh token", async () => {
      const { user } = await twoDevices();
      const rows = await RefreshToken.find({}).lean();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(row)).not.toContain(user.refreshToken);
      }
    });
  });

  describe("CSV formula characters", () => {
    it("neutralises leading = + - @ and control characters in names and references", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world, { candidateCount: 1 });
      const csv = [
        "name,externalRef",
        '"=HYPERLINK(""http://evil.example"",""Click"")",R-1',
        "+1+1,R-2",
        "-2+3,R-3",
        "@SUM(A1),R-4",
        "\"\t=cmd|' /C calc'!A0\",R-5",
        "Plain Name,=R-6",
        "Mid =dash name,R-7",
        " =1+1,R-8",
        "﻿@BOM,R-9",
      ].join("\r\n");
      const res = expectStatus(
        await postCsv(world.admin.token, `/batches/${batch.id}/candidates/import`, csv),
        200,
      );
      expect(res).toMatchObject({ created: 9, skipped: 0, errors: [] });

      const rows = await Candidate.find({ batchId: batch.id }).sort({ externalRef: 1 }).lean();
      const byRef = Object.fromEntries(rows.map((row) => [row.externalRef, row.name]));
      expect(byRef["R-1"]).toBe(`'=HYPERLINK("http://evil.example","Click")`);
      expect(byRef["R-2"]).toBe("'+1+1");
      expect(byRef["R-3"]).toBe("'-2+3");
      expect(byRef["R-4"]).toBe("'@SUM(A1)");
      expect(byRef["R-5"]).toBe("'=cmd|' /C calc'!A0");
      expect(byRef["R-7"]).toBe("Mid =dash name");
      expect(byRef["R-8"]).toBe("'=1+1");
      expect(byRef["R-9"]).toBe("'@BOM");
      expect(rows.find((row) => row.name === "Plain Name").externalRef).toBe("'=R-6");

      // Learners are stored the same way, and no stored text starts with a formula character.
      const learners = await Learner.find({}).lean();
      const texts = [...rows, ...learners].flatMap((row) => [row.name, row.externalRef]);
      for (const text of texts.filter(Boolean)) expect(text, text).not.toMatch(/^[=+\-@\t\r]/);

      // The API hands back the neutralised text.
      const listed = expectStatus(
        await get(world.admin.token, `/batches/${batch.id}/candidates`),
        200,
      );
      expect(listed.items.map((row) => row.name)).toContain("'+1+1");
    });

    it("applies the same rule to a multipart upload", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world, { candidateCount: 1 });
      const res = await request(app)
        .post(`${API}/batches/${batch.id}/candidates/import`)
        .set(bearer(world.admin.token))
        .attach("file", Buffer.from("name,externalRef\n=2+2,M-1\n@x,M-2\n"), "roster.csv");
      expectStatus(res, 200);
      expect(res.body.created).toBe(2);
      const names = (await Candidate.find({ batchId: batch.id }).lean())
        .map((row) => row.name)
        .sort();
      expect(names).toEqual(["'=2+2", "'@x"]);
    });
  });

  describe("no national id anywhere", () => {
    const SENTINEL = "123412341234";
    const KEYS = [
      "aadhaar",
      "aadhar",
      "aadhaarNumber",
      "aadhaar_number",
      "nationalId",
      "panNumber",
      "voterId",
      "passportNumber",
    ];

    it("rejects an Aadhaar or national-id key on every write route, and stores none", async () => {
      const world = await makeWorld();
      const [learner] = await createLearners(world, 1);
      const assessor = await sessionFor("assessor", {
        email: "field@aa.example",
        linkedProfileId: oid(),
      });
      const proctor = await sessionFor("proctor", {
        email: "proc@aa.example",
        linkedProfileId: oid(),
      });
      const student = await sessionFor("candidate", {
        email: "stud@aa.example",
        linkedProfileId: oid(),
      });
      const admin = world.admin.token;
      let n = 0;
      const uniq = (prefix) => `${prefix}-${(n += 1)}`;
      const noFix = (id) => ({
        clientEventId: uniq("evt"),
        batchId: null,
        type: "login",
        capturedAt: CAPTURED_AT,
        locationStatus: "unavailable",
        locationUnavailableReason: id,
      });

      // `ok` is the status the body gets without the extra key. It must not be a validation
      // error, or the test would pass for the wrong reason. `nested` puts the key inside an
      // array element instead of at the top.
      const cases = [
        {
          name: "POST /learners",
          send: (extra) =>
            post(admin, "/learners", { name: "Asha", externalRef: uniq("X"), ...extra }),
          ok: 201,
        },
        {
          name: "PATCH /learners/:id",
          send: (extra) => patch(admin, `/learners/${GHOST_ID}`, { name: "Asha", ...extra }),
          ok: 404,
        },
        {
          name: "POST /batches/:id/candidates (new person)",
          send: (extra) =>
            post(admin, `/batches/${GHOST_ID}/candidates`, {
              name: "Asha",
              externalRef: "X-1",
              ...extra,
            }),
          ok: 404,
        },
        {
          name: "POST /batches/:id/candidates (learnerId)",
          send: (extra) =>
            post(admin, `/batches/${GHOST_ID}/candidates`, { learnerId: learner.id, ...extra }),
          ok: 404,
        },
        {
          name: "PATCH /batches/:id/candidates/:id",
          send: (extra) =>
            patch(admin, `/batches/${GHOST_ID}/candidates/${GHOST_ID}`, { active: true, ...extra }),
          ok: 404,
        },
        {
          name: "POST /assessors",
          send: (extra) =>
            post(admin, "/assessors", {
              name: "Ravi",
              code: uniq("A"),
              languages: ["Hindi"],
              ...extra,
            }),
          ok: 201,
        },
        {
          name: "PATCH /assessors/:id",
          send: (extra) => patch(admin, `/assessors/${GHOST_ID}`, { name: "Ravi", ...extra }),
          ok: 404,
        },
        {
          name: "POST /proctors",
          send: (extra) => post(admin, "/proctors", { name: "Priya", code: uniq("P"), ...extra }),
          ok: 201,
        },
        {
          name: "PATCH /proctors/:id",
          send: (extra) => patch(admin, `/proctors/${GHOST_ID}`, { name: "Priya", ...extra }),
          ok: 404,
        },
        {
          name: "POST /users",
          send: (extra) =>
            post(admin, "/users", {
              email: `${uniq("u")}@aa.example`,
              name: "Someone",
              role: "mis",
              password: "Long-Enough-1",
              ...extra,
            }),
          ok: 201,
        },
        {
          name: "PATCH /users/:id",
          send: (extra) => patch(admin, `/users/${GHOST_ID}`, { name: "Someone", ...extra }),
          ok: 404,
        },
        {
          name: "POST /users/:id/password-reset",
          send: (extra) =>
            post(admin, `/users/${GHOST_ID}/password-reset`, {
              newPassword: "Long-Enough-1",
              ...extra,
            }),
          ok: 404,
        },
        {
          name: "POST /awarding-bodies",
          send: (extra) =>
            post(admin, "/awarding-bodies", {
              name: "AB",
              code: uniq("AB"),
              notificationEmails: [`${uniq("ab")}@ab.example`],
              ...extra,
            }),
          ok: 201,
        },
        {
          name: "PATCH /awarding-bodies/:id",
          send: (extra) => patch(admin, `/awarding-bodies/${GHOST_ID}`, { name: "AB", ...extra }),
          ok: 404,
        },
        {
          name: "POST /training-partners",
          send: (extra) =>
            post(admin, "/training-partners", { name: "TP", code: uniq("TP"), ...extra }),
          ok: 201,
        },
        {
          name: "PATCH /training-partners/:id",
          send: (extra) => patch(admin, `/training-partners/${GHOST_ID}`, { name: "TP", ...extra }),
          ok: 404,
        },
        {
          name: "POST /centres",
          send: (extra) =>
            post(admin, "/centres", {
              name: "Centre",
              code: uniq("C"),
              tpId: world.tp.id,
              state: "Maharashtra",
              ...extra,
            }),
          ok: 201,
        },
        {
          name: "PATCH /centres/:id",
          send: (extra) => patch(admin, `/centres/${GHOST_ID}`, { name: "Centre", ...extra }),
          ok: 404,
        },
        {
          name: "POST /qualifications",
          send: (extra) =>
            post(admin, "/qualifications", {
              code: uniq("Q"),
              name: "Qual",
              sector: "Electronics",
              ratioClass: "other",
              passMarks: { theory: 50, practical: 50, viva: 50 },
              nos: [],
              ...extra,
            }),
          ok: 201,
        },
        {
          name: "POST /qualifications (inside a NOS)",
          send: (extra) =>
            post(admin, "/qualifications", {
              code: uniq("Q"),
              name: "Qual",
              sector: "Electronics",
              ratioClass: "other",
              passMarks: { theory: 50, practical: 50, viva: 50 },
              nos: [{ nosId: uniq("N"), code: uniq("NC"), name: "NOS", pcs: [], ...extra }],
            }),
          ok: 201,
        },
        {
          name: "PATCH /qualifications/:id",
          send: (extra) => patch(admin, `/qualifications/${GHOST_ID}`, { name: "Qual", ...extra }),
          ok: 404,
        },
        {
          name: "POST /batches",
          send: (extra) =>
            post(admin, "/batches", {
              abId: world.ab.id,
              qualificationId: world.qualification.id,
              type: "STT",
              mode: "offline",
              assessmentStartDate: "2099-06-15",
              assessmentEndDate: "2099-06-16",
              tpId: world.tp.id,
              centreId: world.centre.id,
              candidateCount: 3,
              assessmentLanguage: "Hindi",
              ...extra,
            }),
          ok: 201,
        },
        {
          name: "POST /batches/:id/reassessments",
          send: (extra) =>
            post(admin, `/batches/${GHOST_ID}/reassessments`, {
              assessmentStartDate: "2099-06-15",
              assessmentEndDate: "2099-06-15",
              ...extra,
            }),
          ok: 404,
        },
        ...["accept", "reject", "cancel", "complete", "assign", "reassign"].map((action) => ({
          name: `POST /batches/:id/${action}`,
          send: (extra) =>
            post(admin, `/batches/${GHOST_ID}/${action}`, {
              ...(action === "assign" || action === "reassign" ? { assessorId: GHOST_ID } : {}),
              ...(["reject", "cancel", "complete"].includes(action) ? { reason: "Because" } : {}),
              ...extra,
            }),
          ok: 404,
        })),
        {
          name: "POST /batches/:id/submit-result",
          send: (extra) => post(admin, `/batches/${GHOST_ID}/submit-result`, { ...extra }),
          ok: 404,
        },
        {
          name: "POST /batches/:id/validate",
          send: (extra) =>
            post(world.reviewer.token, `/batches/${GHOST_ID}/validate`, { ...extra }),
          ok: 404,
        },
        {
          name: "POST /batches/:id/return-for-correction",
          send: (extra) =>
            post(world.reviewer.token, `/batches/${GHOST_ID}/return-for-correction`, {
              reason: "Marks differ",
              ...extra,
            }),
          ok: 404,
        },
        {
          name: "PUT /batches/:id/results",
          send: (extra) =>
            put(admin, `/batches/${GHOST_ID}/results`, {
              rows: [{ candidateId: GHOST_ID, nos: [] }],
              ...extra,
            }),
          ok: 404,
        },
        {
          name: "PUT /batches/:id/results (inside a row)",
          send: (extra) =>
            put(admin, `/batches/${GHOST_ID}/results`, {
              rows: [{ candidateId: GHOST_ID, nos: [], ...extra }],
            }),
          ok: 404,
        },
        {
          name: "PUT /batches/:id/results (inside a NOS entry)",
          send: (extra) =>
            put(admin, `/batches/${GHOST_ID}/results`, {
              rows: [{ candidateId: GHOST_ID, nos: [{ nosId: "NOS-01", theory: 50, ...extra }] }],
            }),
          ok: 404,
        },
        {
          name: "PUT /batches/:id/learner-feedback",
          send: (extra) =>
            put(admin, `/batches/${GHOST_ID}/learner-feedback`, { collected: true, ...extra }),
          ok: 404,
        },
        {
          name: "PUT /batches/:id/assessor-payment",
          send: (extra) =>
            put(admin, `/batches/${GHOST_ID}/assessor-payment`, {
              amountDue: 100,
              amountPaid: 50,
              ...extra,
            }),
          ok: 404,
        },
        {
          name: "POST /assessor/login-event",
          send: (extra) =>
            post(assessor.token, "/assessor/login-event", { ...noFix("no_batch"), ...extra }),
          ok: 200,
        },
        {
          name: "POST /proctor/login-event",
          send: (extra) =>
            post(proctor.token, "/proctor/login-event", { ...noFix("no_batch"), ...extra }),
          ok: 200,
        },
        {
          name: "POST /student/login-event",
          send: (extra) =>
            post(student.token, "/student/login-event", { ...noFix("no_batch"), ...extra }),
          ok: 200,
        },
        {
          name: "POST /assessor/batches/:id/attendance",
          send: (extra) =>
            post(assessor.token, `/assessor/batches/${GHOST_ID}/attendance`, {
              capturedAt: CAPTURED_AT,
              records: [{ candidateId: GHOST_ID, present: true }],
              ...extra,
            }),
          ok: 404,
        },
        {
          name: "POST /assessor/batches/:id/attendance (inside a record)",
          send: (extra) =>
            post(assessor.token, `/assessor/batches/${GHOST_ID}/attendance`, {
              capturedAt: CAPTURED_AT,
              records: [{ candidateId: GHOST_ID, present: true, ...extra }],
            }),
          ok: 404,
        },
        {
          name: "POST /assessor/batches/:id/checklist (inside an item)",
          send: (extra) =>
            post(assessor.token, `/assessor/batches/${GHOST_ID}/checklist`, {
              clientEventId: uniq("chk"),
              capturedAt: CAPTURED_AT,
              items: [{ key: "multimeter", available: true, ...extra }],
            }),
          ok: 404,
        },
        {
          name: "PUT /admin/recognition",
          send: (extra) =>
            put(admin, "/admin/recognition", {
              sectors: ["Electronics"],
              panIndia: true,
              states: [],
              startDate: "2020-01-01",
              endDate: "2099-12-31",
              ...extra,
            }),
          ok: 200,
        },
        {
          name: "POST /admin/holidays",
          send: (extra) =>
            post(admin, "/admin/holidays", { date: "2099-01-26", name: "Republic Day", ...extra }),
          ok: 201,
        },
        {
          name: "PUT /admin/working-day-config",
          send: (extra) =>
            put(admin, "/admin/working-day-config", { weekendDays: [0, 6], ...extra }),
          ok: 200,
        },
      ];

      const failures = [];
      for (const entry of cases) {
        const baseline = await entry.send({});
        if (baseline.status !== entry.ok) {
          failures.push(`${entry.name}: control call gave ${baseline.status}, wanted ${entry.ok}`);
          continue;
        }
        for (const key of KEYS) {
          const res = await entry.send({ [key]: SENTINEL });
          if (res.status !== 400 || res.body.error?.code !== "VALIDATION_ERROR") {
            failures.push(`${entry.name} with "${key}": ${res.status} ${JSON.stringify(res.body)}`);
          }
        }
      }
      expect(failures).toEqual([]);

      // Nothing anywhere holds the number: not a collection, not an audit row.
      const collections = await mongoose.connection.db.collections();
      for (const collection of collections) {
        const docs = await collection.find({}).toArray();
        expect(JSON.stringify(docs), collection.collectionName).not.toContain(SENTINEL);
      }
    });

    it("accepts idVerified as a yes/no only", async () => {
      const world = await makeWorld();
      const ctx = await prepareBatch(world, { until: "in_progress" });
      const res = await post(
        ctx.assessorSession.token,
        `/assessor/batches/${ctx.batch.id}/attendance`,
        {
          capturedAt: CAPTURED_AT,
          records: [{ candidateId: ctx.roster[0].id, present: true, idVerified: SENTINEL }],
        },
      );
      expectError(res, 400, "VALIDATION_ERROR");
      expect(await Candidate.countDocuments({ batchId: ctx.batch.id })).toBe(3);
    });

    it("ignores an extra CSV column without storing it", async () => {
      const world = await makeWorld();
      const batch = await createBatch(world, { candidateCount: 1 });
      const res = expectStatus(
        await postCsv(
          world.admin.token,
          `/batches/${batch.id}/candidates/import`,
          `name,externalRef,aadhaar
Asha,A-1,${SENTINEL}
`,
        ),
        200,
      );
      expect(res.created).toBe(1);
      const collections = await mongoose.connection.db.collections();
      for (const collection of collections) {
        const docs = await collection.find({}).toArray();
        expect(JSON.stringify(docs), collection.collectionName).not.toContain(SENTINEL);
      }
    });

    // BUG T01-B1. POST /auth/login and POST /auth/refresh parse their body with a schema that is not
    // `.strict()` (auth.schemas.js), so an extra field such as `aadhaar` is accepted with 200. The
    // audit middleware then stores the raw request body (`meta.requestBody`, audit.middleware.js),
    // so the number lands in auditLogs. SCHEMA PII rule: do not store Aadhaar or any national id.
    // Every other write route in the API is strict and answers 400. Enable once login and refresh
    // reject unknown keys, or the audit row stores the parsed body.
    it("T01-B1: login and refresh reject a national-id field and the audit row never holds it", async () => {
      const world = await makeWorld();
      const login = await request(app).post(`${API}/auth/login`).send({
        email: world.admin.email,
        password: world.admin.password,
        device: world.admin.device,
        aadhaar: SENTINEL,
      });
      expectError(login, 400, "VALIDATION_ERROR");
      const refresh = await request(app)
        .post(`${API}/auth/refresh`)
        .send({
          refreshToken: world.admin.refreshToken,
          device: { ...world.admin.device, aadhaar: SENTINEL },
        });
      expectError(refresh, 400, "VALIDATION_ERROR");
      const collections = await mongoose.connection.db.collections();
      for (const collection of collections) {
        const docs = await collection.find({}).toArray();
        expect(JSON.stringify(docs), collection.collectionName).not.toContain(SENTINEL);
      }
    });
  });
});
