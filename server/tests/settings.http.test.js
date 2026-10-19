import request from "supertest";
import { createApp } from "../src/app.js";
import { AccessSettings } from "../src/models/access-settings.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const READERS = ["aa_admin", "mis", "ncvet_viewer", "ab_reviewer"];

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const get = (token) => request(app).get("/api/v1/settings/access").set(bearer(token));
const put = (token, body) =>
  request(app).put("/api/v1/settings/access").set(bearer(token)).send(body);

async function sessionFor(role) {
  const email = `${role}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

describe("GET and PUT /settings/access", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([AccessSettings.syncIndexes(), AuditLog.syncIndexes()]);
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("reads both flags as false before anything is saved", async () => {
    const admin = await sessionFor("aa_admin");
    const res = await get(admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      abReviewerCanReadAssessorPayments: false,
      ncvetViewerCanSeeAbQueue: false,
      aadhaarVisibility: "masked",
      updatedBy: null,
      updatedAt: null,
    });
    expect(await AccessSettings.countDocuments()).toBe(0);
  });

  it("lets aa_admin set one flag, keeps the other, and keeps a single document", async () => {
    const admin = await sessionFor("aa_admin");
    const first = await put(admin.token, { ncvetViewerCanSeeAbQueue: true });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      abReviewerCanReadAssessorPayments: false,
      ncvetViewerCanSeeAbQueue: true,
      updatedBy: admin.userId,
    });
    const second = await put(admin.token, { abReviewerCanReadAssessorPayments: true });
    expect(second.body).toMatchObject({
      abReviewerCanReadAssessorPayments: true,
      ncvetViewerCanSeeAbQueue: true,
    });
    expect(await AccessSettings.countDocuments()).toBe(1);
    expect((await get(admin.token)).body).toMatchObject(second.body);
  });

  it("lets aa_admin choose who sees the Aadhaar number, and rejects other values", async () => {
    const admin = await sessionFor("aa_admin");
    const full = await put(admin.token, { aadhaarVisibility: "full" });
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    expect(full.body.aadhaarVisibility).toBe("full");
    const bad = await put(admin.token, { aadhaarVisibility: "everyone" });
    expect(bad.status).toBe(400);
  });

  it("audits each change with before and after", async () => {
    const admin = await sessionFor("aa_admin");
    await put(admin.token, { ncvetViewerCanSeeAbQueue: true });
    await put(admin.token, { ncvetViewerCanSeeAbQueue: false });
    const rows = await AuditLog.find({ action: "settings.access.update" }).sort({ _id: 1 }).lean();
    expect(rows).toHaveLength(2);
    expect(rows[0].before).toMatchObject({ ncvetViewerCanSeeAbQueue: false });
    expect(rows[0].after).toMatchObject({ ncvetViewerCanSeeAbQueue: true });
    expect(rows[1].before).toMatchObject({ ncvetViewerCanSeeAbQueue: true });
    expect(rows[1].after).toMatchObject({ ncvetViewerCanSeeAbQueue: false });
    expect(rows[0]).toMatchObject({
      entity: "settings",
      entityId: "access",
      actorRole: "aa_admin",
    });
  });

  it("rejects an empty body, unknown keys and non-boolean values", async () => {
    const admin = await sessionFor("aa_admin");
    for (const body of [{}, { other: true }, { ncvetViewerCanSeeAbQueue: "yes" }]) {
      const res = await put(admin.token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await AuditLog.countDocuments({ action: "settings.access.update" })).toBe(0);
  });

  it("lets aa_admin, mis, ncvet_viewer and ab_reviewer read; everyone else gets 403", async () => {
    for (const role of USER_ROLES) {
      const s = await sessionFor(role);
      const res = await get(s.token);
      expect(res.status, role).toBe(READERS.includes(role) ? 200 : 403);
    }
    expect((await request(app).get("/api/v1/settings/access")).status).toBe(401);
  });

  it("lets only aa_admin write", async () => {
    for (const role of USER_ROLES.filter((r) => r !== "aa_admin")) {
      const s = await sessionFor(role);
      const res = await put(s.token, { ncvetViewerCanSeeAbQueue: true });
      expect(res.status, role).toBe(403);
    }
    expect(await AccessSettings.countDocuments()).toBe(0);
    expect(
      (await request(app).put("/api/v1/settings/access").send({ ncvetViewerCanSeeAbQueue: true }))
        .status,
    ).toBe(401);
  });
});
