import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { resetChangePasswordRateLimit } from "../src/modules/auth/change-password-rate-limit.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const OLD = "Correct-Horse-9";
const NEW = "Battery-Staple-7";
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function login(email, password = OLD) {
  return request(app).post("/api/v1/auth/login").send({ email, password, device: webDevice });
}

describe("mustChangePassword guard", () => {
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

  it("returns 403 MUST_CHANGE_PASSWORD everywhere except the auth routes", async () => {
    await createUser({ email: "tmp@aa.example", role: "aa_admin", mustChangePassword: true });
    const session = await login("tmp@aa.example");
    expect(session.status).toBe(200);
    expect(session.body.user.mustChangePassword).toBe(true);
    const token = session.body.accessToken;

    for (const path of ["/api/v1/evidence", "/api/v1/users", "/api/v1/audit-logs"]) {
      const res = await request(app).get(path).set(bearer(token));
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe("MUST_CHANGE_PASSWORD");
    }

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: session.body.refreshToken, device: webDevice });
    expect(refreshed.status).toBe(200);

    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set(bearer(token))
      .send({ currentPassword: OLD, newPassword: NEW, refreshToken: refreshed.body.refreshToken });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    const after = await login("tmp@aa.example", NEW);
    expect(after.body.user.mustChangePassword).toBe(false);
    const ok = await request(app).get("/api/v1/evidence").set(bearer(after.body.accessToken));
    expect(ok.status).toBe(200);
  });

  it("still lets the user log out", async () => {
    await createUser({ email: "tmp2@aa.example", role: "aa_admin", mustChangePassword: true });
    const session = await login("tmp2@aa.example");
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set(bearer(session.body.accessToken))
      .send({ refreshToken: session.body.refreshToken });
    expect(res.status).toBe(204);
  });

  it("does not block a user whose flag is clear", async () => {
    await createUser({ email: "ok@aa.example", role: "aa_admin" });
    const session = await login("ok@aa.example");
    const res = await request(app).get("/api/v1/evidence").set(bearer(session.body.accessToken));
    expect(res.status).toBe(200);
  });
});

describe("audit write failure after a saved change", () => {
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

  it("keeps the success response and logs only the error code", async () => {
    await createUser({ email: "a@aa.example", role: "aa_admin" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi
      .spyOn(AuditLog, "create")
      .mockRejectedValue(
        Object.assign(new Error("duplicate key SECRET-DOC-CONTENT"), { code: 11000 }),
      );
    try {
      const res = await login("a@aa.example");
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain("11000");
      expect(logged).not.toContain("SECRET-DOC-CONTENT");
    } finally {
      create.mockRestore();
      spy.mockRestore();
    }
  });

  it("logs an unexpected error by code only", async () => {
    await createUser({ email: "b@aa.example", role: "aa_admin" });
    const session = await login("b@aa.example");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const find = vi.spyOn(AuditLog, "find").mockImplementation(() => {
      throw new Error("boom SECRET-ERROR-TEXT");
    });
    try {
      const res = await request(app)
        .get("/api/v1/audit-logs")
        .set(bearer(session.body.accessToken));
      expect(res.status).toBe(500);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRET-ERROR-TEXT");
    } finally {
      find.mockRestore();
      spy.mockRestore();
    }
  });
});
