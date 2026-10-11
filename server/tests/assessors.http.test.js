import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Assessor } from "../src/models/assessor.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}) {
  const email = extra.email ?? `${role}@aa.example`;
  const { password } = await createUser({
    role,
    email,
    name: extra.name ?? role,
    linkedProfileId: extra.linkedProfileId,
  });
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const assessorBody = {
  name: "Ravi Assessor",
  code: "ASR-01",
  email: "ravi@aa.example",
  qualifications: ["Electrician L4"],
  yearsOfExperience: 5,
  languages: ["Hindi", "English"],
  toa: { certNo: "TOA-1", issuedOn: "2024-01-01", expiresOn: "2027-01-01" },
  otherAaCount: 1,
  undertaking: true,
};

const proctorBody = {
  name: "Priya Proctor",
  code: "PRC-01",
  email: "priya@aa.example",
  qualifications: ["Proctor L1"],
  languages: ["Hindi"],
};

describe("assessor and proctor registry", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([Assessor.syncIndexes(), Proctor.syncIndexes(), AuditLog.syncIndexes()]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("creates, lists, updates, and deactivates an assessor with audit rows", async () => {
    const admin = await sessionFor("aa_admin");
    const created = await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send(assessorBody);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      name: assessorBody.name,
      code: "ASR-01",
      languages: ["Hindi", "English"],
      toa: assessorBody.toa,
      otherAaCount: 1,
      undertaking: true,
    });
    expect(created.body).not.toHaveProperty("aadhaar");
    expect(created.body).not.toHaveProperty("passwordHash");

    const listed = await request(app).get("/api/v1/assessors").set(bearer(admin.token));
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].id).toBe(created.body.id);

    const patched = await request(app)
      .patch(`/api/v1/assessors/${created.body.id}`)
      .set(bearer(admin.token))
      .send({ languages: ["Hindi", "Marathi"] });
    expect(patched.status).toBe(200);
    expect(patched.body.languages).toEqual(["Hindi", "Marathi"]);

    const deactivated = await request(app)
      .delete(`/api/v1/assessors/${created.body.id}`)
      .set(bearer(admin.token));
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const audits = await AuditLog.find({ entity: "assessor" }).sort({ createdAt: 1 }).lean();
    expect(audits.map((row) => row.action)).toEqual([
      "assessor.create",
      "assessor.update",
      "assessor.deactivate",
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/passwordHash|aadhaar/i);
  });

  it("rejects national-id fields and duplicate codes", async () => {
    const admin = await sessionFor("aa_admin");
    const banned = await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send({ name: "X", aadhaar: "123412341234" });
    expectError(banned, 400, "VALIDATION_ERROR");
    expect(await Assessor.countDocuments()).toBe(0);

    const first = await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send(assessorBody);
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send({ ...assessorBody, email: "other@aa.example" });
    expectError(dup, 409, "DUPLICATE_RESOURCE");
  });

  it("lets an assessor read only their own record", async () => {
    const admin = await sessionFor("aa_admin");
    const mine = await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send(assessorBody);
    const other = await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send({ ...assessorBody, code: "ASR-02", email: "other.asr@aa.example", name: "Other" });
    const assessor = await sessionFor("assessor", { linkedProfileId: mine.body.id });
    const list = await request(app).get("/api/v1/assessors").set(bearer(assessor.token));
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(mine.body.id);
    const own = await request(app)
      .get(`/api/v1/assessors/${mine.body.id}`)
      .set(bearer(assessor.token));
    expect(own.status).toBe(200);
    const denied = await request(app)
      .get(`/api/v1/assessors/${other.body.id}`)
      .set(bearer(assessor.token));
    expectError(denied, 403, "FORBIDDEN");
    const write = await request(app)
      .patch(`/api/v1/assessors/${mine.body.id}`)
      .set(bearer(assessor.token))
      .send({ name: "Nope" });
    expectError(write, 403, "FORBIDDEN");
  });

  it("denies sme and candidate, and lets mis write proctors", async () => {
    const mis = await sessionFor("mis");
    const sme = await sessionFor("sme");
    const candidate = await sessionFor("candidate");
    const created = await request(app)
      .post("/api/v1/proctors")
      .set(bearer(mis.token))
      .send(proctorBody);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.qualifications).toEqual(["Proctor L1"]);
    expect(created.body).not.toHaveProperty("toa");
    expect(created.body).not.toHaveProperty("aadhaar");

    const smeGet = await request(app).get("/api/v1/proctors").set(bearer(sme.token));
    expectError(smeGet, 403, "FORBIDDEN");
    const candidateGet = await request(app).get("/api/v1/assessors").set(bearer(candidate.token));
    expectError(candidateGet, 403, "FORBIDDEN");

    const proctor = await sessionFor("proctor", { linkedProfileId: created.body.id });
    const own = await request(app)
      .get(`/api/v1/proctors/${created.body.id}`)
      .set(bearer(proctor.token));
    expect(own.status).toBe(200);

    for (const role of USER_ROLES.filter((item) => !["aa_admin", "mis"].includes(item))) {
      const session = await sessionFor(role, {
        email: `${role}-write@aa.example`,
        linkedProfileId: role === "proctor" ? created.body.id : undefined,
      });
      const res = await request(app)
        .post("/api/v1/proctors")
        .set(bearer(session.token))
        .send({ name: "Nope" });
      expectError(res, 403, "FORBIDDEN");
    }

    const audits = await AuditLog.find({ entity: "proctor" }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("proctor.create");
  });

  it("lists available assessors by language and ToA window", async () => {
    const admin = await sessionFor("aa_admin");
    await request(app).post("/api/v1/assessors").set(bearer(admin.token)).send(assessorBody);
    await request(app)
      .post("/api/v1/assessors")
      .set(bearer(admin.token))
      .send({
        ...assessorBody,
        code: "ASR-TA",
        email: "tamil@aa.example",
        languages: ["Tamil"],
        toa: { certNo: "TOA-2", issuedOn: "2020-01-01", expiresOn: "2021-01-01" },
      });
    const available = await request(app)
      .get("/api/v1/assessors/available")
      .query({ from: "2026-11-20", to: "2026-11-21", languages: "Hindi" })
      .set(bearer(admin.token));
    expect(available.status).toBe(200);
    expect(available.body.items).toHaveLength(1);
    expect(available.body.items[0].code).toBe("ASR-01");
  });
});
