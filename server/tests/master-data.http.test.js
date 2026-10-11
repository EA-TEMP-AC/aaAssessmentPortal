import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Centre } from "../src/models/centre.model.js";
import { Learner } from "../src/models/learner.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { TrainingPartner } from "../src/models/training-partner.model.js";
import {
  AWARDING_BODY_READ_ROLES,
  CENTRE_READ_ROLES,
  LEARNER_READ_ROLES,
  MASTER_DATA_WRITE_ROLES,
  QUALIFICATION_READ_ROLES,
  TRAINING_PARTNER_READ_ROLES,
  USER_ROLES,
} from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const learnerKeys = [
  "id",
  "name",
  "externalRef",
  "phone",
  "accommodations",
  "active",
  "createdAt",
  "updatedAt",
];

const percentQualification = {
  code: "Q-ELEC-L4",
  name: "Electrician L4",
  sector: "manufacturing",
  passCriteriaMode: "nos_wise",
  passMarkUnit: "percent",
  passMarks: { theory: 50, practical: 50, viva: 50 },
  maxMarks: null,
  nos: [
    {
      nosId: "NOS-01",
      code: "N01",
      name: "Safety",
      maxMarks: { theory: null, practical: null, viva: null },
      pcs: [{ pcId: "PC-01", code: "P1", name: "PPE" }],
    },
  ],
};

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status).toBe(status);
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

describe("master data", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      AwardingBody.syncIndexes(),
      TrainingPartner.syncIndexes(),
      Centre.syncIndexes(),
      Qualification.syncIndexes(),
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

  it("lets aa_admin and mis create, list, read, and update each collection", async () => {
    const admin = await sessionFor("aa_admin");
    const mis = await sessionFor("mis");

    const ab = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "Sector Skill Council",
        code: "AB-01",
        notificationEmails: ["Notify@AB.example"],
      });
    expect(ab.status).toBe(201);
    expect(ab.body).toMatchObject({
      name: "Sector Skill Council",
      code: "AB-01",
      notificationEmails: ["notify@ab.example"],
      active: true,
    });

    const tp = await request(app).post("/api/v1/training-partners").set(bearer(admin.token)).send({
      name: "North Partner",
      code: "TP-01",
      email: "Partner@Example.com",
    });
    expect(tp.status).toBe(201);
    expect(tp.body.email).toBe("partner@example.com");

    const centre = await request(app).post("/api/v1/centres").set(bearer(mis.token)).send({
      name: "North Centre",
      code: "CTR-01",
      tpId: tp.body.id,
    });
    expect(centre.status).toBe(201);
    expect(centre.body.tpId).toBe(tp.body.id);

    const qualification = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send(percentQualification);
    expect(qualification.status).toBe(201);
    expect(qualification.body).toMatchObject({
      ...percentQualification,
      defaultBatchType: null,
      pcPassMarksRequired: false,
      nos: [
        {
          ...percentQualification.nos[0],
          pcs: [{ pcId: "PC-01", code: "P1", name: "PPE", passMark: null, maxMark: null }],
        },
      ],
    });

    const learner = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({
        name: "Asha Devi",
        externalRef: "TP-REG-10021",
        phone: "9000000001",
        accommodations: ["extra time"],
        active: true,
      });
    expect(learner.status).toBe(201);
    expect(Object.keys(learner.body).sort()).toEqual([...learnerKeys].sort());
    expect(learner.body).toMatchObject({
      name: "Asha Devi",
      externalRef: "TP-REG-10021",
      phone: "9000000001",
      accommodations: ["extra time"],
      active: true,
    });
    expect(JSON.stringify(learner.body)).not.toMatch(/aadhaar/i);

    const listed = await request(app)
      .get("/api/v1/learners?page=1&pageSize=20")
      .set(bearer(mis.token));
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(listed.body.items).toEqual([learner.body]);

    const fetched = await request(app)
      .get(`/api/v1/learners/${learner.body.id}`)
      .set(bearer(mis.token));
    expect(fetched.body).toEqual(learner.body);

    const patched = await request(app)
      .patch(`/api/v1/learners/${learner.body.id}`)
      .set(bearer(mis.token))
      .send({ name: "Asha D.", active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe("Asha D.");
    expect(patched.body.active).toBe(false);

    const createAudit = await AuditLog.findOne({ action: "learner.create" }).lean();
    expect(createAudit.actorRole).toBe("aa_admin");
    expect(createAudit.entity).toBe("learner");
    expect(createAudit.entityId).toBe(learner.body.id);
    expect(createAudit.after.name).toBe("Asha Devi");

    const updateAudit = await AuditLog.findOne({ action: "learner.update" }).lean();
    expect(updateAudit.actorRole).toBe("mis");
    expect(updateAudit.before.name).toBe("Asha Devi");
    expect(updateAudit.after.name).toBe("Asha D.");

    const abAudit = await AuditLog.findOne({ action: "awardingBody.create" }).lean();
    expect(abAudit.entity).toBe("awardingBody");
    expect(String(abAudit.abId)).toBe(ab.body.id);
    expect(abAudit.after.code).toBe("AB-01");
  });

  it("paginates list endpoints", async () => {
    const admin = await sessionFor("aa_admin");
    for (const name of ["One", "Two", "Three"]) {
      const created = await request(app)
        .post("/api/v1/learners")
        .set(bearer(admin.token))
        .send({ name });
      expect(created.status).toBe(201);
    }
    const page = await request(app)
      .get("/api/v1/learners?page=2&pageSize=2")
      .set(bearer(admin.token));
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(3);
    expect(page.body.items).toHaveLength(1);
  });

  it("returns 409 for duplicate codes, emails, and learner external refs", async () => {
    const admin = await sessionFor("aa_admin");
    const firstAb = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "AB One",
        code: "AB-01",
        notificationEmails: ["one@ab.example"],
      });
    expect(firstAb.status).toBe(201);

    const duplicateCode = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "AB Two",
        code: "AB-01",
        notificationEmails: ["two@ab.example"],
      });
    expectError(duplicateCode, 409, "DUPLICATE_RESOURCE");

    const duplicateEmail = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "AB Three",
        code: "AB-03",
        notificationEmails: ["ONE@ab.example"],
      });
    expectError(duplicateEmail, 409, "DUPLICATE_RESOURCE");

    const partner = await request(app)
      .post("/api/v1/training-partners")
      .set(bearer(admin.token))
      .send({ name: "Partner", code: "TP-01", email: "tp@example.com" });
    expect(partner.status).toBe(201);
    const duplicatePartnerEmail = await request(app)
      .post("/api/v1/training-partners")
      .set(bearer(admin.token))
      .send({ name: "Other", code: "TP-02", email: "TP@example.com" });
    expectError(duplicatePartnerEmail, 409, "DUPLICATE_RESOURCE");

    const qualification = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send(percentQualification);
    expect(qualification.status).toBe(201);
    const duplicateQualification = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send({ ...percentQualification, name: "Copy" });
    expectError(duplicateQualification, 409, "DUPLICATE_RESOURCE");

    const learner = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({ name: "Asha", externalRef: "TP-REG-10021" });
    expect(learner.status).toBe(201);
    const duplicateLearner = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({ name: "Other", externalRef: "TP-REG-10021" });
    expectError(duplicateLearner, 409, "DUPLICATE_RESOURCE");

    const kept = await request(app)
      .patch(`/api/v1/learners/${learner.body.id}`)
      .set(bearer(admin.token))
      .send({ externalRef: "TP-REG-10021" });
    expect(kept.status).toBe(200);
  });

  it("rejects invalid bodies and invalid pass-mark structures", async () => {
    const admin = await sessionFor("aa_admin");
    const missing = await request(app).post("/api/v1/learners").set(bearer(admin.token)).send({});
    expectError(missing, 400, "VALIDATION_ERROR");

    const aadhaar = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({ name: "Asha", aadhaar: "123412341234" });
    expectError(aadhaar, 400, "VALIDATION_ERROR");
    const email = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({ name: "Asha", email: "asha@example.com" });
    expectError(email, 400, "VALIDATION_ERROR");
    expect(await Learner.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: "learner.create" })).toBe(0);

    const absolute = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send({
        ...percentQualification,
        code: "Q-ABS",
        passMarkUnit: "absolute",
        passMarks: { theory: 80, practical: 10, viva: 10 },
        maxMarks: { theory: 50, practical: 50, viva: 50 },
      });
    expectError(absolute, 400, "RESULT_PASS_MARK_INVALID");

    const noCeiling = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send({
        ...percentQualification,
        code: "Q-NO-MAX",
        passMarkUnit: "absolute",
        passMarks: { theory: 10, practical: 10, viva: 10 },
        maxMarks: null,
      });
    expectError(noCeiling, 400, "RESULT_PASS_MARK_INVALID");

    const percent = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send({
        ...percentQualification,
        code: "Q-HIGH",
        passMarks: { theory: 120, practical: 50, viva: 50 },
      });
    expectError(percent, 400, "RESULT_PASS_MARK_INVALID");

    const missingPc = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send({ ...percentQualification, code: "Q-PC", pcPassMarksRequired: true });
    expectError(missingPc, 400, "RESULT_PASS_MARK_INVALID");

    const created = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send(percentQualification);
    expect(created.status).toBe(201);
    const broken = await request(app)
      .patch(`/api/v1/qualifications/${created.body.id}`)
      .set(bearer(admin.token))
      .send({ passMarkUnit: "absolute" });
    expectError(broken, 400, "RESULT_PASS_MARK_INVALID");
    const still = await request(app)
      .get(`/api/v1/qualifications/${created.body.id}`)
      .set(bearer(admin.token));
    expect(still.body.passMarkUnit).toBe("percent");

    const missingPartner = await request(app)
      .post("/api/v1/centres")
      .set(bearer(admin.token))
      .send({
        name: "Orphan",
        tpId: "66f0000000000000000000aa",
      });
    expectError(missingPartner, 400, "VALIDATION_ERROR");
  });

  it("forbids roles that the matrix does not allow to read or write", async () => {
    const samples = [
      { path: "/api/v1/awarding-bodies", readers: AWARDING_BODY_READ_ROLES, body: { name: "X" } },
      {
        path: "/api/v1/training-partners",
        readers: TRAINING_PARTNER_READ_ROLES,
        body: { name: "X" },
      },
      {
        path: "/api/v1/centres",
        readers: CENTRE_READ_ROLES,
        body: { name: "X", tpId: "66f0000000000000000000aa" },
      },
      { path: "/api/v1/qualifications", readers: QUALIFICATION_READ_ROLES, body: { name: "X" } },
      { path: "/api/v1/learners", readers: LEARNER_READ_ROLES, body: { name: "X" } },
    ];

    for (const role of USER_ROLES) {
      const session = await sessionFor(role, { email: `${role}@deny.example` });
      for (const sample of samples) {
        if (!sample.readers.includes(role)) {
          const listed = await request(app).get(sample.path).set(bearer(session.token));
          expectError(listed, 403, "FORBIDDEN");
        }
        if (!MASTER_DATA_WRITE_ROLES.includes(role)) {
          const created = await request(app)
            .post(sample.path)
            .set(bearer(session.token))
            .send(sample.body);
          expectError(created, 403, "FORBIDDEN");
        }
      }
    }

    const anon = await request(app).get("/api/v1/learners");
    expectError(anon, 401, "UNAUTHORIZED");
  });

  it("scopes awarding bodies, partners, centres, and learners to the caller's own rows", async () => {
    const admin = await sessionFor("aa_admin");
    const ownAb = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "Own AB",
        code: "AB-OWN",
        notificationEmails: ["own@ab.example"],
      });
    const otherAb = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "Other AB",
        code: "AB-OTHER",
        notificationEmails: ["other@ab.example"],
      });
    const ownTp = await request(app)
      .post("/api/v1/training-partners")
      .set(bearer(admin.token))
      .send({
        name: "Own TP",
        code: "TP-OWN",
        email: "own.tp@example.com",
      });
    const otherTp = await request(app)
      .post("/api/v1/training-partners")
      .set(bearer(admin.token))
      .send({ name: "Other TP", code: "TP-OTHER", email: "other.tp@example.com" });
    const ownCentre = await request(app).post("/api/v1/centres").set(bearer(admin.token)).send({
      name: "Own Centre",
      code: "CTR-OWN",
      tpId: ownTp.body.id,
    });
    const otherCentre = await request(app).post("/api/v1/centres").set(bearer(admin.token)).send({
      name: "Other Centre",
      code: "CTR-OTHER",
      tpId: otherTp.body.id,
    });
    const ownLearner = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({ name: "Own Learner", externalRef: "OWN-1" });
    const otherLearner = await request(app)
      .post("/api/v1/learners")
      .set(bearer(admin.token))
      .send({ name: "Other Learner", externalRef: "OTHER-1" });
    const qualification = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send(percentQualification);
    expect(ownAb.status).toBe(201);
    expect(qualification.status).toBe(201);

    const reviewer = await sessionFor("ab_reviewer", { abId: ownAb.body.id });
    const reviewerList = await request(app)
      .get("/api/v1/awarding-bodies")
      .set(bearer(reviewer.token));
    expect(reviewerList.body.total).toBe(1);
    expect(reviewerList.body.items[0].id).toBe(ownAb.body.id);
    const reviewerOther = await request(app)
      .get(`/api/v1/awarding-bodies/${otherAb.body.id}`)
      .set(bearer(reviewer.token));
    expectError(reviewerOther, 403, "FORBIDDEN");
    const reviewerQualifications = await request(app)
      .get("/api/v1/qualifications")
      .set(bearer(reviewer.token));
    expect(reviewerQualifications.status).toBe(200);
    expect(reviewerQualifications.body.total).toBe(1);
    const reviewerWrite = await request(app)
      .patch(`/api/v1/awarding-bodies/${ownAb.body.id}`)
      .set(bearer(reviewer.token))
      .send({ name: "Hijack" });
    expectError(reviewerWrite, 403, "FORBIDDEN");

    const tp = await sessionFor("tp", { tpId: ownTp.body.id });
    const tpList = await request(app).get("/api/v1/training-partners").set(bearer(tp.token));
    expect(tpList.body.total).toBe(1);
    expect(tpList.body.items[0].id).toBe(ownTp.body.id);
    const centres = await request(app).get("/api/v1/centres").set(bearer(tp.token));
    expect(centres.body.total).toBe(1);
    expect(centres.body.items[0].id).toBe(ownCentre.body.id);
    const hiddenCentre = await request(app)
      .get(`/api/v1/centres/${otherCentre.body.id}`)
      .set(bearer(tp.token));
    expectError(hiddenCentre, 403, "FORBIDDEN");
    const tpWrite = await request(app)
      .post("/api/v1/centres")
      .set(bearer(tp.token))
      .send({ name: "Extra", tpId: ownTp.body.id });
    expectError(tpWrite, 403, "FORBIDDEN");

    const candidate = await sessionFor("candidate", { linkedProfileId: ownLearner.body.id });
    const learners = await request(app).get("/api/v1/learners").set(bearer(candidate.token));
    expect(learners.body.total).toBe(1);
    expect(learners.body.items[0].id).toBe(ownLearner.body.id);
    const hiddenLearner = await request(app)
      .get(`/api/v1/learners/${otherLearner.body.id}`)
      .set(bearer(candidate.token));
    expectError(hiddenLearner, 403, "FORBIDDEN");
    const missing = await request(app)
      .get("/api/v1/learners/66f0000000000000000000bb")
      .set(bearer(candidate.token));
    expectError(missing, 404, "NOT_FOUND");

    const viewer = await sessionFor("ncvet_viewer");
    const allAbs = await request(app).get("/api/v1/awarding-bodies").set(bearer(viewer.token));
    expect(allAbs.body.total).toBe(2);
    const viewerWrite = await request(app)
      .post("/api/v1/learners")
      .set(bearer(viewer.token))
      .send({ name: "Nope" });
    expectError(viewerWrite, 403, "FORBIDDEN");

    const unlinked = await sessionFor("candidate", { email: "candidate2@aa.example" });
    const empty = await request(app).get("/api/v1/learners").set(bearer(unlinked.token));
    expect(empty.body.total).toBe(0);
    const deniedExisting = await request(app)
      .get(`/api/v1/learners/${ownLearner.body.id}`)
      .set(bearer(unlinked.token));
    expectError(deniedExisting, 403, "FORBIDDEN");
  });

  it("soft-deactivates awarding bodies, partners, and centres, and deletes qualifications", async () => {
    const admin = await sessionFor("aa_admin");
    const ab = await request(app)
      .post("/api/v1/awarding-bodies")
      .set(bearer(admin.token))
      .send({
        name: "AB",
        notificationEmails: ["ops@ab.example"],
      });
    const tp = await request(app)
      .post("/api/v1/training-partners")
      .set(bearer(admin.token))
      .send({ name: "TP", email: "tp.del@example.com" });
    const centre = await request(app)
      .post("/api/v1/centres")
      .set(bearer(admin.token))
      .send({ name: "Centre", tpId: tp.body.id });
    const qualification = await request(app)
      .post("/api/v1/qualifications")
      .set(bearer(admin.token))
      .send(percentQualification);
    expect(qualification.status).toBe(201);

    const removedAb = await request(app)
      .delete(`/api/v1/awarding-bodies/${ab.body.id}`)
      .set(bearer(admin.token));
    expect(removedAb.status).toBe(200);
    expect(removedAb.body.active).toBe(false);
    const removedTp = await request(app)
      .delete(`/api/v1/training-partners/${tp.body.id}`)
      .set(bearer(admin.token));
    expect(removedTp.body.active).toBe(false);
    const removedCentre = await request(app)
      .delete(`/api/v1/centres/${centre.body.id}`)
      .set(bearer(admin.token));
    expect(removedCentre.body.active).toBe(false);

    const centreAudit = await AuditLog.findOne({ action: "centre.deactivate" }).lean();
    expect(centreAudit.before.active).toBe(true);
    expect(centreAudit.after.active).toBe(false);
    expect(centreAudit.entityId).toBe(centre.body.id);

    const reviewer = await sessionFor("ab_reviewer", { abId: ab.body.id });
    const deniedDelete = await request(app)
      .delete(`/api/v1/qualifications/${qualification.body.id}`)
      .set(bearer(reviewer.token));
    expectError(deniedDelete, 403, "FORBIDDEN");

    const removedQualification = await request(app)
      .delete(`/api/v1/qualifications/${qualification.body.id}`)
      .set(bearer(admin.token));
    expect(removedQualification.status).toBe(204);
    const gone = await request(app)
      .get(`/api/v1/qualifications/${qualification.body.id}`)
      .set(bearer(admin.token));
    expectError(gone, 404, "NOT_FOUND");
    const deleteAudit = await AuditLog.findOne({ action: "qualification.delete" }).lean();
    expect(deleteAudit.before.code).toBe("Q-ELEC-L4");
    expect(deleteAudit.entityId).toBe(qualification.body.id);
  });
});
