import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { recordAudit } from "../src/middleware/audit.middleware.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AUDIT_PAGE_SIZE } from "../src/modules/audit/audit.service.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const password = "Correct-Horse-9";

async function tokenFor(email) {
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

describe("audit logs", () => {
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

  it("redacts passwords, reset tokens, and refresh token hashes", async () => {
    const { user } = await createUser({ email: "admin@aa.example", password });
    const doc = await recordAudit({
      actorId: user._id,
      actorRole: "aa_admin",
      action: "user.update",
      entity: "user",
      entityId: user._id.toString(),
      before: {
        passwordHash: "$2a$10$should-not-leak",
        passwordResetTokenHash: "reset-hash",
        tokenHash: "refresh-hash",
        name: "Before",
      },
      after: {
        password: password,
        refreshToken: "rt_secret",
        passwordResetToken: "reset-plain",
        name: "After",
      },
    });

    const stored = await AuditLog.findById(doc._id).lean();
    expect(stored.before.passwordHash).toBe("***");
    expect(stored.before.passwordResetTokenHash).toBe("***");
    expect(stored.before.tokenHash).toBe("***");
    expect(stored.before.name).toBe("Before");
    expect(stored.after.password).toBe("***");
    expect(stored.after.refreshToken).toBe("***");
    expect(stored.after.passwordResetToken).toBe("***");
    expect(JSON.stringify(stored)).not.toContain(password);
    expect(JSON.stringify(stored)).not.toContain("rt_secret");
    expect(JSON.stringify(stored)).not.toContain("$2a$10$should-not-leak");
  });

  it("redacts the login request body written by audit middleware", async () => {
    await createUser({ email: "admin@aa.example", password });
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "admin@aa.example",
      password,
      device: webDevice,
    });
    expect(res.status).toBe(200);

    const logs = await AuditLog.find({ action: "auth.login" }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].meta.requestBody.password).toBe("***");
    expect(JSON.stringify(logs[0])).not.toContain(password);
    expect(JSON.stringify(logs[0])).not.toContain(res.body.refreshToken);
  });

  it("keeps auditLogs append-only", async () => {
    const doc = await recordAudit({
      action: "auth.login",
      entity: "user",
      entityId: "abc",
    });
    await expect(AuditLog.updateOne({ _id: doc._id }, { action: "tamper" })).rejects.toThrow(
      /append-only/,
    );
    await expect(AuditLog.deleteOne({ _id: doc._id })).rejects.toThrow(/append-only/);
    const saved = await AuditLog.findById(doc._id);
    saved.action = "tamper";
    await expect(saved.save()).rejects.toThrow(/append-only/);
  });

  it("scopes GET /audit-logs by role", async () => {
    const abId = new mongoose.Types.ObjectId();
    const otherAbId = new mongoose.Types.ObjectId();
    await createUser({ email: "admin@aa.example", role: "aa_admin", password });
    await createUser({ email: "mis@aa.example", role: "mis", name: "MIS", password });
    await createUser({
      email: "ab@aa.example",
      role: "ab_reviewer",
      name: "AB",
      password,
      abId,
    });
    await createUser({
      email: "ncvet@aa.example",
      role: "ncvet_viewer",
      name: "NCVET",
      password,
    });
    await createUser({ email: "sme@aa.example", role: "sme", name: "SME", password });

    const batchId = new mongoose.Types.ObjectId();
    await mongoose.connection.collection("batches").insertOne({
      _id: batchId,
      abId,
      status: "allocated",
    });

    await recordAudit({
      action: "note",
      entity: "user",
      entityId: "own-ab",
      abId,
    });
    await recordAudit({
      action: "note",
      entity: "user",
      entityId: "other-ab",
      abId: otherAbId,
    });
    await recordAudit({
      action: "batch.update",
      entity: "batch",
      entityId: batchId.toString(),
    });
    await recordAudit({
      action: "result.draft",
      entity: "result",
      entityId: "row-1",
      batchId,
    });
    await recordAudit({
      action: "auth.login",
      entity: "user",
      entityId: "no-scope",
    });

    const adminToken = await tokenFor("admin@aa.example");
    const misToken = await tokenFor("mis@aa.example");
    const abToken = await tokenFor("ab@aa.example");
    const ncvetToken = await tokenFor("ncvet@aa.example");
    const smeToken = await tokenFor("sme@aa.example");

    const admin = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`);
    const mis = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${misToken}`);
    const reviewer = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${abToken}`);
    const ncvet = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${ncvetToken}`);
    const sme = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${smeToken}`);

    expect(admin.status).toBe(200);
    expect(mis.status).toBe(200);
    expect(ncvet.status).toBe(200);
    expect(sme.status).toBe(403);
    expect(sme.body.error.code).toBe("FORBIDDEN");

    const adminIds = admin.body.items.map((item) => item.entityId).sort();
    expect(admin.body.total).toBe(mis.body.total);
    expect(ncvet.body.total).toBe(admin.body.total);
    expect(adminIds).toEqual(
      expect.arrayContaining(["own-ab", "other-ab", batchId.toString(), "row-1", "no-scope"]),
    );

    const reviewerIds = reviewer.body.items.map((item) => item.entityId).sort();
    expect(reviewerIds).toEqual(["own-ab", batchId.toString(), "row-1"].sort());
    expect(JSON.stringify(reviewer.body)).not.toContain("$2a$");
  });

  it("redacts secrets again when reading a stored row", async () => {
    await createUser({ email: "admin@aa.example", role: "aa_admin", password });
    await AuditLog.collection.insertOne({
      action: "legacy",
      entity: "user",
      entityId: "legacy",
      before: { passwordHash: "stored-hash", name: "A" },
      after: { passwordResetTokenHash: "stored-reset" },
      meta: { tokenHash: "stored-refresh" },
      createdAt: new Date(),
    });

    const res = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${await tokenFor("admin@aa.example")}`);

    expect(res.status).toBe(200);
    const row = res.body.items.find((item) => item.entityId === "legacy");
    expect(row.before).toEqual({ passwordHash: "***", name: "A" });
    expect(row.after.passwordResetTokenHash).toBe("***");
    expect(row.meta.tokenHash).toBe("***");
  });

  it("paginates and filters audit logs", async () => {
    await createUser({ email: "admin@aa.example", password });
    const base = Date.parse("2026-10-01T00:00:00.000Z");
    const batchRows = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_unused, index) => ({
      action: index === 0 ? "older" : "note",
      entity: "batch",
      entityId: `batch-${index}`,
      createdAt: new Date(base + index * 60_000),
    }));
    await AuditLog.collection.insertMany([
      ...batchRows,
      {
        action: "user.note",
        entity: "user",
        entityId: "user-1",
        createdAt: new Date(base + 24 * 60 * 60 * 1000),
      },
    ]);

    const token = await tokenFor("admin@aa.example");
    const page2 = await request(app)
      .get("/api/v1/audit-logs")
      .query({ page: 2, entity: "batch" })
      .set("Authorization", `Bearer ${token}`);

    expect(page2.status).toBe(200);
    expect(page2.body.page).toBe(2);
    expect(page2.body.pageSize).toBe(AUDIT_PAGE_SIZE);
    expect(page2.body.total).toBe(AUDIT_PAGE_SIZE + 1);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].action).toBe("older");

    const ranged = await request(app)
      .get("/api/v1/audit-logs")
      .query({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" })
      .set("Authorization", `Bearer ${token}`);
    expect(ranged.status).toBe(200);
    expect(ranged.body.total).toBe(1);
    expect(ranged.body.items[0].action).toBe("older");
  });
});
