import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { Assessor } from "../src/models/assessor.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate, ensureCandidateIndexes } from "../src/models/candidate.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Learner } from "../src/models/learner.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { User } from "../src/models/user.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import {
  CANDIDATE_CSV_MAX_BYTES,
  CANDIDATE_CSV_MAX_ROWS,
} from "../src/modules/candidates/candidate-limits.js";
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
    abId: extra.abId,
    tpId: extra.tpId,
  });
  const res = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
    device: webDevice,
  });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
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
    nos: [{ nosId: "NOS-01", code: "N01", name: "Safety", pcs: [] }],
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
    candidateCount: 10,
    assessmentLanguage: "Hindi",
    ...overrides,
  };
}

async function createBatch(token, m, overrides) {
  const created = await request(app)
    .post("/api/v1/batches")
    .set(bearer(token))
    .send(batchBody(m, overrides));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body;
}

async function createLearnerDoc(overrides = {}) {
  return Learner.create({
    name: overrides.name ?? "Asha Devi",
    externalRef: overrides.externalRef ?? `TP-${Math.random().toString(16).slice(2, 10)}`,
    accommodations: overrides.accommodations ?? [],
    active: true,
  });
}

describe("batch candidates", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Batch.syncIndexes(),
      Candidate.syncIndexes(),
      Learner.syncIndexes(),
      AuditLog.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  it("adds by learnerId and by name, copies learner fields, and writes audit", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const learner = await createLearnerDoc({ name: "Asha Devi", externalRef: "TP-REG-10021" });

    const byId = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ learnerId: String(learner._id), accommodations: ["extra time"] });
    expect(byId.status, JSON.stringify(byId.body)).toBe(201);
    expect(byId.body).toMatchObject({
      batchId: batch.id,
      learnerId: String(learner._id),
      name: "Asha Devi",
      externalRef: "TP-REG-10021",
      accommodations: ["extra time"],
      active: true,
    });
    expect(byId.body).not.toHaveProperty("aadhaar");

    const byName = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Ravi Kumar", externalRef: "TP-REG-10023" });
    expect(byName.status, JSON.stringify(byName.body)).toBe(201);
    expect(byName.body.name).toBe("Ravi Kumar");
    const linked = await Learner.findById(byName.body.learnerId).lean();
    expect(linked.name).toBe("Ravi Kumar");

    const listed = await request(app)
      .get(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(2);
    const refreshed = await request(app)
      .get(`/api/v1/batches/${batch.id}`)
      .set(bearer(admin.token));
    expect(refreshed.body.candidateCount).toBe(2);
    expect(await AuditLog.find({ action: "candidate.create" })).toHaveLength(2);
  });

  it("rejects a duplicate learner on the same batch", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const first = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Asha Devi", externalRef: "TP-REG-10021" });
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Asha Devi", externalRef: "TP-REG-10021" });
    expectError(dup, 409, "DUPLICATE_RESOURCE");
    const again = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ learnerId: first.body.learnerId });
    expectError(again, 409, "DUPLICATE_RESOURCE");
  });

  it("allows two candidates without externalRef on one batch", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const learners = await Learner.create([
      { name: "No Ref One", active: true },
      { name: "No Ref Two", active: true },
    ]);

    for (const learner of learners) {
      const res = await request(app)
        .post(`/api/v1/batches/${batch.id}/candidates`)
        .set(bearer(admin.token))
        .send({ learnerId: String(learner._id) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.externalRef).toBeNull();
    }
    expect(await Candidate.countDocuments({ batchId: batch.id })).toBe(2);
  });

  it("keeps externalRef unique on a batch when it is present", async () => {
    const batchId = new mongoose.Types.ObjectId();
    const row = (name) => ({
      batchId,
      learnerId: new mongoose.Types.ObjectId(),
      name,
      externalRef: "TP-SAME",
    });
    await Candidate.create(row("First"));
    await expect(Candidate.create(row("Second"))).rejects.toMatchObject({ code: 11000 });
    await Candidate.create({ ...row("Other batch"), batchId: new mongoose.Types.ObjectId() });
  });

  it("replaces the old sparse externalRef index on an existing database", async () => {
    const key = { batchId: 1, externalRef: 1 };
    const externalRefIndex = async () =>
      (await Candidate.collection.indexes()).find(
        (index) => JSON.stringify(index.key) === JSON.stringify(key),
      );
    const noRef = (name) => ({
      batchId: new mongoose.Types.ObjectId(),
      learnerId: new mongoose.Types.ObjectId(),
      name,
    });

    await Candidate.collection.dropIndex("batchId_1_externalRef_1");
    await Candidate.collection.createIndex(key, { unique: true, sparse: true });
    const batchId = new mongoose.Types.ObjectId();
    await Candidate.create({ ...noRef("Before"), batchId });
    await expect(Candidate.create({ ...noRef("Blocked"), batchId })).rejects.toMatchObject({
      code: 11000,
    });

    expect(await ensureCandidateIndexes()).toBe(true);
    const index = await externalRefIndex();
    expect(index.unique).toBe(true);
    expect(index.sparse).toBeUndefined();
    expect(index.partialFilterExpression).toEqual({ externalRef: { $type: "string" } });
    await Candidate.create({ ...noRef("After"), batchId });

    expect(await ensureCandidateIndexes()).toBe(false);
  });

  it("rejects Aadhaar and unknown keys", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const res = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Asha", externalRef: "TP-1", aadhaar: "123412341234" });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(await Candidate.countDocuments()).toBe(0);
  });

  it("deactivates without a hard delete and keeps candidateCount in sync", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const first = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Asha Devi", externalRef: "TP-REG-10021" });
    const second = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Ravi Kumar", externalRef: "TP-REG-10023" });

    const patched = await request(app)
      .patch(`/api/v1/batches/${batch.id}/candidates/${first.body.id}`)
      .set(bearer(admin.token))
      .send({ active: false, accommodations: ["scribe"] });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.active).toBe(false);
    expect(patched.body.accommodations).toEqual(["scribe"]);
    const after = await request(app).get(`/api/v1/batches/${batch.id}`).set(bearer(admin.token));
    expect(after.body.candidateCount).toBe(1);

    const del = await request(app)
      .delete(`/api/v1/batches/${batch.id}/candidates/${first.body.id}`)
      .set(bearer(admin.token));
    expect(del.status).toBe(404);
    expect(await Candidate.countDocuments()).toBe(2);
    const activeOnly = await request(app)
      .get(`/api/v1/batches/${batch.id}/candidates?active=true`)
      .set(bearer(admin.token));
    expect(activeOnly.body.items.map((row) => row.id)).toEqual([second.body.id]);
    expect(await AuditLog.find({ action: "candidate.update" })).toHaveLength(1);
  });

  it("imports a good CSV, skips duplicates, and records row errors", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Existing", externalRef: "TP-EXIST" });

    const csv = [
      "name,externalRef",
      "New Person,TP-NEW-1",
      "Existing,TP-EXIST",
      ",MISSING-NAME",
      "OnlyName,",
      "=1+1,TP-FORMULA",
    ].join("\n");
    const res = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set({ ...bearer(admin.token), "Content-Type": "text/csv" })
      .send(csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { row: 4, reason: "name and externalRef are required" },
        { row: 5, reason: "name and externalRef are required" },
      ]),
    );
    expect((await Candidate.findOne({ externalRef: "TP-FORMULA" }).lean()).name).toBe("'=1+1");

    const multipart = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set(bearer(admin.token))
      .attach("file", Buffer.from("name,externalRef\nMultipart Row,TP-MP-1\n"), "extra.csv");
    expect(multipart.status, JSON.stringify(multipart.body)).toBe(200);
    expect(multipart.body.created).toBe(1);
    expect((await AuditLog.find({ action: "candidate.import" })).length).toBeGreaterThanOrEqual(2);
  });

  it("never stores the uploaded CSV in an audit row", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const before = await AuditLog.countDocuments({ action: "candidate.import" });

    const multipart = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set(bearer(admin.token))
      .attach("file", Buffer.from("name,externalRef\nSecretName Person,TP-SECRET-1\n"), "x.csv");
    expect(multipart.status, JSON.stringify(multipart.body)).toBe(200);
    const csv = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set({ ...bearer(admin.token), "Content-Type": "text/csv" })
      .send("name,externalRef\nSecretName Two,TP-SECRET-2\n");
    expect(csv.status).toBe(200);

    const rows = await AuditLog.find({ action: "candidate.import" }).lean();
    expect(rows).toHaveLength(before + 2);
    const json = JSON.stringify(rows);
    expect(json).not.toContain("SecretName");
    expect(json).not.toContain("TP-SECRET");
    expect(json).not.toContain("requestBody");
  });

  it("rejects non-CSV and oversized imports", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);

    const json = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set(bearer(admin.token))
      .send({ name: "nope" });
    expectError(json, 400, "VALIDATION_ERROR");

    const xlsx = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set(bearer(admin.token))
      .attach("file", Buffer.from("name,externalRef\nA,B\n"), "roster.xlsx");
    expectError(xlsx, 400, "VALIDATION_ERROR");

    const tooMany = [
      "name,externalRef",
      ...Array.from({ length: CANDIDATE_CSV_MAX_ROWS + 1 }, (_, i) => `N${i},R${i}`),
    ].join("\n");
    const rows = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set({ ...bearer(admin.token), "Content-Type": "text/csv" })
      .send(tooMany);
    expectError(rows, 400, "VALIDATION_ERROR");

    const huge = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set({ ...bearer(admin.token), "Content-Type": "text/csv" })
      .send("x".repeat(CANDIDATE_CSV_MAX_BYTES + 10));
    expectError(huge, 400, "VALIDATION_ERROR");
  });

  it("blocks and overrides RULE_RATIO when an assessor is already assigned", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const mis = await sessionFor("mis", { email: "mis@aa.example" });
    const batch = await createBatch(admin.token, m);
    await request(app).post(`/api/v1/batches/${batch.id}/accept`).set(bearer(admin.token)).send({});
    const assessor = await Assessor.create({
      name: "Ravi Assessor",
      code: "ASR-1",
      languages: ["Hindi"],
      toa: { certNo: "TOA-1", issuedOn: "2024-01-01", expiresOn: "2100-01-01" },
      otherAaCount: 1,
      undertaking: true,
      active: true,
    });
    const assigned = await request(app)
      .post(`/api/v1/batches/${batch.id}/assign`)
      .set(bearer(admin.token))
      .send({ assessorId: String(assessor._id) });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    for (let i = 0; i < compliance.RATIO_MAX_MANUFACTURING; i += 1) {
      const learner = await Learner.create({
        name: `Filler ${i}`,
        externalRef: `FILL-${i}`,
        active: true,
        accommodations: [],
      });
      await Candidate.create({
        batchId: batch.id,
        learnerId: learner._id,
        name: learner.name,
        externalRef: learner.externalRef,
        accommodations: [],
        active: true,
      });
    }
    await Batch.updateOne(
      { _id: batch.id },
      { $set: { candidateCount: compliance.RATIO_MAX_MANUFACTURING } },
    );

    const blocked = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Over Cap", externalRef: "OVER-1" });
    expectError(blocked, 409, "RULE_RATIO");

    const misOverride = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(mis.token))
      .send({
        name: "Over Cap",
        externalRef: "OVER-1",
        ratioOverrideReason: "AB approved larger cohort",
      });
    expectError(misOverride, 409, "RULE_RATIO");

    const overridden = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({
        name: "Over Cap",
        externalRef: "OVER-1",
        ratioOverrideReason: "AB approved larger cohort",
      });
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(201);
    const after = await request(app).get(`/api/v1/batches/${batch.id}`).set(bearer(admin.token));
    expect(after.body.candidateCount).toBe(compliance.RATIO_MAX_MANUFACTURING + 1);
    expect(after.body.ratioOverride.reason).toBe("AB approved larger cohort");
    expect(
      (await AuditLog.find({ action: "ratio_override" }).lean()).some(
        (row) => row.meta?.reason === "AB approved larger cohort",
      ),
    ).toBe(true);
  });

  it("rejects roster writes after assessment starts", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    await Batch.updateOne({ _id: batch.id }, { $set: { status: "in_progress" } });
    const res = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Late Add", externalRef: "LATE-1" });
    expectError(res, 409, "INVALID_TRANSITION");

    await Batch.updateOne({ _id: batch.id }, { $set: { status: "allocated" } });
    const created = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "On Time", externalRef: "ON-1" });
    expect(created.status).toBe(201);
    await Batch.updateOne({ _id: batch.id }, { $set: { status: "cancelled" } });
    const patch = await request(app)
      .patch(`/api/v1/batches/${batch.id}/candidates/${created.body.id}`)
      .set(bearer(admin.token))
      .send({ active: false });
    expectError(patch, 409, "INVALID_TRANSITION");
  });

  it("scopes reads by role and lets a candidate read only their batch and row", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const own = await createBatch(admin.token, m);
    const other = await createBatch(admin.token, m, {
      abId: String(m.otherAb._id),
      tpId: String(m.otherTp._id),
      centreId: String(m.otherCentre._id),
    });
    const learner = await createLearnerDoc({ name: "Asha Devi", externalRef: "TP-OWN" });
    const otherLearner = await createLearnerDoc({ name: "Other", externalRef: "TP-OTHER" });
    const ownRow = await request(app)
      .post(`/api/v1/batches/${own.id}/candidates`)
      .set(bearer(admin.token))
      .send({ learnerId: String(learner._id) });
    await request(app)
      .post(`/api/v1/batches/${own.id}/candidates`)
      .set(bearer(admin.token))
      .send({ learnerId: String(otherLearner._id) });
    await request(app)
      .post(`/api/v1/batches/${other.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Stranger", externalRef: "TP-STRANGER" });

    const assessor = await Assessor.create({
      name: "Assigned",
      code: "ASR-OWN",
      languages: ["Hindi"],
      toa: { certNo: "TOA-1", issuedOn: "2024-01-01", expiresOn: "2100-01-01" },
      otherAaCount: 0,
      undertaking: true,
      active: true,
    });
    await request(app).post(`/api/v1/batches/${own.id}/accept`).set(bearer(admin.token)).send({});
    await request(app)
      .post(`/api/v1/batches/${own.id}/assign`)
      .set(bearer(admin.token))
      .send({ assessorId: String(assessor._id) });

    const tp = await sessionFor("tp", { tpId: m.tp._id, email: "tp@aa.example" });
    const otherTp = await sessionFor("tp", { tpId: m.otherTp._id, email: "tp2@aa.example" });
    const reviewer = await sessionFor("ab_reviewer", { abId: m.ab._id, email: "rev@aa.example" });
    const assessorUser = await sessionFor("assessor", {
      linkedProfileId: assessor._id,
      email: "assessor@aa.example",
    });
    const candidate = await sessionFor("candidate", {
      linkedProfileId: learner._id,
      email: "candidate@aa.example",
    });
    const unlinked = await sessionFor("candidate", { email: "cand2@aa.example" });
    const sme = await sessionFor("sme", { email: "sme@aa.example" });
    const proctor = await sessionFor("proctor", { email: "proctor@aa.example" });

    const tpList = await request(app)
      .get(`/api/v1/batches/${own.id}/candidates`)
      .set(bearer(tp.token));
    expect(tpList.status).toBe(200);
    expect(tpList.body.items).toHaveLength(2);
    expect(
      (await request(app).get(`/api/v1/batches/${other.id}/candidates`).set(bearer(otherTp.token)))
        .status,
    ).toBe(200);
    expectError(
      await request(app).get(`/api/v1/batches/${other.id}/candidates`).set(bearer(tp.token)),
      403,
      "FORBIDDEN",
    );
    expectError(
      await request(app).get(`/api/v1/batches/${other.id}/candidates`).set(bearer(reviewer.token)),
      403,
      "FORBIDDEN",
    );
    expect(
      (
        await request(app)
          .get(`/api/v1/batches/${own.id}/candidates`)
          .set(bearer(assessorUser.token))
      ).status,
    ).toBe(200);
    // X-39: the assessor of the batch sees each student's login; the training partner does not.
    const assessorList = await request(app)
      .get(`/api/v1/batches/${own.id}/candidates`)
      .set(bearer(assessorUser.token));
    for (const item of assessorList.body.items) {
      expect(item.login).toMatchObject({ loginId: expect.stringContaining("@") });
    }
    for (const item of tpList.body.items) expect(item.login).toBeUndefined();
    expectError(
      await request(app)
        .get(`/api/v1/batches/${other.id}/candidates`)
        .set(bearer(assessorUser.token)),
      403,
      "FORBIDDEN",
    );

    const ownRowGet = await request(app)
      .get(`/api/v1/batches/${own.id}/candidates`)
      .set(bearer(candidate.token));
    expect(ownRowGet.status).toBe(200);
    expect(ownRowGet.body.items).toHaveLength(1);
    expect(ownRowGet.body.items[0].id).toBe(ownRow.body.id);
    expect(
      (await request(app).get(`/api/v1/batches/${own.id}`).set(bearer(candidate.token))).status,
    ).toBe(200);
    const candidateList = await request(app).get("/api/v1/batches").set(bearer(candidate.token));
    expect(candidateList.body.items.map((item) => item.id)).toEqual([own.id]);
    const candidateDash = await request(app)
      .get("/api/v1/compliance/dashboard")
      .set(bearer(candidate.token));
    expect(candidateDash.body.statusCounts.assessor_assigned).toBe(1);
    expectError(
      await request(app).get(`/api/v1/batches/${other.id}`).set(bearer(candidate.token)),
      403,
      "FORBIDDEN",
    );
    expectError(
      await request(app).get(`/api/v1/batches/${own.id}`).set(bearer(unlinked.token)),
      403,
      "FORBIDDEN",
    );
    expectError(
      await request(app)
        .get(`/api/v1/batches/${new mongoose.Types.ObjectId()}/candidates`)
        .set(bearer(admin.token)),
      404,
      "NOT_FOUND",
    );
    expectError(
      await request(app).get(`/api/v1/batches/${own.id}/candidates`).set(bearer(sme.token)),
      403,
      "FORBIDDEN",
    );
    expectError(
      await request(app).get(`/api/v1/batches/${own.id}/candidates`).set(bearer(proctor.token)),
      403,
      "FORBIDDEN",
    );
    expectError(
      await request(app)
        .post(`/api/v1/batches/${own.id}/candidates`)
        .set(bearer(tp.token))
        .send({ name: "Nope", externalRef: "NOPE" }),
      403,
      "FORBIDDEN",
    );
  });

  const listFor = (token, batchId) =>
    request(app).get(`/api/v1/batches/${batchId}/candidates`).set(bearer(token));

  it("makes a login for every student added, with or without an email (X-36)", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);

    const withEmail = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Asha Devi", externalRef: "TP-REG-1", email: "Asha@Example.com" });
    expect(withEmail.status, JSON.stringify(withEmail.body)).toBe(201);
    expect(withEmail.body.login).toMatchObject({ status: "created", emailQueued: true });
    expect(JSON.stringify(withEmail.body)).not.toMatch(/Tmp-/);

    const noEmail = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Ravi Kumar", externalRef: "TP-REG-2" });
    expect(noEmail.status).toBe(201);
    expect(noEmail.body.login).toMatchObject({ status: "created", emailQueued: false });

    const badEmail = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Meera Das", externalRef: "TP-REG-3", email: "not-an-email" });
    expect(badEmail.status, JSON.stringify(badEmail.body)).toBe(201);
    expect(badEmail.body.login.status).toBe("created");

    // The student list shows each sign-in id and first password to staff.
    const listed = (await listFor(admin.token, batch.id)).body.items;
    expect(listed).toHaveLength(3);
    const byName = Object.fromEntries(listed.map((i) => [i.name, i.login]));
    expect(byName["Asha Devi"].loginId).toBe("asha@example.com");
    expect(byName["Ravi Kumar"].loginId).toMatch(/^tp-reg-2-[0-9a-f]{6}@students\.local$/);
    expect(byName["Meera Das"].loginId).toMatch(/@students\.local$/);
    for (const login of Object.values(byName)) {
      expect(login.initialPassword).toMatch(/^Tmp-/);
      expect(login.mustChangePassword).toBe(true);
    }

    // The password shown signs in, and it is gone from the list once the student changes it.
    const signIn = await request(app).post("/api/v1/auth/login").send({
      email: byName["Ravi Kumar"].loginId,
      password: byName["Ravi Kumar"].initialPassword,
      device: webDevice,
    });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);
    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set(bearer(signIn.body.accessToken))
      .send({
        currentPassword: byName["Ravi Kumar"].initialPassword,
        newPassword: "A-new-Strong-pass-123",
        refreshToken: signIn.body.refreshToken,
      });
    expect(changed.status, JSON.stringify(changed.body)).toBeLessThan(300);
    const after = (await listFor(admin.token, batch.id)).body.items.find(
      (i) => i.name === "Ravi Kumar",
    );
    expect(after.login).toMatchObject({ initialPassword: null, mustChangePassword: false });

    // The mail carries the id and password; nothing personal or secret reaches the audit rows.
    const [mail] = await EmailQueue.find({ kind: "candidate_login" }).lean();
    expect(mail.to).toEqual(["asha@example.com"]);
    expect(mail.text).toContain(byName["Asha Devi"].initialPassword);
    const audit = JSON.stringify(await AuditLog.find({ action: "candidate.create" }).lean());
    expect(audit).not.toMatch(/asha@example|Tmp-/i);
  });

  it("does not show passwords to the student or read-only staff (X-36)", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const added = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ name: "Asha Devi", externalRef: "TP-REG-1" });
    const candidate = await sessionFor("candidate", { linkedProfileId: added.body.learnerId });
    const own = (await listFor(candidate.token, batch.id)).body.items;
    expect(own).toHaveLength(1);
    expect(JSON.stringify(own)).not.toMatch(/Tmp-|initialPassword|loginId/);
  });

  it("keeps an existing login, and creates or resets one for older students (X-36)", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const learner = await createLearnerDoc({ name: "Ravi Kumar", externalRef: "TP-REG-2" });
    const first = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ learnerId: String(learner._id) });
    expect(first.body.login.status).toBe("created");

    const again = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates`)
      .set(bearer(admin.token))
      .send({ learnerId: String(learner._id) });
    expect(again.status).toBe(409);

    const row = (await listFor(admin.token, batch.id)).body.items[0];
    const before = row.login.initialPassword;
    const login = `/api/v1/batches/${batch.id}/candidates/${row.id}/login`;
    const reset = await request(app).post(login).set(bearer(admin.token)).send({ reset: true });
    expect(reset.body).toEqual({ status: "reset" });
    const next = (await listFor(admin.token, batch.id)).body.items[0].login.initialPassword;
    expect(next).toMatch(/^Tmp-/);
    expect(next).not.toBe(before);

    // A student added before logins existed has none, and gets one here.
    await User.deleteMany({ role: "candidate" });
    expect((await listFor(admin.token, batch.id)).body.items[0].login).toBeNull();
    const made = await request(app).post(login).set(bearer(admin.token)).send({});
    expect(made.body).toEqual({ status: "created" });
    expect((await listFor(admin.token, batch.id)).body.items[0].login.initialPassword).toMatch(
      /^Tmp-/,
    );
  });

  it("counts logins in the CSV import and never fails a row for a bad email (X-36)", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createBatch(admin.token, m);
    const csv = [
      "name,externalRef,email",
      "Asha Devi,R-1,asha@example.com",
      "Ravi Kumar,R-2,not-an-email",
      "Meera Das,R-3,",
    ].join("\n");
    const res = await request(app)
      .post(`/api/v1/batches/${batch.id}/candidates/import`)
      .set(bearer(admin.token))
      .set("Content-Type", "text/csv")
      .send(csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      created: 3,
      errors: [],
      logins: { created: 3, existing: 0, failed: 0 },
    });
    expect(await User.countDocuments({ role: "candidate" })).toBe(3);
  });
});
