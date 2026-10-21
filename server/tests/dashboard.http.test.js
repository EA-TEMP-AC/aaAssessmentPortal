import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { Batch } from "../src/models/batch.model.js";
import { Centre } from "../src/models/centre.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { LoginEvent } from "../src/models/login-event.model.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
import { addDaysIso } from "../src/modules/dashboard/dates.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const today = () => istCalendarDate(new Date());

async function sessionFor(role) {
  const email = `${role}-${oid()}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: user?._id };
}

async function makeBatch(over = {}) {
  return Batch.create({
    abId: oid(),
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: today(),
    assessmentEndDate: today(),
    tpId: oid(),
    centreId: oid(),
    candidateCount: 3,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "en",
    state: "Maharashtra",
    status: "assessor_assigned",
    statusVersion: 2,
    assessorId: oid(),
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...over,
  });
}

describe("addDaysIso", () => {
  it("adds days across a month end", () => {
    expect(addDaysIso("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("dashboard, batch mails and login history (X-49)", () => {
  beforeAll(async () => {
    await startMongo();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    resetLoginRateLimit();
    await clearCollections();
  });

  it("counts today's batches and lists the next seven days", async () => {
    await makeBatch();
    await makeBatch({
      assessmentStartDate: addDaysIso(today(), 3),
      assessmentEndDate: addDaysIso(today(), 3),
    });
    await makeBatch({ sector: "Retail" });
    const { token } = await sessionFor("aa_admin");
    const res = await request(app).get("/api/v1/dashboard?sector=Electronics").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.batchesScheduled).toBe(1);
    expect(res.body.assessorsScheduled).toBe(1);
    expect(res.body.nextSevenDays).toHaveLength(1);
  });

  it("refuses other roles and unknown query keys", async () => {
    const assessor = await sessionFor("assessor");
    expect((await request(app).get("/api/v1/dashboard").set(bearer(assessor.token))).status).toBe(
      403,
    );
    const admin = await sessionFor("aa_admin");
    expect((await request(app).get("/api/v1/dashboard?x=1").set(bearer(admin.token))).status).toBe(
      400,
    );
  });

  it("lists only future batches for mail and skips past dates on send", async () => {
    const past = await makeBatch({
      assessmentStartDate: addDaysIso(today(), -2),
      assessmentEndDate: addDaysIso(today(), -2),
    });
    const tp = await TrainingPartner.create({ name: "TP One", email: "tp@example.com" });
    const next = await makeBatch({
      assessmentStartDate: addDaysIso(today(), 2),
      assessmentEndDate: addDaysIso(today(), 2),
      tpId: tp._id,
    });
    const { token } = await sessionFor("aa_admin");
    const list = await request(app).get("/api/v1/batch-mails/batches").set(bearer(token));
    expect(list.body.items.map((i) => i.id)).toEqual([String(next._id)]);
    const sent = await request(app)
      .post("/api/v1/batch-mails/send")
      .set(bearer(token))
      .send({ batchIds: [String(past._id), String(next._id)], recipients: ["training_partner"] });
    expect(sent.status).toBe(200);
    expect(sent.body.queued).toBe(1);
    expect(sent.body.skipped).toEqual([{ batchId: String(past._id), reason: "past_date" }]);
    expect(await EmailQueue.countDocuments({ kind: "batch_notice" })).toBe(1);
  });

  it("sends the centre notice to the centre's own email and skips a centre without one", async () => {
    const tpId = oid();
    const withMail = await Centre.create({
      name: "C1",
      tpId,
      state: "Maharashtra",
      email: "c1@example.com",
    });
    const noMail = await Centre.create({ name: "C2", tpId, state: "Maharashtra" });
    const day = addDaysIso(today(), 2);
    const a = await makeBatch({
      assessmentStartDate: day,
      assessmentEndDate: day,
      centreId: withMail._id,
    });
    const b = await makeBatch({
      assessmentStartDate: day,
      assessmentEndDate: day,
      centreId: noMail._id,
    });
    const { token } = await sessionFor("aa_admin");
    const sent = await request(app)
      .post("/api/v1/batch-mails/send")
      .set(bearer(token))
      .send({ batchIds: [String(a._id), String(b._id)], recipients: ["centre"] });
    expect(sent.body.queued).toBe(1);
    expect(sent.body.skipped).toEqual([{ batchId: String(b._id), reason: "no_centre_email" }]);
    expect((await EmailQueue.findOne({ kind: "batch_notice" })).to).toEqual(["c1@example.com"]);
  });

  it("returns login events and punch rows without exact places", async () => {
    const batch = await makeBatch();
    const userId = oid();
    const base = {
      actorType: "assessor",
      actorId: oid(),
      userId,
      batchId: batch._id,
      locationStatus: "captured",
      lat: 19.07,
      lng: 72.87,
      missingGpsFix: false,
      noGpsFix: false,
      receivedAt: new Date(),
      clockSkewMs: 0,
      clockSkewFlag: false,
      lateSync: false,
      syncedAt: new Date(),
      payloadHash: "x",
    };
    await LoginEvent.create({ ...base, clientEventId: "a", type: "login", capturedAt: new Date() });
    await LoginEvent.create({
      ...base,
      clientEventId: "b",
      type: "logout",
      capturedAt: new Date(),
    });
    const { token } = await sessionFor("aa_admin");
    const log = await request(app).get("/api/v1/reports/login-history").set(bearer(token));
    expect(log.status).toBe(200);
    expect(log.body.total).toBe(2);
    expect(JSON.stringify(log.body)).not.toContain("72.87");
    const punch = await request(app)
      .get("/api/v1/reports/login-history?view=punch")
      .set(bearer(token));
    expect(punch.body.items).toHaveLength(1);
    expect(punch.body.items[0].events).toBe(2);
  });
});
