import request from "supertest";
import { vi } from "vitest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { RefreshToken } from "../src/models/refresh-token.model.js";
import { USER_ADMIN_ROLES, USER_ROLES } from "../src/models/roles.js";
import { User } from "../src/models/user.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { processNextEmail } from "../src/modules/email/email-queue.service.js";
import {
  consumePasswordResetAttempt,
  resetPasswordResetRateLimit,
} from "../src/modules/users/password-reset-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const deniedRoles = USER_ROLES.filter((role) => !USER_ADMIN_ROLES.includes(role));
const linkedProfileId = "66f0000000000000000000a1";

const publicKeys = [
  "id",
  "email",
  "name",
  "role",
  "active",
  "mustChangePassword",
  "linkedProfileId",
  "abId",
  "tpId",
  "createdAt",
  "updatedAt",
];

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectNoSecrets(value, secrets) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("passwordHash");
  expect(serialized).not.toContain("passwordResetToken");
  expect(serialized).not.toContain("tokenHash");
  for (const secret of secrets) {
    if (secret) expect(serialized).not.toContain(secret);
  }
}

function temporaryPasswordFrom(text) {
  const match = /Temporary password: (\S+)/.exec(text);
  expect(match).not.toBeNull();
  return match[1];
}

async function sessionFor(role, extra = {}) {
  const email = extra.email ?? `${role}@aa.example`;
  const { password } = await createUser({
    role,
    email,
    name: extra.name ?? role,
    ...extra.user,
  });
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return {
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
    email,
    password,
  };
}

async function login(email, password) {
  return request(app).post("/api/v1/auth/login").send({ email, password, device: webDevice });
}

describe("users", () => {
  beforeAll(async () => {
    await startMongo();
    await User.init();
    await EmailQueue.init();
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    resetPasswordResetRateLimit();
  });

  it("lets aa_admin and mis create, read, and update users without returning secrets", async () => {
    expect(USER_ADMIN_ROLES).toEqual(["aa_admin", "mis"]);
    const admin = await sessionFor("aa_admin");
    const password = "Temporary-Pass-1";

    const created = await request(app).post("/api/v1/users").set(bearer(admin.token)).send({
      email: "Learner1@example.com",
      name: "Asha Devi",
      role: "candidate",
      password,
      linkedProfileId,
    });

    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual([...publicKeys].sort());
    expect(created.body).toMatchObject({
      email: "learner1@example.com",
      name: "Asha Devi",
      role: "candidate",
      active: true,
      mustChangePassword: true,
      linkedProfileId,
      abId: null,
      tpId: null,
    });
    expectNoSecrets(created.body, [password]);

    const stored = await User.findById(created.body.id).select("+passwordHash").lean();
    expect(stored.passwordHash).not.toBe(password);
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain(stored.passwordHash);

    const createAudit = await AuditLog.findOne({ action: "user.create" }).lean();
    expect(createAudit.actorRole).toBe("aa_admin");
    expect(createAudit.entity).toBe("user");
    expect(createAudit.entityId).toBe(created.body.id);
    expect(createAudit.after.mustChangePassword).toBe(true);
    expect(createAudit.meta.requestBody.password).toBe("***");
    expectNoSecrets(createAudit, [password, stored.passwordHash]);

    const fetched = await request(app)
      .get(`/api/v1/users/${created.body.id}`)
      .set(bearer(admin.token));
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
    expectNoSecrets(fetched.body, [password, stored.passwordHash]);

    const mis = await sessionFor("mis");
    const listed = await request(app)
      .get("/api/v1/users?role=candidate&active=true")
      .set(bearer(mis.token));
    expect(listed.status).toBe(200);
    expect(listed.body.page).toBe(1);
    expect(listed.body.pageSize).toBe(20);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items).toEqual([created.body]);
    expectNoSecrets(listed.body, [password, stored.passwordHash]);

    const patched = await request(app)
      .patch(`/api/v1/users/${created.body.id}`)
      .set(bearer(mis.token))
      .send({ name: "Asha D.", active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe("Asha D.");
    expect(patched.body.active).toBe(false);
    expect(patched.body.mustChangePassword).toBe(true);
    expectNoSecrets(patched.body, [password, stored.passwordHash]);

    const updateAudit = await AuditLog.findOne({ action: "user.update" }).lean();
    expect(updateAudit.before.name).toBe("Asha Devi");
    expect(updateAudit.after.name).toBe("Asha D.");
    expect(updateAudit.actorRole).toBe("mis");
    expectNoSecrets(updateAudit, [password, stored.passwordHash]);

    const inactiveLogin = await login("learner1@example.com", password);
    expect(inactiveLogin.status).toBe(401);

    const adminView = await request(app)
      .get(`/api/v1/users/${admin.userId}`)
      .set(bearer(mis.token));
    expect(adminView.status).toBe(200);
    expect(adminView.body.role).toBe("aa_admin");
  });

  it("lets aa_admin create another aa_admin and rejects mis escalation", async () => {
    const admin = await sessionFor("aa_admin");
    const mis = await sessionFor("mis");
    const body = {
      email: "second-admin@aa.example",
      name: "Second Admin",
      role: "aa_admin",
      password: "Temporary-Pass-1",
    };

    const byAdmin = await request(app).post("/api/v1/users").set(bearer(admin.token)).send(body);
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.body.role).toBe("aa_admin");
    expect(byAdmin.body.mustChangePassword).toBe(true);

    const byMis = await request(app)
      .post("/api/v1/users")
      .set(bearer(mis.token))
      .send({ ...body, email: "third-admin@aa.example" });
    expect(byMis.status).toBe(403);
    expect(byMis.body.error.code).toBe("FORBIDDEN");

    const promote = await request(app)
      .patch(`/api/v1/users/${mis.userId}`)
      .set(bearer(mis.token))
      .send({ role: "aa_admin" });
    expect(promote.status).toBe(403);
    expect(promote.body.error.code).toBe("FORBIDDEN");

    const editAdmin = await request(app)
      .patch(`/api/v1/users/${admin.userId}`)
      .set(bearer(mis.token))
      .send({ name: "Taken Over" });
    expect(editAdmin.status).toBe(403);

    const resetAdmin = await request(app)
      .post(`/api/v1/users/${admin.userId}/password-reset`)
      .set(bearer(mis.token))
      .send({ newPassword: "Temporary-Pass-9" });
    expect(resetAdmin.status).toBe(403);
    expectNoSecrets(resetAdmin.body, ["Temporary-Pass-9"]);
  });

  it("rejects duplicate emails, invalid bodies, and unknown ids", async () => {
    const admin = await sessionFor("aa_admin");
    const payload = {
      email: "learner1@example.com",
      name: "Asha Devi",
      role: "candidate",
      password: "Temporary-Pass-1",
    };
    const first = await request(app).post("/api/v1/users").set(bearer(admin.token)).send(payload);
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post("/api/v1/users")
      .set(bearer(admin.token))
      .send({ ...payload, email: "LEARNER1@example.com" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("DUPLICATE_RESOURCE");

    const invalid = await request(app)
      .post("/api/v1/users")
      .set(bearer(admin.token))
      .send({
        ...payload,
        email: "other@example.com",
        password: "short",
        mustChangePassword: false,
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const missing = await request(app)
      .get("/api/v1/users/66f0000000000000000000aa")
      .set(bearer(admin.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");

    const badId = await request(app).get("/api/v1/users/not-an-id").set(bearer(admin.token));
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe("VALIDATION_ERROR");

    const emptyPatch = await request(app)
      .patch(`/api/v1/users/${first.body.id}`)
      .set(bearer(admin.token))
      .send({});
    expect(emptyPatch.status).toBe(400);

    const passwordPatch = await request(app)
      .patch(`/api/v1/users/${first.body.id}`)
      .set(bearer(admin.token))
      .send({ password: "Temporary-Pass-2" });
    expect(passwordPatch.status).toBe(400);
    expectNoSecrets(passwordPatch.body, ["Temporary-Pass-2"]);
  });

  it("pages users and filters by role", async () => {
    const admin = await sessionFor("aa_admin");
    for (const name of ["One", "Two", "Three"]) {
      const res = await request(app)
        .post("/api/v1/users")
        .set(bearer(admin.token))
        .send({
          email: `${name.toLowerCase()}@example.com`,
          name,
          role: "sme",
          password: "Temporary-Pass-1",
        });
      expect(res.status).toBe(201);
    }

    const page = await request(app)
      .get("/api/v1/users?role=sme&page=2&pageSize=2")
      .set(bearer(admin.token));
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.body.items).toHaveLength(1);
    expectNoSecrets(page.body, ["Temporary-Pass-1"]);
  });

  it("forbids every role that is not aa_admin or mis", async () => {
    const admin = await sessionFor("aa_admin");
    const created = await request(app).post("/api/v1/users").set(bearer(admin.token)).send({
      email: "learner1@example.com",
      name: "Asha Devi",
      role: "candidate",
      password: "Temporary-Pass-1",
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const anonymous = await request(app).get("/api/v1/users");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("UNAUTHORIZED");

    expect(deniedRoles).toEqual([
      "sme",
      "assessor",
      "proctor",
      "candidate",
      "tp",
      "ab_reviewer",
      "ncvet_viewer",
    ]);

    for (const role of deniedRoles) {
      const session = await sessionFor(role);
      const calls = [
        request(app).post("/api/v1/users").set(bearer(session.token)).send({}),
        request(app).get("/api/v1/users").set(bearer(session.token)),
        request(app).get(`/api/v1/users/${id}`).set(bearer(session.token)),
        request(app).patch(`/api/v1/users/${id}`).set(bearer(session.token)).send({ name: "No" }),
        request(app)
          .post(`/api/v1/users/${id}/password-reset`)
          .set(bearer(session.token))
          .send({ newPassword: "Temporary-Pass-9" }),
      ];
      const responses = await Promise.all(calls);
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
        expectNoSecrets(res.body, ["Temporary-Pass-9"]);
      }
    }
  });

  it("sets a new password, forces a change, and revokes refresh tokens", async () => {
    const admin = await sessionFor("aa_admin");
    const target = await sessionFor("assessor", { email: "assessor-1@aa.example" });
    const newPassword = "Reset-Password-2";

    const res = await request(app)
      .post(`/api/v1/users/${target.userId}/password-reset`)
      .set(bearer(admin.token))
      .send({ newPassword });

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expectNoSecrets(res.body, [newPassword, target.password]);

    const stored = await User.findById(target.userId).select("+passwordHash").lean();
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.passwordHash).not.toBe(newPassword);
    expect(stored.passwordHash).not.toBe(target.password);

    const audit = await AuditLog.find({ action: "user.password_reset" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0].meta.mode).toBe("set_password");
    expect(audit[0].meta.requestBody.newPassword).toBe("***");
    expect(audit[0].after.mustChangePassword).toBe(true);
    expect(audit[0].actorId.toString()).toBe(admin.userId);
    expectNoSecrets(audit, [newPassword, target.password, stored.passwordHash]);

    const activeTokens = await RefreshToken.countDocuments({
      userId: target.userId,
      revokedAt: null,
    });
    expect(activeTokens).toBe(0);

    const reused = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: target.refreshToken,
      device: webDevice,
    });
    expect(reused.status).toBe(401);

    const oldLogin = await login(target.email, target.password);
    expect(oldLogin.status).toBe(401);
    const next = await login(target.email, newPassword);
    expect(next.status).toBe(200);
    expect(next.body.user.mustChangePassword).toBe(true);
  });

  it("queues a reset email and still responds when delivery fails", async () => {
    const admin = await sessionFor("aa_admin");
    const target = await sessionFor("proctor", { email: "proctor-1@aa.example" });

    const res = await request(app)
      .post(`/api/v1/users/${target.userId}/password-reset`)
      .set(bearer(admin.token))
      .send({ sendEmail: true });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ emailQueued: true });

    const job = await EmailQueue.findOne({ kind: "password_reset" }).lean();
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.to).toEqual([target.email]);
    expect(job.nextAttemptAt).toBeInstanceOf(Date);
    const temporaryPassword = temporaryPasswordFrom(job.text);
    expectNoSecrets(res.body, [temporaryPassword, target.password]);

    const audit = await AuditLog.find({ action: "user.password_reset" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ mode: "email", emailQueued: true });
    expect(audit[0].after.mustChangePassword).toBe(true);
    expectNoSecrets(audit, [temporaryPassword, target.password]);
    expect(JSON.stringify(audit)).not.toContain(job.text);

    const stored = await User.findById(target.userId).select(
      "+passwordHash +passwordResetTokenHash",
    );
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.passwordHash).not.toBe(temporaryPassword);
    expect(stored.passwordResetTokenHash).toBeUndefined();
    expectNoSecrets(res.body, [stored.passwordHash]);

    const activeTokens = await RefreshToken.countDocuments({
      userId: target.userId,
      revokedAt: null,
    });
    expect(activeTokens).toBe(0);

    const reused = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: target.refreshToken,
      device: webDevice,
    });
    expect(reused.status).toBe(401);

    const logged = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    let delivery;
    try {
      delivery = await processNextEmail(
        {
          async send() {
            const err = new Error("535 auth failed password=smtp-secret-value");
            err.code = "password=smtp-secret-value";
            throw err;
          },
        },
        new Date(),
      );
    } finally {
      spy.mockRestore();
    }

    expect(delivery.claimed).toBe(true);
    expect(delivery.status).toBe("pending");
    expect(logged.join(" ")).not.toContain("smtp-secret-value");
    expect(logged.join(" ")).not.toContain(temporaryPassword);

    const retried = await EmailQueue.findById(job._id).lean();
    expect(retried.status).toBe("pending");
    expect(retried.attempts).toBe(1);
    expect(retried.lastError).toBe("Email send failed (SEND_FAILED)");
    expect(retried.lastError).not.toContain(temporaryPassword);
    expect(retried.text).toContain(temporaryPassword);

    const oldLogin = await login(target.email, target.password);
    expect(oldLogin.status).toBe(401);
    const next = await login(target.email, temporaryPassword);
    expect(next.status).toBe(200);
    expect(next.body.user.mustChangePassword).toBe(true);
  });

  it("drops the reset password from the queue, audit rows, and logs after send", async () => {
    const admin = await sessionFor("aa_admin", { email: "scrub-admin@aa.example" });
    const target = await sessionFor("assessor", { email: "scrub-assessor@aa.example" });
    const logged = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });

    try {
      const res = await request(app)
        .post(`/api/v1/users/${target.userId}/password-reset`)
        .set(bearer(admin.token))
        .send({ sendEmail: true });
      expect(res.status).toBe(202);

      const queued = await EmailQueue.findOne({ kind: "password_reset" }).lean();
      const temporaryPassword = temporaryPasswordFrom(queued.text);
      expect(JSON.stringify(res.body)).not.toContain(temporaryPassword);

      const delivery = await processNextEmail(
        {
          async send(message) {
            expect(message.text).toContain(temporaryPassword);
          },
        },
        new Date(),
      );
      expect(delivery.status).toBe("sent");

      const job = await EmailQueue.findById(queued._id).lean();
      expect(job.status).toBe("sent");
      expect(job.attempts).toBe(1);
      expect(job.kind).toBe("password_reset");
      expect(job.subject).toBe("Your assessment portal password was reset");
      expect(job.text).toBeUndefined();
      expect(JSON.stringify(job)).not.toContain(temporaryPassword);

      const audit = await AuditLog.find().lean();
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
      expect(logged.join("\n")).not.toContain(temporaryPassword);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("keeps the reset response successful when the queue insert fails", async () => {
    const admin = await sessionFor("aa_admin");
    const target = await sessionFor("tp", { email: "tp-1@aa.example" });
    const before = await User.findById(target.userId).select("+passwordHash").lean();
    const originalCreate = EmailQueue.create;
    const logged = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });
    EmailQueue.create = async () => {
      const err = new Error("queue down password=queue-secret-leak");
      err.code = "queue-secret-leak";
      throw err;
    };

    try {
      const res = await request(app)
        .post(`/api/v1/users/${target.userId}/password-reset`)
        .set(bearer(admin.token))
        .send({ sendEmail: true });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ emailQueued: false });
      expectNoSecrets(res.body, ["queue-secret-leak", target.password]);
      expect(logged.join(" ")).not.toContain("queue-secret-leak");

      const audit = await AuditLog.find({ action: "user.password_reset" }).lean();
      expect(audit[0].meta.emailQueued).toBe(false);
      expectNoSecrets(audit, ["queue-secret-leak", target.password]);
    } finally {
      EmailQueue.create = originalCreate;
      spy.mockRestore();
    }

    const after = await User.findById(target.userId).select("+passwordHash").lean();
    expect(after.mustChangePassword).toBe(true);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    const queued = await EmailQueue.countDocuments();
    expect(queued).toBe(0);
    const oldLogin = await login(target.email, target.password);
    expect(oldLogin.status).toBe(401);
  });

  it("rate limits password reset without applying the new password", async () => {
    const admin = await sessionFor("aa_admin");
    const target = await sessionFor("sme", { email: "sme-1@aa.example" });
    for (let i = 0; i < compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expect(consumePasswordResetAttempt(admin.userId).allowed).toBe(true);
    }

    const blocked = await request(app)
      .post(`/api/v1/users/${target.userId}/password-reset`)
      .set(bearer(admin.token))
      .send({ newPassword: "Reset-Pass-9" });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many password reset attempts" },
    });
    expectNoSecrets(blocked.body, ["Reset-Pass-9"]);

    const audit = await AuditLog.find({ action: "user.password_reset_rate_limited" }).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0].meta.requestBody.newPassword).toBe("***");
    expectNoSecrets(audit, ["Reset-Pass-9"]);

    const still = await login(target.email, target.password);
    expect(still.status).toBe(200);

    const start = 1_700_000_000_000;
    resetPasswordResetRateLimit();
    for (let i = 0; i < compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expect(consumePasswordResetAttempt("actor-a", start).allowed).toBe(true);
    }
    expect(consumePasswordResetAttempt("actor-a", start + 1).allowed).toBe(false);
    expect(
      consumePasswordResetAttempt("actor-a", start + compliance.LOGIN_RATE_LIMIT_WINDOW_MS).allowed,
    ).toBe(true);
    expect(consumePasswordResetAttempt("actor-b", start + 1).allowed).toBe(true);
  });

  it("rejects a password reset body that is neither or both modes", async () => {
    const admin = await sessionFor("aa_admin");
    const target = await sessionFor("candidate", { email: "learner2@example.com" });
    const neither = await request(app)
      .post(`/api/v1/users/${target.userId}/password-reset`)
      .set(bearer(admin.token))
      .send({});
    expect(neither.status).toBe(400);
    expect(neither.body.error.code).toBe("VALIDATION_ERROR");

    const both = await request(app)
      .post(`/api/v1/users/${target.userId}/password-reset`)
      .set(bearer(admin.token))
      .send({ newPassword: "Reset-Pass-9", sendEmail: true });
    expect(both.status).toBe(400);
    expectNoSecrets(both.body, ["Reset-Pass-9"]);
  });
});
