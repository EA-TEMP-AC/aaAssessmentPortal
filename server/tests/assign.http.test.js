import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AaRecognition } from "../src/models/aa-recognition.model.js";
import { Assessor } from "../src/models/assessor.model.js";
import { AssessorDayLock } from "../src/models/assessor-day-lock.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
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
  const tp = await TrainingPartner.create({ name: "TP One", code: "TP-01", active: true });
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
    tpId: tp._id,
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
  const otherQual = await Qualification.create({
    code: "Q-OTHER",
    name: "Other Role",
    sector: "Electronics",
    ratioClass: "other",
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    nos: [{ nosId: "NOS-02", code: "N02", name: "Other", pcs: [] }],
  });
  await AaRecognition.create({
    sectors: ["Electronics"],
    panIndia: false,
    states: ["Maharashtra"],
    startDate: "2020-01-01",
    endDate: "2099-12-31",
  });
  return { ab, tp, centre, otherCentre, qualification, otherQual };
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
    candidateCount: 20,
    assessmentLanguage: "Hindi",
    ...overrides,
  };
}

async function createAccepted(token, m, overrides) {
  const created = await request(app)
    .post("/api/v1/batches")
    .set(bearer(token))
    .send(batchBody(m, overrides));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const accepted = await request(app)
    .post(`/api/v1/batches/${created.body.id}/accept`)
    .set(bearer(token))
    .send({});
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return accepted.body;
}

function assessorPayload(overrides = {}) {
  return {
    name: "Ravi Assessor",
    code: overrides.code ?? `ASR-${Math.random().toString(16).slice(2, 8)}`,
    email: overrides.email ?? `${Math.random().toString(16).slice(2)}@aa.example`,
    qualifications: ["Electrician L4"],
    languages: ["Hindi"],
    toa: { certNo: "TOA-1", issuedOn: "2024-01-01", expiresOn: "2100-01-01" },
    otherAaCount: 1,
    undertaking: true,
    ...overrides,
  };
}

async function createAssessor(token, overrides = {}) {
  const res = await request(app)
    .post("/api/v1/assessors")
    .set(bearer(token))
    .send(assessorPayload(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function createProctor(token) {
  const res = await request(app)
    .post("/api/v1/proctors")
    .set(bearer(token))
    .send({
      name: "Priya Proctor",
      code: `PRC-${Math.random().toString(16).slice(2, 8)}`,
      email: `${Math.random().toString(16).slice(2)}@aa.example`,
      qualifications: ["Proctor L1"],
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function assign(token, batchId, body) {
  return request(app).post(`/api/v1/batches/${batchId}/assign`).set(bearer(token)).send(body);
}

describe("assign and reassign", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Batch.syncIndexes(),
      Assessor.syncIndexes(),
      AssessorDayLock.syncIndexes(),
      Proctor.syncIndexes(),
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

  it("assigns an assessor and proctor and writes locks and audit", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createAccepted(admin.token, m);
    const assessor = await createAssessor(admin.token);
    const proctor = await createProctor(admin.token);
    const res = await assign(admin.token, batch.id, {
      assessorId: assessor.id,
      proctorId: proctor.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("assessor_assigned");
    expect(res.body.assessorId).toBe(assessor.id);
    expect(res.body.proctorId).toBe(proctor.id);
    expect(res.body.assignedAt).toEqual(expect.any(String));
    expect(res.body.statusVersion).toBe(batch.statusVersion + 1);
    expect(res.body.warnings).toBeUndefined();

    const locks = await AssessorDayLock.find({ assessorId: assessor.id }).lean();
    expect(locks).toHaveLength(2);
    expect(locks.every((lock) => String(lock.centreId) === String(m.centre._id))).toBe(true);
    expect(locks.every((lock) => lock.batchIds.map(String).includes(batch.id))).toBe(true);

    const assessorUser = await sessionFor("assessor", {
      email: "linked-asr@aa.example",
      linkedProfileId: assessor.id,
    });
    const seen = await request(app)
      .get(`/api/v1/batches/${batch.id}`)
      .set(bearer(assessorUser.token));
    expect(seen.status).toBe(200);
    const otherAsr = await createAssessor(admin.token, { languages: ["Hindi"] });
    const stranger = await sessionFor("assessor", {
      email: "stranger-asr@aa.example",
      linkedProfileId: otherAsr.id,
    });
    const hidden = await request(app)
      .get(`/api/v1/batches/${batch.id}`)
      .set(bearer(stranger.token));
    expectError(hidden, 403, "FORBIDDEN");

    const audits = await AuditLog.find({ action: "batch.assign" }).lean();
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(/passwordHash/);
  });

  it("blocks missing and expired ToA", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createAccepted(admin.token, m);
    const missing = await createAssessor(admin.token, { toa: null });
    expectError(
      await assign(admin.token, batch.id, { assessorId: missing.id }),
      409,
      "RULE_TOA_INVALID",
    );
    const expired = await createAssessor(admin.token, {
      toa: { certNo: "OLD", issuedOn: "2020-01-01", expiresOn: "2021-01-01" },
    });
    expectError(
      await assign(admin.token, batch.id, { assessorId: expired.id }),
      409,
      "RULE_TOA_INVALID",
    );
  });

  it("blocks max AAs unless the assessor is already linked", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const first = await createAccepted(admin.token, m);
    const second = await createAccepted(admin.token, m, {
      assessmentStartDate: "2099-07-15",
      assessmentEndDate: "2099-07-16",
    });
    const assessor = await createAssessor(admin.token, {
      otherAaCount: compliance.MAX_AAS_PER_ASSESSOR,
    });
    expectError(
      await assign(admin.token, first.id, { assessorId: assessor.id }),
      409,
      "RULE_MAX_AAS",
    );

    await Assessor.updateOne({ _id: assessor.id }, { $set: { otherAaCount: 1 } });
    expect((await assign(admin.token, first.id, { assessorId: assessor.id })).status).toBe(200);
    await Assessor.updateOne(
      { _id: assessor.id },
      { $set: { otherAaCount: compliance.MAX_AAS_PER_ASSESSOR } },
    );
    const linked = await assign(admin.token, second.id, { assessorId: assessor.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  });

  it("blocks ratio without a reason, stores an override, and skips other", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const over = await createAccepted(admin.token, m, {
      candidateCount: compliance.RATIO_MAX_MANUFACTURING + 1,
    });
    const assessor = await createAssessor(admin.token);
    expectError(await assign(admin.token, over.id, { assessorId: assessor.id }), 409, "RULE_RATIO");
    const noReason = await AuditLog.find({ action: "ratio_override" });
    expect(noReason).toHaveLength(0);

    const overridden = await assign(admin.token, over.id, {
      assessorId: assessor.id,
      ratioOverrideReason: "AB approved larger cohort",
    });
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(200);
    expect(overridden.body.ratioOverride.reason).toBe("AB approved larger cohort");
    expect(await AuditLog.countDocuments({ action: "ratio_override" })).toBe(1);

    const otherBatch = await createAccepted(admin.token, m, {
      qualificationId: String(m.otherQual._id),
      candidateCount: 400,
      assessmentStartDate: "2099-08-15",
      assessmentEndDate: "2099-08-16",
    });
    const otherAsr = await createAssessor(admin.token);
    const skipped = await assign(admin.token, otherBatch.id, { assessorId: otherAsr.id });
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    expect(skipped.body.ratioOverride).toBeNull();
  });

  it("blocks a language miss unless aa_admin sends a reason", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createAccepted(admin.token, m);
    const assessor = await createAssessor(admin.token, { languages: ["Tamil"] });
    expectError(
      await assign(admin.token, batch.id, { assessorId: assessor.id }),
      409,
      "RULE_ASSESSOR_LANGUAGE",
    );
    const passed = await assign(admin.token, batch.id, {
      assessorId: assessor.id,
      languageOverrideReason: "AB accepted a Hindi-speaking proctor",
    });
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    expect(await AuditLog.countDocuments({ action: "assessor_language_override" })).toBe(1);
  });

  it("clashes on a different centre and warns on the same centre under the threshold", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const assessor = await createAssessor(admin.token);
    const first = await createAccepted(admin.token, m, { candidateCount: 8 });
    const sameCentre = await createAccepted(admin.token, m, { candidateCount: 12 });
    const otherCentre = await createAccepted(admin.token, m, {
      centreId: String(m.otherCentre._id),
      assessmentStartDate: "2099-06-15",
      assessmentEndDate: "2099-06-16",
    });

    const firstAssign = await assign(admin.token, first.id, { assessorId: assessor.id });
    expect(firstAssign.status).toBe(200);
    expect(firstAssign.body.warnings).toBeUndefined();

    const warned = await assign(admin.token, sameCentre.id, { assessorId: assessor.id });
    expect(warned.status, JSON.stringify(warned.body)).toBe(200);
    expect(warned.body.warnings[0].code).toBe("SAME_CENTRE_LOW_CANDIDATES");
    expect(warned.body.warnings[0].details.otherBatchId).toBe(first.id);
    expect(await AuditLog.countDocuments({ action: "assessor_same_centre_warning" })).toBe(1);

    expectError(
      await assign(admin.token, otherCentre.id, { assessorId: assessor.id }),
      409,
      "RULE_ASSESSOR_CLASH",
    );

    const high = await createAccepted(admin.token, m, {
      candidateCount: 12,
      assessmentStartDate: "2099-09-15",
      assessmentEndDate: "2099-09-16",
    });
    const high2 = await createAccepted(admin.token, m, {
      candidateCount: 15,
      assessmentStartDate: "2099-09-15",
      assessmentEndDate: "2099-09-16",
    });
    const quietAsr = await createAssessor(admin.token);
    expect((await assign(admin.token, high.id, { assessorId: quietAsr.id })).status).toBe(200);
    const quiet = await assign(admin.token, high2.id, { assessorId: quietAsr.id });
    expect(quiet.status).toBe(200);
    expect(quiet.body.warnings).toBeUndefined();
  });

  it("requires lateReason after assignDueAt and records the breach", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const batch = await createAccepted(admin.token, m);
    await Batch.updateOne(
      { _id: batch.id },
      { $set: { "sla.assignDueAt": new Date("2020-01-01T00:00:00.000Z") } },
    );
    const assessor = await createAssessor(admin.token);
    expectError(
      await assign(admin.token, batch.id, { assessorId: assessor.id }),
      409,
      "SLA_ASSIGN_EXPIRED",
    );
    const late = await assign(admin.token, batch.id, {
      assessorId: assessor.id,
      lateReason: "Assessor travel clearance delayed",
    });
    expect(late.status, JSON.stringify(late.body)).toBe(200);
    expect(late.body.sla.breached).toContain("assign");
    expect(await AuditLog.countDocuments({ action: "sla_late_assign" })).toBe(1);
  });

  it("lets only aa_admin assign and rejects an illegal status", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const mis = await sessionFor("mis");
    const created = await request(app)
      .post("/api/v1/batches")
      .set(bearer(admin.token))
      .send(batchBody(m));
    const assessor = await createAssessor(admin.token);
    expectError(
      await assign(mis.token, created.body.id, { assessorId: assessor.id }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await assign(admin.token, created.body.id, { assessorId: assessor.id }),
      409,
      "INVALID_TRANSITION",
    );
  });

  it("cannot let two concurrent assigns both take a different-centre lock", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const assessor = await createAssessor(admin.token);
    const a = await createAccepted(admin.token, m);
    const b = await createAccepted(admin.token, m, { centreId: String(m.otherCentre._id) });
    const [first, second] = await Promise.all([
      assign(admin.token, a.id, { assessorId: assessor.id }),
      assign(admin.token, b.id, { assessorId: assessor.id }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const failed = first.status === 409 ? first : second;
    expect(failed.body.error.code).toBe("RULE_ASSESSOR_CLASH");
    const locks = await AssessorDayLock.find({ assessorId: assessor.id }).lean();
    const centres = new Set(locks.map((lock) => String(lock.centreId)));
    expect(centres.size).toBe(1);
    const assigned = await Batch.countDocuments({
      _id: { $in: [a.id, b.id] },
      status: "assessor_assigned",
    });
    expect(assigned).toBe(1);
  });

  it("releases locks on cancel in the same path", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const assessor = await createAssessor(admin.token);
    const batch = await createAccepted(admin.token, m);
    expect((await assign(admin.token, batch.id, { assessorId: assessor.id })).status).toBe(200);
    expect(await AssessorDayLock.countDocuments({ batchIds: batch.id })).toBe(2);
    const cancelled = await request(app)
      .post(`/api/v1/batches/${batch.id}/cancel`)
      .set(bearer(admin.token))
      .send({ reason: "Centre flooded" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(await AssessorDayLock.countDocuments({ batchIds: batch.id })).toBe(0);
    expect(await AssessorDayLock.countDocuments({ assessorId: assessor.id })).toBe(0);
  });

  it("reassign releases the old assessor locks and takes the new ones", async () => {
    const m = await masters();
    const admin = await sessionFor("aa_admin");
    const first = await createAssessor(admin.token);
    const second = await createAssessor(admin.token);
    const batch = await createAccepted(admin.token, m);
    expect((await assign(admin.token, batch.id, { assessorId: first.id })).status).toBe(200);
    const reassigned = await request(app)
      .post(`/api/v1/batches/${batch.id}/reassign`)
      .set(bearer(admin.token))
      .send({ assessorId: second.id, proctorId: null });
    expect(reassigned.status, JSON.stringify(reassigned.body)).toBe(200);
    expect(reassigned.body.assessorId).toBe(second.id);
    expect(reassigned.body.proctorId).toBeNull();
    expect(reassigned.body.status).toBe("assessor_assigned");
    expect(await AssessorDayLock.countDocuments({ assessorId: first.id })).toBe(0);
    const newLocks = await AssessorDayLock.find({ assessorId: second.id }).lean();
    expect(newLocks).toHaveLength(2);
    expect(newLocks.every((lock) => lock.batchIds.map(String).includes(batch.id))).toBe(true);
    expect(await AuditLog.countDocuments({ action: "batch.reassign" })).toBe(1);
  });
});
