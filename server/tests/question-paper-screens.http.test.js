import mongoose from "mongoose";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

// X-10: the four server additions behind the question bank and paper screens.
const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function sessionFor(role) {
  const email = `${role}-${oid()}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const makeQualification = () =>
  Qualification.create({
    code: "QUAL-X10",
    name: "X10 Qualification",
    sector: "Automotive",
    ratioClass: "manufacturing",
    defaultBatchType: "STT",
    passCriteriaMode: "nos_wise",
    passMarkUnit: "percent",
    passMarks: { theory: 60, practical: 70, viva: 60 },
    nos: [
      {
        nosId: "NOS-01",
        code: "N0101",
        name: "One",
        pcs: [{ pcId: "PC-01", code: "PC1.1", name: "a", passMark: 60, maxMark: 100 }],
      },
    ],
  });

const makeQuestion = (qual, over = {}) => {
  const id = oid();
  return Question.create({
    _id: id,
    rootQuestionId: id,
    qualificationId: qual._id,
    nosId: "NOS-01",
    pcId: "PC-01",
    type: "mcq",
    language: "en",
    stem: "SECRET-STEM",
    options: [
      { key: "A", text: "one" },
      { key: "B", text: "two" },
    ],
    correctAnswer: "A",
    marks: 1,
    status: "draft",
    createdBy: oid(),
    ...over,
  });
};

const makePaper = (qual, over = {}) =>
  TestPaper.create({
    qualificationId: qual._id,
    name: "Paper",
    status: "submitted",
    seed: 1,
    rules: { language: "en", quotas: [{ nosId: "NOS-01", count: 1 }] },
    poolHash: "x",
    items: [],
    totalMarks: 0,
    complete: true,
    createdBy: oid(),
    submittedBy: oid(),
    submittedAt: new Date(),
    ...over,
  });

describe("question bank and paper additions (X-10)", () => {
  let qual;
  let admin;
  let sme;
  let reviewer;
  let mis;

  beforeAll(async () => {
    await startMongo();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    qual = await makeQualification();
    admin = await sessionFor("aa_admin");
    sme = await sessionFor("sme");
    reviewer = await sessionFor("ab_reviewer");
    mis = await sessionFor("mis");
  });

  describe("POST /question-bank/questions/:id/submit-for-review", () => {
    it("moves a draft to in_review, audited, and the reviewer can then approve it", async () => {
      const q = await makeQuestion(qual);
      const res = await request(app)
        .post(`/api/v1/question-bank/questions/${q._id}/submit-for-review`)
        .set(bearer(sme.token));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("in_review");
      const audit = await AuditLog.findOne({ action: "question.submit_for_review" }).lean();
      expect(audit).toBeTruthy();
      expect(JSON.stringify(audit)).not.toContain("SECRET-STEM");

      const approved = await request(app)
        .post(`/api/v1/question-bank/questions/${q._id}/approve`)
        .set(bearer(reviewer.token));
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe("approved");
    });

    it("refuses a second submit, an approved question and an older version", async () => {
      const q = await makeQuestion(qual);
      const url = `/api/v1/question-bank/questions/${q._id}/submit-for-review`;
      await request(app).post(url).set(bearer(admin.token)).expect(200);
      const again = await request(app).post(url).set(bearer(admin.token));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("QUESTION_ALREADY_IN_REVIEW");

      const approved = await makeQuestion(qual, { status: "approved" });
      const res = await request(app)
        .post(`/api/v1/question-bank/questions/${approved._id}/submit-for-review`)
        .set(bearer(admin.token));
      expect(res.body.error.code).toBe("QUESTION_ALREADY_APPROVED");

      const old = await makeQuestion(qual, { isLatest: false });
      const res2 = await request(app)
        .post(`/api/v1/question-bank/questions/${old._id}/submit-for-review`)
        .set(bearer(admin.token));
      expect(res2.body.error.code).toBe("QUESTION_NOT_LATEST");
    });

    it("is closed to the reviewer and other roles", async () => {
      const q = await makeQuestion(qual);
      const url = `/api/v1/question-bank/questions/${q._id}/submit-for-review`;
      for (const s of [reviewer, mis]) {
        const res = await request(app).post(url).set(bearer(s.token));
        expect(res.status).toBe(403);
      }
    });
  });

  describe("GET /question-bank/import-template", () => {
    it("returns an .xlsx whose header row is what the import reads", async () => {
      const res = await request(app)
        .get("/api/v1/question-bank/import-template")
        .set(bearer(sme.token))
        .buffer(true)
        .parse((r, cb) => {
          const chunks = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain("question-import-template.xlsx");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      const header = wb.worksheets[0].getRow(1).values.slice(1);
      expect(header).toEqual(
        expect.arrayContaining(["qualification", "nos", "pc", "type", "stem", "marks"]),
      );
    });

    it("is closed to the reviewer", async () => {
      const res = await request(app)
        .get("/api/v1/question-bank/import-template")
        .set(bearer(reviewer.token));
      expect(res.status).toBe(403);
    });
  });

  describe("POST /tests/:id/return", () => {
    it("sends a submitted paper back to draft with a reason; a new submit clears it", async () => {
      const paper = await makePaper(qual);
      const res = await request(app)
        .post(`/api/v1/tests/${paper._id}/return`)
        .set(bearer(reviewer.token))
        .send({ reason: "Too few viva questions" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("draft");
      expect(res.body.returnReason).toBe("Too few viva questions");
      const audit = await AuditLog.findOne({ action: "test.return" }).lean();
      expect(audit).toBeTruthy();
      expect(JSON.stringify(audit)).not.toContain("Too few viva questions");

      const submitted = await request(app)
        .post(`/api/v1/tests/${paper._id}/submit`)
        .set(bearer(admin.token));
      expect(submitted.status).toBe(200);
      expect(submitted.body.returnReason).toBeNull();
    });

    it("needs a reason, a submitted paper and the reviewer role", async () => {
      const paper = await makePaper(qual);
      const url = `/api/v1/tests/${paper._id}/return`;
      const noReason = await request(app).post(url).set(bearer(reviewer.token)).send({});
      expect(noReason.status).toBe(400);
      const wrongRole = await request(app).post(url).set(bearer(admin.token)).send({ reason: "x" });
      expect(wrongRole.status).toBe(403);

      const draft = await makePaper(qual, { status: "draft" });
      const res = await request(app)
        .post(`/api/v1/tests/${draft._id}/return`)
        .set(bearer(reviewer.token))
        .send({ reason: "x" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TEST_NOT_SUBMITTED");

      const approved = await makePaper(qual, { status: "approved" });
      const res2 = await request(app)
        .post(`/api/v1/tests/${approved._id}/return`)
        .set(bearer(reviewer.token))
        .send({ reason: "x" });
      expect(res2.body.error.code).toBe("TEST_ALREADY_APPROVED");
    });
  });

  describe("GET /qualifications for sme", () => {
    it("lets an SME read the qualification list so the screens can offer a choice", async () => {
      const res = await request(app).get("/api/v1/qualifications").set(bearer(sme.token));
      expect(res.status).toBe(200);
      expect(res.body.items.map((i) => i.code)).toContain("QUAL-X10");
    });
  });
});
