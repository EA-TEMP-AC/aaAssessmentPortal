import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { hashRefreshToken } from "../src/lib/tokens.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { User } from "../src/models/user.model.js";
import { consumeLoginAttempt, resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

async function login(email, password, device = webDevice) {
  return request(app).post("/api/v1/auth/login").send({ email, password, device });
}

describe("auth", () => {
  beforeAll(async () => {
    await startMongo();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("logs in and returns the session shape, including mustChangePassword", async () => {
    const { password } = await createUser({
      email: "admin@aa.example",
      mustChangePassword: true,
    });

    const res = await login("Admin@aa.example", password);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toMatch(/^rt_/);
    expect(res.body.expiresInMs).toBe(compliance.ACCESS_TOKEN_TTL_MS);
    expect(res.body.offlineSessionMaxMs).toBe(compliance.OFFLINE_SESSION_MAX_MS);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      role: "aa_admin",
      name: "AA Admin",
      mustChangePassword: true,
    });
    expect(res.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(password);

    const stored = await RefreshToken.findOne({ userId: res.body.user.id });
    expect(stored.tokenHash).toBe(hashRefreshToken(res.body.refreshToken));
    expect(stored.tokenHash).not.toBe(res.body.refreshToken);
    expect(stored.deviceId).toBe(webDevice.deviceId);
  });

  it("rejects unknown emails and wrong passwords with the same error", async () => {
    const { password } = await createUser({ email: "admin@aa.example" });

    const unknown = await login("missing@aa.example", password);
    const wrong = await login("admin@aa.example", "not-the-password");

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
    });
    expect(wrong.body).toEqual(unknown.body);
  });

  it("rejects inactive users", async () => {
    const { password } = await createUser({ email: "idle@aa.example", active: false });
    const res = await login("idle@aa.example", password);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 for an invalid login body", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rate limits login attempts per IP and email", async () => {
    const { password } = await createUser({ email: "limited@aa.example" });
    const other = await createUser({ email: "other@aa.example", password });

    for (let i = 0; i < compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      const attempt = await login("limited@aa.example", "wrong-password");
      expect(attempt.status).toBe(401);
    }

    const blocked = await login("limited@aa.example", password);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many login attempts" },
    });

    const separateEmail = await login(other.user.email, other.password);
    expect(separateEmail.status).toBe(200);
  });

  it("expires login attempts outside the rate-limit window", () => {
    resetLoginRateLimit();
    const start = 1_700_000_000_000;
    for (let i = 0; i < compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expect(consumeLoginAttempt("203.0.113.5", "window@aa.example", start).allowed).toBe(true);
    }
    expect(consumeLoginAttempt("203.0.113.5", "window@aa.example", start + 1).allowed).toBe(false);
    expect(
      consumeLoginAttempt(
        "203.0.113.5",
        "window@aa.example",
        start + compliance.LOGIN_RATE_LIMIT_WINDOW_MS,
      ).allowed,
    ).toBe(true);
    expect(consumeLoginAttempt("203.0.113.9", "window@aa.example", start + 1).allowed).toBe(true);
  });

  it("rotates refresh tokens and rejects a device mismatch", async () => {
    const { password } = await createUser({ email: "admin@aa.example" });
    const first = await login("admin@aa.example", password);
    expect(first.status).toBe(200);

    const mismatch = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: first.body.refreshToken,
        device: { ...webDevice, deviceId: "other-device" },
      });
    expect(mismatch.status).toBe(401);
    expect(mismatch.body.error.code).toBe("UNAUTHORIZED");

    const rotated = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: first.body.refreshToken,
      device: webDevice,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).toMatch(/^rt_/);
    expect(rotated.body.refreshToken).not.toBe(first.body.refreshToken);
    expect(rotated.body.accessToken).not.toBe(first.body.accessToken);
    expect(rotated.body.user.role).toBe("aa_admin");

    const reused = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: first.body.refreshToken,
      device: webDevice,
    });
    expect(reused.status).toBe(401);

    const next = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: rotated.body.refreshToken,
      device: webDevice,
    });
    expect(next.status).toBe(200);

    const previous = await RefreshToken.findOne({
      tokenHash: hashRefreshToken(first.body.refreshToken),
    });
    expect(previous.revokedAt).toBeInstanceOf(Date);
  });

  it("revokes the refresh token on logout", async () => {
    const { password } = await createUser({ email: "admin@aa.example" });
    const session = await login("admin@aa.example", password);

    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: session.body.refreshToken });
    expect(logout.status).toBe(204);
    expect(logout.text).toBe("");

    const again = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: session.body.refreshToken,
      device: webDevice,
    });
    expect(again.status).toBe(401);

    const empty = await request(app).post("/api/v1/auth/logout").send({});
    expect(empty.status).toBe(204);
  });

  it("rejects an expired refresh token", async () => {
    const { user } = await createUser({ email: "admin@aa.example" });
    const raw = "rt_expiredtokenvalue";
    await RefreshToken.create({
      userId: user._id,
      tokenHash: hashRefreshToken(raw),
      deviceId: webDevice.deviceId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: raw,
      device: webDevice,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("does not store a plaintext password on the user", async () => {
    const { user, password } = await createUser({ email: "admin@aa.example" });
    const stored = await User.findById(user._id).select("+passwordHash");
    expect(stored.passwordHash).not.toBe(password);
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
  });
});
