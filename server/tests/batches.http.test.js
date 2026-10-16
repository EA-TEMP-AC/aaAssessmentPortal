import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { assignDueAt } from "../src/lib/working-days.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Holiday } from "../src/models/holiday.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
import { User } from "../src/models/user.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { BATCH_STATUSES, BATCH_TRANSITIONS } from "../src/modules/batches/batch-transitions.js";
import { createBatch, transitionBatch } from "../src/modules/batches/batch.service.js";
import { markOverdueSlaBreaches } from "../src/modules/batches/sla-breach-job.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const MOUNTED = ["accept", "reject", "cancel", "complete"];
/** B-05 mounts submit-result, validate, and publish. Disputes are deferred. */
const NOT_MOUNTED = ["dispute", "resolve-dispute"];

const batchKeys = [
  "abId",
  "acceptedAt",
  "accommodations",
  "allocatedAt",
  "assessmentEndDate",
  "assessmentLanguage",
  "assessmentStartDate",
  "assessorId",
  "cancelReason",
  "cancelledAt",
  "candidateCount",
  "centreId",
  "createdAt",
  "firstAssessmentBatchId",
  "id",
  "isReassessment",
  "learnerFeedback",
  "mode",
  "projectId",
  "proctorId",
  "qualificationId",
  "ratioClass",
  "ratioOverride",
  "schemeId",
  "recognitionOverride",
  "reassessmentOf",
  "rejectReason",
  "resultId",
  "sector",
  "sla",
  "state",
  "status",
  "statusVersion",
  "testPaperId",
  "tpId",
  "type",
  "updatedAt",
  "assignedAt",
].sort();

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
    abId: extra.abId,
    tpId: extra.tpId,
    linkedProfileId: extra.linkedProfileId,
  });
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id, email };
}

async function masters() {
  const ab = await AwardingBody.create({
    name: "AB One",
    code: "AB-01",
    notificationEmails: ["one@ab.example"],
    active: true,
  });
  const otherAb = await AwardingBody.create({
    name: "AB Two",
    code: "AB-02",
    notificationEmails: ["two@ab.example"],
    active: true,
  });
  const tp = await TrainingPartner.create({ name: "TP One", code: "TP-01", active: true });
  const otherTp = await TrainingPartner.create({ name: "TP Two", code: "TP-02", active: true });
  const centre = await Centre.create({
    name: "Centre One",
    code: "C-01",
    tpId: tp._id,
    state: "Maharashtra",
    active: true,
  });
  const otherCentre = await Centre.create({
    name: "Centre Two",
    code: "C-02",
    tpId: otherTp._id,
    state: "Maharashtra",
    active: true,
  });
  const qualification = await Qualification.create({
    code: "Q-ELEC-L4",
    name: "Electrician L4",
    sector: "Electronics",
    ratioClass: "manufacturing",
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    nos: [
      {
        nosId: "NOS-01",
        code: "N01",
        name: "Safety",
        pcs: [{ pcId: "PC-01", code: "P1", name: "PPE" }],
      },
    ],
  });
  await AaRecognition.create({
    sectors: ["Electronics"],
    panIndia: false,
    states: ["Maharashtra"],
    startDate: "2020-01-01",
    endDate: "2099-12-31",
  });
  return { ab, otherAb, tp, otherTp, centre, otherCentre, qualification };
}

function batchBody(m, overrides = {}) {
  return {
    abId: String(m.ab._id),
    qualificationId: String(m.qualification._id),
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2099-06-15",
    assessmentEndDate: "2099-06-16",
    tpId: String(m.tp._id),
    centreId: String(m.centre._id),
    candidateCount: 24,
    assessmentLanguage: "Hindi",
    ...overrides,
  };
}

async function createOne(token, m, overrides) {
  const res = await request(app)
    .post("/api/v1/batches")
    .set(bearer(token))
    .send(batchBody(m, overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe("batches", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Batch.syncIndexes(),
      AuditLog.syncIndexes(),
      AwardingBody.syncIndexes(),
      TrainingPartner.syncIndexes(),
      Centre.syncIndexes(),
      Qualification.syncIndexes(),
      Holiday.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("creates the batch indexes from SCHEMA §3.8", async () => {
    const indexes = await Batch.collection.indexes();
    expect(indexes.map((index) => index.key)).toEqual(
      expect.arrayContaining([
        { _id: 1 },
        { sector: 1 },
        { status: 1, assessmentStartDate: 1 },
        { assessorId: 1, assessmentStartDate: 1, assessmentEndDate: 1 },
        { tpId: 1 },
        { abId: 1 },
        { reassessmentOf: 1 },
        { firstAssessmentBatchId: 1 },
      ]),
    );
    const reassessment = indexes.find((index) => index.key.reassessmentOf === 1);
    expect(reassessment.sparse).toBe(true);
  });

  it("stores accept, assign, and result due instants from the working-day helpers", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const adminUser = await User.findById(admin.userId);
    const now = new Date("2026-10-08T08:00:00.000Z");
    const example = {
      assessmentStartDate: "2026-11-20",
      assessmentEndDate: "2026-11-21",
    };
    const created = await createBatch(adminUser, batchBody(m, example), { now });
    expect(created.batch.sla.acceptDueAt).toBe("2026-10-12T18:29:59.999Z");
    expect(created.batch.sla.assignDueAt).toBe("2026-10-19T18:29:59.999Z");
    expect(created.batch.sla.resultDueAt).toBe("2026-11-25T18:29:59.999Z");
    expect(created.batch.allocatedAt).toBe(now.toISOString());
    expect(created.batch.sector).toBe("Electronics");
    expect(created.batch.ratioClass).toBe("manufacturing");
    expect(created.batch.assessmentLanguage).toBe("Hindi");
    expect(created.batch.state).toBe("Maharashtra");
    expect(created.batch.learnerFeedback).toBeNull();
    expect(created.batch.recognitionOverride).toBeNull();
    expect(created.batch.firstAssessmentBatchId).toBe(created.batch.id);
    expect(created.stored.sla.breached).toEqual([]);

    const ltt = await createBatch(adminUser, batchBody(m, { ...example, type: "LTT" }), { now });
    const lttAssign = await assignDueAt({ type: "LTT", assessmentStartDate: "2026-11-20" });
    expect(ltt.batch.sla.assignDueAt).toBe(lttAssign.toISOString());
    expect(ltt.batch.sla.assignDueAt).toBe("2026-10-09T18:29:59.999Z");
    expect(ltt.batch.sla.resultDueAt).toBe("2026-11-27T18:29:59.999Z");

    await Holiday.create({
      date: "2026-10-09",
      name: "Bridge",
      region: null,
      createdBy: adminUser._id,
    });
    const shifted = await createBatch(adminUser, batchBody(m, example), { now });
    expect(shifted.batch.sla.acceptDueAt).toBe("2026-10-13T18:29:59.999Z");
    expect(shifted.batch.sla.assignDueAt).toBe("2026-10-20T18:29:59.999Z");
    expect(shifted.batch.sla.resultDueAt).toBe("2026-11-25T18:29:59.999Z");
    const stored = await Batch.findById(created.batch.id).lean();
    expect(stored.sla.acceptDueAt.toISOString()).toBe("2026-10-12T18:29:59.999Z");
    expect(stored.sla.assignDueAt.toISOString()).toBe("2026-10-19T18:29:59.999Z");
  });

  it("creates, lists, and reads a batch for aa_admin", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const missing = await request(app).get("/api/v1/batches");
    expectError(missing, 401, "UNAUTHORIZED");

    const created = await createOne(admin.token, m);
    expect(Object.keys(created).sort()).toEqual(batchKeys);
    expect(created).toMatchObject({
      abId: String(m.ab._id),
      qualificationId: String(m.qualification._id),
      type: "STT",
      mode: "offline",
      assessmentStartDate: "2099-06-15",
      assessmentEndDate: "2099-06-16",
      tpId: String(m.tp._id),
      centreId: String(m.centre._id),
      candidateCount: 24,
      sector: "Electronics",
      ratioClass: "manufacturing",
      assessmentLanguage: "Hindi",
      state: "Maharashtra",
      learnerFeedback: null,
      recognitionOverride: null,
      status: "allocated",
      statusVersion: 1,
      assessorId: null,
      proctorId: null,
      resultId: null,
      testPaperId: null,
      rejectReason: null,
      cancelReason: null,
      isReassessment: false,
      reassessmentOf: null,
      ratioOverride: null,
      accommodations: [],
      acceptedAt: null,
      assignedAt: null,
      cancelledAt: null,
    });
    expect(created.firstAssessmentBatchId).toBe(created.id);
    expect(created.sla.breached).toEqual([]);
    expect(created.sla.lateActions).toEqual([]);
    expect(created.sla.acceptDueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.sla.assignDueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.sla.resultDueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fetched = await request(app)
      .get(`/api/v1/batches/${created.id}`)
      .set(bearer(admin.token));
    expect(fetched.status).toBe(200);
    // X-11: a single batch also carries the names behind its ids (null when no record is found).
    const { names, ...fetchedBatch } = fetched.body;
    expect(fetchedBatch).toEqual(created);
    expect(Object.keys(names).sort()).toEqual([
      "abName",
      "assessorName",
      "centreName",
      "proctorName",
      "qualificationName",
      "tpName",
    ]);

    const listed = await request(app).get("/api/v1/batches").set(bearer(admin.token));
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(listed.body.items).toEqual([created]);

    const audit = await AuditLog.findOne({ action: "batch.create", entityId: created.id }).lean();
    expect(audit).toMatchObject({
      actorRole: "aa_admin",
      entity: "batch",
      after: { status: "allocated", sector: "Electronics" },
    });
    expect(String(audit.batchId)).toBe(created.id);
    expect(String(audit.abId)).toBe(created.abId);
    expect(JSON.stringify(audit)).not.toContain("passwordHash");
  });

  it("rejects invalid bodies and unknown references", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const auth = bearer(admin.token);

    const missing = await request(app).post("/api/v1/batches").set(auth).send({ type: "STT" });
    expectError(missing, 400, "VALIDATION_ERROR");

    const dates = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { assessmentStartDate: "2099-06-16", assessmentEndDate: "2099-06-15" }));
    expectError(dates, 400, "VALIDATION_ERROR");

    const impossible = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { assessmentStartDate: "2099-02-31" }));
    expectError(impossible, 400, "VALIDATION_ERROR");

    const count = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { candidateCount: 0 }));
    expectError(count, 400, "VALIDATION_ERROR");

    const extra = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { sector: "Electronics", ratioClass: "manufacturing" }));
    expectError(extra, 400, "VALIDATION_ERROR");

    const withoutLanguage = batchBody(m);
    delete withoutLanguage.assessmentLanguage;
    const missingLanguage = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(withoutLanguage);
    expectError(missingLanguage, 400, "VALIDATION_ERROR");
    const blankLanguage = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { assessmentLanguage: "   " }));
    expectError(blankLanguage, 400, "VALIDATION_ERROR");

    const mode = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { mode: "hybrid" }));
    expectError(mode, 400, "VALIDATION_ERROR");

    const unknownQualification = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { qualificationId: new mongoose.Types.ObjectId().toString() }));
    expectError(unknownQualification, 400, "VALIDATION_ERROR");
    expect(unknownQualification.body.error.details.qualificationId).toEqual(["Does not exist"]);

    const wrongCentre = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { centreId: String(m.otherCentre._id) }));
    expectError(wrongCentre, 400, "VALIDATION_ERROR");
    expect(wrongCentre.body.error.details.centreId[0]).toMatch(/training partner/);

    const badId = await request(app).get("/api/v1/batches/not-an-id").set(auth);
    expectError(badId, 400, "VALIDATION_ERROR");
    const absent = await request(app)
      .get(`/api/v1/batches/${new mongoose.Types.ObjectId()}`)
      .set(auth);
    expectError(absent, 404, "NOT_FOUND");

    const range = await request(app).get("/api/v1/batches?from=2099-07-01&to=2099-06-01").set(auth);
    expectError(range, 400, "VALIDATION_ERROR");

    const created = await createOne(admin.token, m);
    const acceptExtra = await request(app)
      .post(`/api/v1/batches/${created.id}/accept`)
      .set(auth)
      .send({ reason: "no" });
    expectError(acceptExtra, 400, "VALIDATION_ERROR");

    const reject = await request(app)
      .post(`/api/v1/batches/${created.id}/reject`)
      .set(auth)
      .send({});
    expectError(reject, 400, "VALIDATION_ERROR");

    await Batch.updateOne({ _id: created.id }, { $set: { status: "in_progress" } });
    const complete = await request(app)
      .post(`/api/v1/batches/${created.id}/complete`)
      .set(auth)
      .send({});
    expectError(complete, 400, "VALIDATION_ERROR");
    const blank = await request(app)
      .post(`/api/v1/batches/${created.id}/complete`)
      .set(auth)
      .send({ reason: "   " });
    expectError(blank, 400, "VALIDATION_ERROR");
    const extraLate = await request(app)
      .post(`/api/v1/batches/${created.id}/complete`)
      .set(auth)
      .send({ reason: "done", lateReason: "no" });
    expectError(extraLate, 400, "VALIDATION_ERROR");
    expect((await Batch.findById(created.id).lean()).status).toBe("in_progress");

    await TrainingPartner.updateOne({ _id: m.tp._id }, { active: false });
    const inactive = await createOne(admin.token, m, {
      assessmentStartDate: "2099-08-01",
      assessmentEndDate: "2099-08-02",
    });
    expect(inactive.status).toBe("allocated");
  });

  it("lets an ab_reviewer create only for their awarding body", async () => {
    const m = await masters();
    const reviewer = await sessionFor("ab_reviewer", {
      abId: m.ab._id,
      email: "reviewer@aa.example",
    });
    const own = await createOne(reviewer.token, m);
    expect(own.abId).toBe(String(m.ab._id));
    expect(own.sector).toBe("Electronics");

    const other = await request(app)
      .post("/api/v1/batches")
      .set(bearer(reviewer.token))
      .send(batchBody(m, { abId: String(m.otherAb._id) }));
    expectError(other, 403, "FORBIDDEN");

    const unlinked = await sessionFor("ab_reviewer", { email: "reviewer-none@aa.example" });
    const denied = await request(app)
      .post("/api/v1/batches")
      .set(bearer(unlinked.token))
      .send(batchBody(m));
    expectError(denied, 403, "FORBIDDEN");

    for (const role of USER_ROLES) {
      if (role === "aa_admin" || role === "ab_reviewer") continue;
      const session = await sessionFor(role, { email: `${role}-create@aa.example` });
      const res = await request(app)
        .post("/api/v1/batches")
        .set(bearer(session.token))
        .send(batchBody(m));
      expectError(res, 403, "FORBIDDEN");
    }
  });

  it("scopes list and get by role", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const first = await createOne(admin.token, m);
    const second = await createOne(admin.token, m, {
      abId: String(m.otherAb._id),
      tpId: String(m.otherTp._id),
      centreId: String(m.otherCentre._id),
      assessmentStartDate: "2099-07-01",
      assessmentEndDate: "2099-07-02",
    });
    const assessorId = new mongoose.Types.ObjectId();
    const proctorId = new mongoose.Types.ObjectId();
    await Batch.updateOne({ _id: first.id }, { assessorId });
    await Batch.updateOne({ _id: second.id }, { proctorId });

    const mis = await sessionFor("mis");
    const ncvet = await sessionFor("ncvet_viewer", { email: "ncvet@aa.example" });
    const reviewer = await sessionFor("ab_reviewer", { abId: m.ab._id, email: "rev@aa.example" });
    const tp = await sessionFor("tp", { tpId: m.tp._id, email: "tp@aa.example" });
    const otherTp = await sessionFor("tp", { tpId: m.otherTp._id, email: "tp2@aa.example" });
    const assessor = await sessionFor("assessor", {
      linkedProfileId: assessorId,
      email: "assessor@aa.example",
    });
    const otherAssessor = await sessionFor("assessor", {
      linkedProfileId: new mongoose.Types.ObjectId(),
      email: "assessor2@aa.example",
    });
    const proctor = await sessionFor("proctor", {
      linkedProfileId: proctorId,
      email: "proctor@aa.example",
    });
    const candidate = await sessionFor("candidate", { email: "candidate@aa.example" });
    const sme = await sessionFor("sme", { email: "sme@aa.example" });

    async function idsFor(token) {
      const res = await request(app).get("/api/v1/batches").set(bearer(token));
      expect(res.status).toBe(200);
      return res.body.items.map((item) => item.id);
    }

    expect(await idsFor(mis.token)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(await idsFor(ncvet.token)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(await idsFor(reviewer.token)).toEqual([first.id]);
    expect(await idsFor(tp.token)).toEqual([first.id]);
    expect(await idsFor(otherTp.token)).toEqual([second.id]);
    expect(await idsFor(assessor.token)).toEqual([first.id]);
    expect(await idsFor(otherAssessor.token)).toEqual([]);
    expect(await idsFor(proctor.token)).toEqual([second.id]);
    expect(await idsFor(candidate.token)).toEqual([]);

    const reviewerOther = await request(app)
      .get(`/api/v1/batches/${second.id}`)
      .set(bearer(reviewer.token));
    expectError(reviewerOther, 403, "FORBIDDEN");
    const candidateGet = await request(app)
      .get(`/api/v1/batches/${first.id}`)
      .set(bearer(candidate.token));
    expectError(candidateGet, 403, "FORBIDDEN");
    const tpWiden = await request(app)
      .get(`/api/v1/batches?tpId=${m.otherTp._id}`)
      .set(bearer(tp.token));
    expect(tpWiden.status).toBe(200);
    expect(tpWiden.body.total).toBe(0);

    const smeList = await request(app).get("/api/v1/batches").set(bearer(sme.token));
    expectError(smeList, 403, "FORBIDDEN");
    const smeDash = await request(app).get("/api/v1/compliance/dashboard").set(bearer(sme.token));
    expectError(smeDash, 403, "FORBIDDEN");
  });

  it("filters by status, assessment start, and tp, and pages the list", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const june = await createOne(admin.token, m, {
      assessmentStartDate: "2099-06-15",
      assessmentEndDate: "2099-06-16",
    });
    const lateJune = await createOne(admin.token, m, {
      assessmentStartDate: "2099-06-20",
      assessmentEndDate: "2099-06-21",
    });
    const july = await createOne(admin.token, m, {
      abId: String(m.otherAb._id),
      tpId: String(m.otherTp._id),
      centreId: String(m.otherCentre._id),
      assessmentStartDate: "2099-07-01",
      assessmentEndDate: "2099-07-02",
    });

    const window = await request(app)
      .get("/api/v1/batches?from=2099-06-01&to=2099-06-30")
      .set(bearer(admin.token));
    expect(window.body.total).toBe(2);
    expect(window.body.items.map((item) => item.id).sort()).toEqual([june.id, lateJune.id].sort());

    const byTp = await request(app)
      .get(`/api/v1/batches?tpId=${m.otherTp._id}`)
      .set(bearer(admin.token));
    expect(byTp.body.items.map((item) => item.id)).toEqual([july.id]);

    await request(app).post(`/api/v1/batches/${june.id}/accept`).set(bearer(admin.token)).send({});
    const accepted = await request(app)
      .get("/api/v1/batches?status=accepted")
      .set(bearer(admin.token));
    expect(accepted.body.items.map((item) => item.id)).toEqual([june.id]);

    const page = await request(app)
      .get("/api/v1/batches?page=2&pageSize=2")
      .set(bearer(admin.token));
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.body.items).toHaveLength(1);
  });

  it("applies every legal mounted transition for aa_admin", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    for (const action of MOUNTED) {
      const rows = BATCH_TRANSITIONS.filter((row) => row.action === action);
      for (const row of rows) {
        const created = await createOne(admin.token, m);
        await Batch.updateOne(
          { _id: created.id },
          { $set: { status: row.from, statusVersion: 2 } },
        );
        const body = action === "accept" ? {} : { reason: "Practical and viva completed" };
        const res = await request(app)
          .post(`/api/v1/batches/${created.id}/${action}`)
          .set(bearer(admin.token))
          .send(body);
        expect(res.status, `${action} from ${row.from} ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body.status).toBe(row.to);
        expect(res.body.statusVersion).toBe(3);
        if (action === "accept") expect(res.body.acceptedAt).toEqual(expect.any(String));
        if (action === "reject") expect(res.body.rejectReason).toBe("Practical and viva completed");
        if (action === "cancel") {
          expect(res.body.cancelReason).toBe("Practical and viva completed");
          expect(res.body.cancelledAt).toEqual(expect.any(String));
        }
        const audit = await AuditLog.findOne({
          action: `batch.${action}`,
          entityId: created.id,
        }).lean();
        expect(audit.before.status).toBe(row.from);
        expect(audit.after.status).toBe(row.to);
        expect(audit.actorRole).toBe("aa_admin");
        if (action !== "accept") expect(audit.meta.reason).toBe("Practical and viva completed");
      }
    }
    expect(await AuditLog.countDocuments({ action: /^sla_late_/ })).toBe(0);
  });

  it("returns 409 for every illegal status and 403 for every other role", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const created = await createOne(admin.token, m);

    for (const action of MOUNTED) {
      for (const status of BATCH_STATUSES) {
        if (BATCH_TRANSITIONS.some((row) => row.action === action && row.from === status)) continue;
        await Batch.updateOne({ _id: created.id }, { $set: { status, statusVersion: 1 } });
        const body = action === "accept" ? {} : { reason: "no" };
        const res = await request(app)
          .post(`/api/v1/batches/${created.id}/${action}`)
          .set(bearer(admin.token))
          .send(body);
        expect(res.status, `${action} from ${status}`).toBe(409);
        expect(res.body.error.code).toBe("INVALID_TRANSITION");
        expect((await Batch.findById(created.id).lean()).status).toBe(status);
      }
    }

    await Batch.updateOne({ _id: created.id }, { $set: { status: "allocated", statusVersion: 1 } });
    for (const role of USER_ROLES) {
      if (role === "aa_admin") continue;
      const session = await sessionFor(role, { email: `${role}-write@aa.example` });
      for (const action of MOUNTED) {
        const body = action === "accept" ? {} : { reason: "no" };
        const res = await request(app)
          .post(`/api/v1/batches/${created.id}/${action}`)
          .set(bearer(session.token))
          .send(body);
        expect(res.status, `${role} ${action}`).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      }
    }
    expect((await Batch.findById(created.id).lean()).status).toBe("allocated");
  });

  it("lets only one of two simultaneous accepts win", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const created = await createOne(admin.token, m);
    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/batches/${created.id}/accept`).set(bearer(admin.token)).send({}),
      request(app).post(`/api/v1/batches/${created.id}/accept`).set(bearer(admin.token)).send({}),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = [first, second].find((res) => res.status === 409);
    expect(loser.body.error.code).toBe("INVALID_TRANSITION");
    const winner = [first, second].find((res) => res.status === 200);
    expect(winner.body).toMatchObject({ status: "accepted", statusVersion: 2 });
    const saved = await Batch.findById(created.id).lean();
    expect(saved.status).toBe("accepted");
    expect(saved.statusVersion).toBe(2);
    expect(await AuditLog.countDocuments({ action: "batch.accept", entityId: created.id })).toBe(1);
  });

  it("requires lateReason after acceptDueAt and records the breach when a reason is given", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const adminUser = await User.findById(admin.userId);
    const due = new Date("2026-10-12T18:29:59.999Z");

    const onTime = await createOne(admin.token, m);
    await Batch.updateOne({ _id: onTime.id }, { $set: { "sla.acceptDueAt": due } });
    const atDue = await transitionBatch(adminUser, onTime.id, "accept", {}, { now: due });
    expect(atDue.batch.status).toBe("accepted");
    expect(atDue.stored.sla.breached).toEqual([]);

    const late = await createOne(admin.token, m, {
      assessmentStartDate: "2099-06-20",
      assessmentEndDate: "2099-06-21",
    });
    await Batch.updateOne({ _id: late.id }, { $set: { "sla.acceptDueAt": due } });
    await expect(
      transitionBatch(adminUser, late.id, "accept", {}, { now: new Date(due.getTime() + 1) }),
    ).rejects.toMatchObject({ status: 409, code: "SLA_ACCEPT_EXPIRED" });
    await Batch.updateOne(
      { _id: late.id },
      { $set: { "sla.acceptDueAt": new Date("2000-01-01T00:00:00.000Z") } },
    );

    const missing = await request(app)
      .post(`/api/v1/batches/${late.id}/accept`)
      .set(bearer(admin.token))
      .send({});
    expectError(missing, 409, "SLA_ACCEPT_EXPIRED");
    expect((await Batch.findById(late.id).lean()).status).toBe("allocated");
    expect(await AuditLog.countDocuments({ action: "sla_late_accept", entityId: late.id })).toBe(0);

    const blank = await request(app)
      .post(`/api/v1/batches/${late.id}/accept`)
      .set(bearer(admin.token))
      .send({ lateReason: "   " });
    expectError(blank, 400, "VALIDATION_ERROR");

    const accepted = await request(app)
      .post(`/api/v1/batches/${late.id}/accept`)
      .set(bearer(admin.token))
      .send({ lateReason: "AB confirmation delayed" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect(accepted.body.sla.breached).toEqual(["accept"]);
    expect(accepted.body.sla.lateActions).toEqual([
      expect.objectContaining({
        key: "accept",
        reason: "AB confirmation delayed",
        byUserId: admin.userId,
      }),
    ]);
    const lateAudit = await AuditLog.findOne({
      action: "sla_late_accept",
      entityId: late.id,
    }).lean();
    expect(lateAudit.meta.reason).toBe("AB confirmation delayed");
    expect(lateAudit.meta.key).toBe("accept");
    expect(lateAudit.actorRole).toBe("aa_admin");
    expect(await AuditLog.countDocuments({ action: "batch.accept", entityId: late.id })).toBe(1);

    const rejected = await createOne(admin.token, m, {
      assessmentStartDate: "2099-06-22",
      assessmentEndDate: "2099-06-23",
    });
    await Batch.updateOne(
      { _id: rejected.id },
      { $set: { "sla.acceptDueAt": new Date("2000-01-01") } },
    );
    const rejectMissing = await request(app)
      .post(`/api/v1/batches/${rejected.id}/reject`)
      .set(bearer(admin.token))
      .send({ reason: "Capacity full" });
    expectError(rejectMissing, 409, "SLA_ACCEPT_EXPIRED");
    expect((await Batch.findById(rejected.id).lean()).status).toBe("allocated");

    const rejectLate = await request(app)
      .post(`/api/v1/batches/${rejected.id}/reject`)
      .set(bearer(admin.token))
      .send({ reason: "Capacity full", lateReason: "AB confirmation delayed" });
    expect(rejectLate.status).toBe(200);
    expect(rejectLate.body).toMatchObject({
      status: "rejected",
      rejectReason: "Capacity full",
    });
    expect(rejectLate.body.sla.breached).toEqual(["accept"]);
    const rejectAudit = await AuditLog.findOne({
      action: "sla_late_reject",
      entityId: rejected.id,
    }).lean();
    expect(rejectAudit.meta).toMatchObject({ reason: "AB confirmation delayed", key: "accept" });
    const rejectRow = await AuditLog.findOne({
      action: "batch.reject",
      entityId: rejected.id,
    }).lean();
    expect(rejectRow.meta.reason).toBe("Capacity full");
    expect(rejectRow.after.status).toBe("rejected");
  });

  it("recomputes open breaches on read and persists them once in the nightly job", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const created = await createOne(admin.token, m);
    await Batch.updateOne(
      { _id: created.id },
      { $set: { "sla.acceptDueAt": new Date("2000-01-01T00:00:00.000Z") } },
    );

    const fetched = await request(app)
      .get(`/api/v1/batches/${created.id}`)
      .set(bearer(admin.token));
    expect(fetched.body.sla.breached).toEqual(["accept"]);
    expect((await Batch.findById(created.id).lean()).sla.breached).toEqual([]);

    expect(await markOverdueSlaBreaches()).toEqual({ accept: 1, assign: 0, result: 0 });
    expect(await markOverdueSlaBreaches()).toEqual({ accept: 0, assign: 0, result: 0 });
    expect((await Batch.findById(created.id).lean()).sla.breached).toEqual(["accept"]);
  });

  it("counts statuses and open overdue SLAs for the caller's batches", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const tp = await sessionFor("tp", { tpId: m.tp._id, email: "tp-dash@aa.example" });
    const otherTp = await sessionFor("tp", { tpId: m.otherTp._id, email: "tp-dash2@aa.example" });
    const candidate = await sessionFor("candidate", { email: "cand-dash@aa.example" });
    const own = await createOne(admin.token, m);
    await createOne(admin.token, m, {
      abId: String(m.otherAb._id),
      tpId: String(m.otherTp._id),
      centreId: String(m.otherCentre._id),
      assessmentStartDate: "2099-07-01",
      assessmentEndDate: "2099-07-02",
    });
    await request(app).post(`/api/v1/batches/${own.id}/accept`).set(bearer(admin.token)).send({});

    const dash = await request(app).get("/api/v1/compliance/dashboard").set(bearer(admin.token));
    expect(dash.status).toBe(200);
    expect(dash.body.statusCounts).toMatchObject({
      allocated: 1,
      accepted: 1,
      rejected: 0,
      assessor_assigned: 0,
      in_progress: 0,
      assessment_completed: 0,
      result_submitted: 0,
      ab_validated: 0,
      published: 0,
      cancelled: 0,
      disputed: 0,
    });
    expect(dash.body.overdue).toEqual({ accept: 0, assign: 0, result: 0 });
    expect(Object.keys(dash.body.statusCounts).sort()).toEqual([...BATCH_STATUSES].sort());

    await Batch.updateOne(
      { _id: own.id },
      { $set: { status: "allocated", "sla.acceptDueAt": new Date("2000-01-01T00:00:00.000Z") } },
    );
    const overdue = await request(app).get("/api/v1/compliance/dashboard").set(bearer(admin.token));
    expect(overdue.body.overdue.accept).toBe(1);
    const tpDash = await request(app).get("/api/v1/compliance/dashboard").set(bearer(tp.token));
    expect(tpDash.body.overdue.accept).toBe(1);
    expect(tpDash.body.statusCounts.allocated).toBe(1);
    const otherDash = await request(app)
      .get("/api/v1/compliance/dashboard")
      .set(bearer(otherTp.token));
    expect(otherDash.body.overdue).toEqual({ accept: 0, assign: 0, result: 0 });
    const candidateDash = await request(app)
      .get("/api/v1/compliance/dashboard")
      .set(bearer(candidate.token));
    expect(candidateDash.body.overdue).toEqual({ accept: 0, assign: 0, result: 0 });
    expect(Object.values(candidateDash.body.statusCounts).every((count) => count === 0)).toBe(true);
  });

  it("does not mount dispute routes", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const created = await createOne(admin.token, m);
    for (const action of NOT_MOUNTED) {
      const res = await request(app)
        .post(`/api/v1/batches/${created.id}/${action}`)
        .set(bearer(admin.token))
        .send({});
      expect(res.status, action).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
  });

  it("blocks a batch outside recognition and lets aa_admin override with a reason", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const reviewer = await sessionFor("ab_reviewer", {
      abId: m.ab._id,
      email: "reviewer-recog@aa.example",
    });
    const auth = bearer(admin.token);

    await AaRecognition.deleteMany({});
    const unconfigured = await request(app).post("/api/v1/batches").set(auth).send(batchBody(m));
    expectError(unconfigured, 409, "RULE_OUTSIDE_RECOGNITION");
    expect(unconfigured.body.error.details.checks).toEqual(["unconfigured"]);
    expect(await Batch.countDocuments()).toBe(0);

    const overridden = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { recognitionOverrideReason: "Recognition letter is in transit" }));
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(201);
    expect(overridden.body.recognitionOverride.checks).toEqual(["unconfigured"]);
    expect(overridden.body.recognitionOverride.reason).toBe("Recognition letter is in transit");
    expect(overridden.body.recognitionOverride.byUserId).toBe(admin.userId);
    const overrideAudit = await AuditLog.findOne({
      action: "recognition_override",
      entityId: overridden.body.id,
    }).lean();
    expect(overrideAudit.meta.reason).toBe("Recognition letter is in transit");
    expect(overrideAudit.meta.checks).toEqual(["unconfigured"]);

    await AaRecognition.create({
      sectors: ["Construction"],
      panIndia: false,
      states: ["Gujarat"],
      startDate: "2020-01-01",
      endDate: "2099-12-31",
    });
    const outside = await request(app).post("/api/v1/batches").set(auth).send(batchBody(m));
    expectError(outside, 409, "RULE_OUTSIDE_RECOGNITION");
    expect(outside.body.error.details.checks).toEqual(["sector", "state"]);

    const reviewerOverride = await request(app)
      .post("/api/v1/batches")
      .set(bearer(reviewer.token))
      .send(batchBody(m, { recognitionOverrideReason: "Reviewer cannot override" }));
    expectError(reviewerOverride, 409, "RULE_OUTSIDE_RECOGNITION");
    expect(reviewerOverride.body.error.details.checks).toEqual(["sector", "state"]);

    await AaRecognition.updateOne(
      {},
      { $set: { sectors: ["Electronics"], states: ["Maharashtra"], endDate: "2020-12-31" } },
    );
    const expired = await request(app).post("/api/v1/batches").set(auth).send(batchBody(m));
    expectError(expired, 409, "RULE_OUTSIDE_RECOGNITION");
    expect(expired.body.error.details.checks).toEqual(["expired"]);

    await AaRecognition.updateOne({}, { $set: { startDate: "2090-01-01", endDate: "2099-12-31" } });
    const notStarted = await request(app).post("/api/v1/batches").set(auth).send(batchBody(m));
    expectError(notStarted, 409, "RULE_OUTSIDE_RECOGNITION");
    expect(notStarted.body.error.details.checks).toEqual(["not_started"]);
    expect(await Batch.countDocuments()).toBe(1);

    const gujarat = await Centre.create({
      name: "Gujarat Centre",
      tpId: m.tp._id,
      state: "Gujarat",
      active: true,
    });
    await AaRecognition.updateOne(
      {},
      {
        $set: {
          sectors: ["Electronics"],
          panIndia: true,
          states: [],
          startDate: "2020-01-01",
          endDate: "2099-12-31",
        },
      },
    );
    const panIndia = await createOne(admin.token, m, { centreId: String(gujarat._id) });
    expect(panIndia.state).toBe("Gujarat");
    expect(panIndia.recognitionOverride).toBeNull();

    const statelessId = new mongoose.Types.ObjectId();
    await Centre.collection.insertOne({
      _id: statelessId,
      name: "No state",
      tpId: m.tp._id,
      active: true,
    });
    const noState = await request(app)
      .post("/api/v1/batches")
      .set(auth)
      .send(batchBody(m, { centreId: String(statelessId) }));
    expectError(noState, 400, "VALIDATION_ERROR");
    expect(noState.body.error.details.centreId).toEqual(["Centre has no state"]);
  });
});
