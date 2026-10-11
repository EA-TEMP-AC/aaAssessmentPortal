import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import {
  RECOGNITION_READ_ROLES,
  RECOGNITION_WRITE_ROLES,
  USER_ROLES,
} from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const body = {
  sectors: ["Electronics", "Construction"],
  panIndia: false,
  states: ["Maharashtra", "Gujarat"],
  startDate: "2026-04-01",
  endDate: "2029-03-31",
};

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, email = `${role}@recog.example`) {
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

describe("admin recognition", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([AaRecognition.syncIndexes(), AuditLog.syncIndexes(), Batch.syncIndexes()]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("is 404 until the first write, then replaces the singleton without touching batches", async () => {
    const admin = await sessionFor("aa_admin");
    const auth = bearer(admin.token);
    const missing = await request(app).get("/api/v1/admin/recognition").set(auth);
    expectError(missing, 404, "NOT_FOUND");

    const created = await request(app).put("/api/v1/admin/recognition").set(auth).send(body);
    expect(created.status).toBe(200);
    expect(Object.keys(created.body).sort()).toEqual(
      ["endDate", "id", "panIndia", "sectors", "startDate", "states"].sort(),
    );
    expect(created.body).toMatchObject(body);

    const batchId = new mongoose.Types.ObjectId();
    await Batch.create({
      _id: batchId,
      abId: new mongoose.Types.ObjectId(),
      qualificationId: new mongoose.Types.ObjectId(),
      type: "STT",
      mode: "offline",
      assessmentStartDate: "2026-11-20",
      assessmentEndDate: "2026-11-21",
      tpId: new mongoose.Types.ObjectId(),
      centreId: new mongoose.Types.ObjectId(),
      candidateCount: 10,
      sector: "Electronics",
      ratioClass: "manufacturing",
      assessmentLanguage: "Hindi",
      state: "Maharashtra",
      status: "allocated",
      statusVersion: 1,
      isReassessment: false,
      firstAssessmentBatchId: batchId,
      allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
      sla: {
        acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
        assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
        resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
        breached: [],
      },
    });

    const replaced = await request(app)
      .put("/api/v1/admin/recognition")
      .set(auth)
      .send({ ...body, sectors: ["Food"], panIndia: true, states: [] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.id).toBe(created.body.id);
    expect(replaced.body.sectors).toEqual(["Food"]);
    expect(replaced.body.panIndia).toBe(true);
    expect(replaced.body.states).toEqual([]);
    expect(await AaRecognition.countDocuments()).toBe(1);

    const batch = await Batch.findById(batchId).lean();
    expect(batch.sector).toBe("Electronics");
    expect(batch.state).toBe("Maharashtra");

    const audit = await AuditLog.find({ action: "aaRecognition.update" })
      .sort({ createdAt: 1 })
      .lean();
    expect(audit).toHaveLength(2);
    expect(audit[1].before.sectors).toEqual(["Electronics", "Construction"]);
    expect(audit[1].after.sectors).toEqual(["Food"]);
    expect(audit[1].actorRole).toBe("aa_admin");
  });

  it("lets writers replace the row and lets ncvet_viewer read it", async () => {
    const mis = await sessionFor("mis");
    const saved = await request(app)
      .put("/api/v1/admin/recognition")
      .set(bearer(mis.token))
      .send(body);
    expect(saved.status).toBe(200);

    for (const role of USER_ROLES) {
      const session = await sessionFor(role, `${role}-loop@recog.example`);
      const read = await request(app).get("/api/v1/admin/recognition").set(bearer(session.token));
      const write = await request(app)
        .put("/api/v1/admin/recognition")
        .set(bearer(session.token))
        .send(body);
      if (RECOGNITION_READ_ROLES.includes(role)) {
        expect(read.status, role).toBe(200);
        expect(read.body.sectors).toEqual(body.sectors);
      } else {
        expectError(read, 403, "FORBIDDEN");
      }
      if (RECOGNITION_WRITE_ROLES.includes(role)) {
        expect(write.status, role).toBe(200);
      } else {
        expectError(write, 403, "FORBIDDEN");
      }
    }

    const anon = await request(app).get("/api/v1/admin/recognition");
    expectError(anon, 401, "UNAUTHORIZED");
  });

  it("rejects a sector that is a ratio class, a non-empty PAN India list, and a reversed date range", async () => {
    const admin = await sessionFor("aa_admin");
    const auth = bearer(admin.token);

    const ratio = await request(app)
      .put("/api/v1/admin/recognition")
      .set(auth)
      .send({ ...body, sectors: ["manufacturing"] });
    expectError(ratio, 400, "VALIDATION_ERROR");

    const pan = await request(app)
      .put("/api/v1/admin/recognition")
      .set(auth)
      .send({ ...body, panIndia: true });
    expectError(pan, 400, "VALIDATION_ERROR");

    const emptyStates = await request(app)
      .put("/api/v1/admin/recognition")
      .set(auth)
      .send({ ...body, states: [] });
    expectError(emptyStates, 400, "VALIDATION_ERROR");

    const duplicate = await request(app)
      .put("/api/v1/admin/recognition")
      .set(auth)
      .send({ ...body, sectors: ["Electronics", "Electronics"] });
    expectError(duplicate, 400, "VALIDATION_ERROR");

    const dates = await request(app)
      .put("/api/v1/admin/recognition")
      .set(auth)
      .send({ ...body, startDate: "2029-04-01", endDate: "2026-04-01" });
    expectError(dates, 400, "VALIDATION_ERROR");
    expect(await AaRecognition.countDocuments()).toBe(0);
  });
});
