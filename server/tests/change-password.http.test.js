import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { verifyPassword } from "../src/lib/password.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { User } from "../src/models/user.model.js";
import {
  consumeChangePasswordAttempt,
  resetChangePasswordRateLimit,
} from "../src/modules/auth/change-password-rate-limit.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const OLD = "Correct-Horse-9";
const NEW = "Battery-Staple-7";
const phone = { deviceId: "dev-phone", platform: "android", appVersion: "1.0.0" };

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function login(email, password, device = webDevice) {
  return request(app).post("/api/v1/auth/login").send({ email, password, device });
}

function refresh(refreshToken, device = webDevice) {
  return request(app).post("/api/v1/auth/refresh").send({ refreshToken, device });
}

function changePassword(accessToken, body) {
  const req = request(app).post("/api/v1/auth/change-password");
  if (accessToken) req.set({ Authorization: `Bearer ${accessToken}` });
  return req.send(body);
}

/** A user signed in on the web and on a phone. */
async function signedIn(overrides = {}) {
  const email = overrides.email ?? "assessor@aa.example";
  const { user } = await createUser({ email, role: "assessor", name: "Asha", ...overrides });
  const web = await login(email, OLD);
  const mobile = await login(email, OLD, phone);
  expect(web.status).toBe(200);
  expect(mobile.status).toBe(200);
  return { user, email, web: web.body, mobile: mobile.body };
}

describe("POST /auth/change-password", () => {
  beforeAll(async () => {
    await startMongo();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    resetChangePasswordRateLimit();
  });

  it("sets the new password, clears mustChangePassword, and keeps only this session", async () => {
    const s = await signedIn({ mustChangePassword: true });
    expect(s.web.user.mustChangePassword).toBe(true);

    const res = await changePassword(s.web.accessToken, {
      currentPassword: OLD,
      newPassword: NEW,
      refreshToken: s.web.refreshToken,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      user: { id: String(s.user._id), role: "assessor", name: "Asha", mustChangePassword: false },
    });

    const stored = await User.findById(s.user._id).select("+passwordHash").lean();
    expect(stored.mustChangePassword).toBe(false);
    expect(await verifyPassword(NEW, stored.passwordHash)).toBe(true);
    expect(await verifyPassword(OLD, stored.passwordHash)).toBe(false);
    expect(stored.passwordHash).not.toContain(NEW);

    // The phone's refresh token is revoked; this session's still rotates.
    expectError(await refresh(s.mobile.refreshToken, phone), 401, "UNAUTHORIZED");
    const rotated = await refresh(s.web.refreshToken);
    expect(rotated.status).toBe(200);
    expect(rotated.body.user.mustChangePassword).toBe(false);

    expectError(await login(s.email, OLD), 401, "UNAUTHORIZED");
    const again = await login(s.email, NEW);
    expect(again.status).toBe(200);
    expect(again.body.user.mustChangePassword).toBe(false);
  });

  it("revokes every refresh token when the request names none", async () => {
    const s = await signedIn();

    const res = await changePassword(s.web.accessToken, { currentPassword: OLD, newPassword: NEW });

    expect(res.status).toBe(200);
    expect(await RefreshToken.countDocuments({ userId: s.user._id, revokedAt: null })).toBe(0);
    const audit = await AuditLog.findOne({ action: "auth.password_changed" }).lean();
    expect(audit.meta).toMatchObject({ revokedRefreshTokens: 2, keptCurrentSession: false });
  });

  it("does not keep another user's refresh token, and leaves that user signed in", async () => {
    const s = await signedIn();
    const other = await signedIn({ email: "other@aa.example" });

    const res = await changePassword(s.web.accessToken, {
      currentPassword: OLD,
      newPassword: NEW,
      refreshToken: other.web.refreshToken,
    });

    expect(res.status).toBe(200);
    expect(await RefreshToken.countDocuments({ userId: s.user._id, revokedAt: null })).toBe(0);
    expect(await RefreshToken.countDocuments({ userId: other.user._id, revokedAt: null })).toBe(2);
    expect((await login(other.email, OLD)).status).toBe(200);
  });

  it("writes an audit row with the actor and no password or token", async () => {
    const s = await signedIn({ mustChangePassword: true });

    await changePassword(s.web.accessToken, {
      currentPassword: OLD,
      newPassword: NEW,
      refreshToken: s.web.refreshToken,
    });

    const rows = await AuditLog.find({ action: "auth.password_changed" }).lean();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(String(row.actorId)).toBe(String(s.user._id));
    expect(row.actorRole).toBe("assessor");
    expect(row.entity).toBe("user");
    expect(row.entityId).toBe(String(s.user._id));
    expect(row.meta).toMatchObject({ revokedRefreshTokens: 1, keptCurrentSession: true });
    expect(row.meta.requestBody).toEqual({
      currentPassword: "***",
      newPassword: "***",
      refreshToken: "***",
    });

    const text = JSON.stringify(await AuditLog.find().lean());
    expect(text).not.toContain(OLD);
    expect(text).not.toContain(NEW);
    expect(text).not.toContain(s.web.refreshToken);
    const stored = await User.findById(s.user._id).select("+passwordHash").lean();
    expect(text).not.toContain(stored.passwordHash);
  });

  it("refuses a wrong current password without changing anything, and audits the failure", async () => {
    const s = await signedIn({ mustChangePassword: true });

    const res = await changePassword(s.web.accessToken, {
      currentPassword: "Wrong-Password-1",
      newPassword: NEW,
      refreshToken: s.web.refreshToken,
    });

    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.error.details).toEqual({ currentPassword: ["Current password is incorrect"] });
    const stored = await User.findById(s.user._id).select("+passwordHash").lean();
    expect(stored.mustChangePassword).toBe(true);
    expect(await verifyPassword(OLD, stored.passwordHash)).toBe(true);
    expect(await RefreshToken.countDocuments({ userId: s.user._id, revokedAt: null })).toBe(2);

    expect(await AuditLog.countDocuments({ action: "auth.password_changed" })).toBe(0);
    const failed = await AuditLog.find({ action: "auth.password_change_failed" }).lean();
    expect(failed).toHaveLength(1);
    expect(String(failed[0].actorId)).toBe(String(s.user._id));
    expect(JSON.stringify(failed)).not.toContain("Wrong-Password-1");
    expect(JSON.stringify(failed)).not.toContain(NEW);
  });

  it.each([
    ["7 characters", "Short-7"],
    ["201 characters", "a".repeat(201)],
  ])("rejects a new password of %s", async (_label, newPassword) => {
    const s = await signedIn();
    const res = await changePassword(s.web.accessToken, { currentPassword: OLD, newPassword });
    expectError(res, 400, "VALIDATION_ERROR");
    expect((await login(s.email, OLD)).status).toBe(200);
  });

  it.each([
    ["8 characters", "Eight-88"],
    ["200 characters", "b".repeat(200)],
  ])("accepts a new password of %s", async (_label, newPassword) => {
    const s = await signedIn();
    const res = await changePassword(s.web.accessToken, { currentPassword: OLD, newPassword });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await login(s.email, newPassword)).status).toBe(200);
  });

  it("rejects a missing field, an unknown key, and a new password equal to the current one", async () => {
    const s = await signedIn({ mustChangePassword: true });

    expectError(
      await changePassword(s.web.accessToken, { newPassword: NEW }),
      400,
      "VALIDATION_ERROR",
    );
    expectError(
      await changePassword(s.web.accessToken, { currentPassword: OLD }),
      400,
      "VALIDATION_ERROR",
    );
    expectError(
      await changePassword(s.web.accessToken, {
        currentPassword: OLD,
        newPassword: NEW,
        mustChangePassword: false,
      }),
      400,
      "VALIDATION_ERROR",
    );
    const same = await changePassword(s.web.accessToken, {
      currentPassword: OLD,
      newPassword: OLD,
    });
    expectError(same, 400, "VALIDATION_ERROR");
    expect(same.body.error.details).toEqual({
      newPassword: ["Must differ from the current password"],
    });

    const stored = await User.findById(s.user._id).lean();
    expect(stored.mustChangePassword).toBe(true);
    expect(await AuditLog.countDocuments({ action: "auth.password_changed" })).toBe(0);
  });

  it("needs a valid access token", async () => {
    const s = await signedIn();
    const body = { currentPassword: OLD, newPassword: NEW };

    expectError(await changePassword(null, body), 401, "UNAUTHORIZED");
    expectError(await changePassword("not-a-token", body), 401, "UNAUTHORIZED");
    // A refresh token is not an access token.
    expectError(await changePassword(s.web.refreshToken, body), 401, "UNAUTHORIZED");
    expect((await login(s.email, OLD)).status).toBe(200);
  });

  it("rate limits attempts per user with the login window, and audits the block", async () => {
    const s = await signedIn();
    const other = await signedIn({ email: "other@aa.example" });
    const wrong = { currentPassword: "Wrong-Password-1", newPassword: NEW };

    for (let i = 0; i < compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expectError(await changePassword(s.web.accessToken, wrong), 400, "VALIDATION_ERROR");
    }

    // Even the right password is refused once the window is full.
    const blocked = await changePassword(s.web.accessToken, {
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many password change attempts" },
    });
    expect((await login(s.email, OLD)).status).toBe(200);

    // Another user is not affected.
    const separate = await changePassword(other.web.accessToken, {
      currentPassword: OLD,
      newPassword: NEW,
    });
    expect(separate.status).toBe(200);

    const limited = await AuditLog.find({ action: "auth.password_change_rate_limited" }).lean();
    expect(limited).toHaveLength(1);
    expect(String(limited[0].actorId)).toBe(String(s.user._id));
    expect(JSON.stringify(limited)).not.toContain(OLD);
    expect(JSON.stringify(limited)).not.toContain(NEW);
  });

  it("frees attempts once they leave the rate-limit window", () => {
    const start = 1_000_000;
    for (let i = 0; i < compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expect(consumeChangePasswordAttempt("user-1", start + i).allowed).toBe(true);
    }
    expect(consumeChangePasswordAttempt("user-1", start + 100).allowed).toBe(false);
    expect(consumeChangePasswordAttempt("user-2", start + 100).allowed).toBe(true);
    const later = start + compliance.LOGIN_RATE_LIMIT_WINDOW_MS + 10;
    expect(consumeChangePasswordAttempt("user-1", later).allowed).toBe(true);
  });
});
