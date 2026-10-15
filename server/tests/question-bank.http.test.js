import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function sessionFor(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function createSampleQualification(code = "QUAL-AUTO-01") {
  return Qualification.create({
    code,
    name: "Automotive Service Technician",
    sector: "Automotive",
    ratioClass: "manufacturing",
    defaultBatchType: "STT",
    passCriteriaMode: "nos_wise",
    passMarkUnit: "percent",
    passMarks: { theory: 60, practical: 70, viva: 60 },
    nos: [
      {
        nosId: "NOS-01",
        code: "ASC/N0101",
        name: "Engine Maintenance",
        pcs: [
          { pcId: "PC-01", code: "PC1.1", name: "Inspect engine oil", passMark: 60, maxMark: 100 },
          { pcId: "PC-02", code: "PC1.2", name: "Replace spark plugs", passMark: 60, maxMark: 100 },
        ],
      },
      {
        nosId: "NOS-02",
        code: "ASC/N0102",
        name: "Electrical Systems",
        pcs: [
          {
            pcId: "PC-03",
            code: "PC2.1",
            name: "Check battery voltage",
            passMark: 60,
            maxMark: 100,
          },
        ],
      },
    ],
  });
}

async function buildSampleWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    ws.addRow(headers);
    for (const r of rows) {
      ws.addRow(headers.map((h) => r[h]));
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("Question Bank API (server/src/modules/question-bank)", () => {
  let qual;
  let adminSession;
  let smeSession;
  let reviewerSession;
  let candidateSession;
  let tpSession;
  let misSession;

  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Question.syncIndexes(),
      Qualification.syncIndexes(),
      AuditLog.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await stopMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    qual = await createSampleQualification();
    adminSession = await sessionFor("aa_admin");
    smeSession = await sessionFor("sme");
    reviewerSession = await sessionFor("ab_reviewer");
    candidateSession = await sessionFor("candidate");
    tpSession = await sessionFor("tp");
    misSession = await sessionFor("mis");
  });

  describe("CRUD and Versioning", () => {
    it("creates an MCQ question in draft status (v1) and records audit with redacted content", async () => {
      const payload = {
        qualificationId: String(qual._id),
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        difficulty: "medium",
        bloomLevel: "apply",
        stem: "What is the recommended viscosity index for cold-weather engine starts?",
        options: [
          { key: "A", text: "5W-30" },
          { key: "B", text: "20W-50" },
          { key: "C", text: "SAE 90" },
          { key: "D", text: "10W-40" },
        ],
        correctAnswer: "A",
        marks: 2,
      };

      const res = await request(app)
        .post("/api/v1/question-bank/questions")
        .set(bearer(smeSession.token))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        difficulty: "medium",
        marks: 2,
        status: "draft",
        version: 1,
        isLatest: true,
      });
      expect(res.body._id).toBeDefined();
      expect(String(res.body.rootQuestionId)).toBe(String(res.body._id));

      // Check audit log: must exist, and question text must NOT be logged in full
      const audit = await AuditLog.findOne({
        action: "question.create",
        entityId: res.body._id,
      }).lean();
      expect(audit).toBeDefined();
      const auditJson = JSON.stringify(audit);
      expect(auditJson).not.toContain(
        "What is the recommended viscosity index for cold-weather engine starts?",
      );
      expect(auditJson).toContain("[redacted]");
    });

    it("creates non-MCQ questions (short_answer, viva, practical) with no mandatory options", async () => {
      const payload = {
        qualificationId: String(qual._id),
        nosId: "NOS-02",
        pcId: "PC-03",
        type: "viva",
        language: "hi",
        stem: "Demonstrate battery voltage test procedure using digital multimeter.",
        marks: 10,
      };

      const res = await request(app)
        .post("/api/v1/question-bank/questions")
        .set(bearer(adminSession.token))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("viva");
      expect(res.body.language).toBe("hi");
      expect(res.body.marks).toBe(10);
    });

    it("reads a single question by id and lists questions with filters and pagination", async () => {
      const q1 = await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        stem: "Question 1",
        options: [
          { key: "A", text: "Yes" },
          { key: "B", text: "No" },
        ],
        correctAnswer: "A",
        marks: 1,
        status: "draft",
        version: 1,
        isLatest: true,
        createdBy: smeSession.userId,
      });
      q1.rootQuestionId = q1._id;
      await q1.save();

      const q2 = await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-01",
        pcId: "PC-02",
        type: "short_answer",
        language: "en",
        stem: "Question 2",
        marks: 3,
        status: "approved",
        version: 1,
        isLatest: true,
        createdBy: smeSession.userId,
      });
      q2.rootQuestionId = q2._id;
      await q2.save();

      // Read single
      const getRes = await request(app)
        .get(`/api/v1/question-bank/questions/${q1._id}`)
        .set(bearer(smeSession.token));
      expect(getRes.status).toBe(200);
      expect(getRes.body.stem).toBe("Question 1");

      // List all
      const listRes = await request(app)
        .get("/api/v1/question-bank/questions")
        .set(bearer(reviewerSession.token));
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(2);
      expect(listRes.body.items.length).toBe(2);

      // List with filter: status=approved
      const filterRes = await request(app)
        .get("/api/v1/question-bank/questions?status=approved")
        .set(bearer(adminSession.token));
      expect(filterRes.status).toBe(200);
      expect(filterRes.body.total).toBe(1);
      expect(filterRes.body.items[0]._id).toBe(String(q2._id));

      // List with filter: pc=PC-01
      const pcRes = await request(app)
        .get("/api/v1/question-bank/questions?pc=PC-01")
        .set(bearer(smeSession.token));
      expect(pcRes.status).toBe(200);
      expect(pcRes.body.total).toBe(1);
      expect(pcRes.body.items[0]._id).toBe(String(q1._id));
    });

    it("updates a question: creates a new version, preserves old version with isLatest=false", async () => {
      const v1 = await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        stem: "Original stem",
        options: [
          { key: "A", text: "Alpha" },
          { key: "B", text: "Beta" },
        ],
        correctAnswer: "A",
        marks: 1,
        status: "approved",
        version: 1,
        isLatest: true,
        createdBy: smeSession.userId,
      });
      v1.rootQuestionId = v1._id;
      await v1.save();

      const updateRes = await request(app)
        .put(`/api/v1/question-bank/questions/${v1._id}`)
        .set(bearer(smeSession.token))
        .send({
          stem: "Updated stem for version 2",
          marks: 2,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.version).toBe(2);
      expect(updateRes.body.stem).toBe("Updated stem for version 2");
      expect(updateRes.body.marks).toBe(2);
      expect(updateRes.body.status).toBe("draft");
      expect(updateRes.body.isLatest).toBe(true);
      expect(String(updateRes.body.previousVersionId)).toBe(String(v1._id));
      expect(String(updateRes.body.rootQuestionId)).toBe(String(v1._id));

      // Verify old version is kept in the database
      const v1Doc = await Question.findById(v1._id).lean();
      expect(v1Doc).toBeDefined();
      expect(v1Doc.version).toBe(1);
      expect(v1Doc.isLatest).toBe(false);
      expect(v1Doc.stem).toBe("Original stem");

      // Verify audit logged update without full question text
      const updateAudit = await AuditLog.findOne({
        action: "question.update",
        entityId: updateRes.body._id,
      }).lean();
      expect(updateAudit).toBeDefined();
      expect(JSON.stringify(updateAudit)).not.toContain("Updated stem for version 2");
    });

    it("retires a question (never hard deletes) and blocks further updates", async () => {
      const q = await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        stem: "Retire me",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
        ],
        correctAnswer: "A",
        marks: 1,
        status: "draft",
        version: 1,
        isLatest: true,
        createdBy: adminSession.userId,
      });

      const retireRes = await request(app)
        .post(`/api/v1/question-bank/questions/${q._id}/retire`)
        .set(bearer(adminSession.token));

      expect(retireRes.status).toBe(200);
      expect(retireRes.body.status).toBe("retired");
      expect(retireRes.body.retiredAt).toBeDefined();

      // Document still exists in database
      const doc = await Question.findById(q._id).lean();
      expect(doc).toBeDefined();
      expect(doc.status).toBe("retired");

      // Attempting to update a retired question returns 409
      const tryUpdate = await request(app)
        .put(`/api/v1/question-bank/questions/${q._id}`)
        .set(bearer(adminSession.token))
        .send({ marks: 5 });
      expect(tryUpdate.status).toBe(409);
    });

    it("allows ab_reviewer and aa_admin to approve a question", async () => {
      const q = await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        stem: "Approve me",
        options: [
          { key: "A", text: "1" },
          { key: "B", text: "2" },
        ],
        correctAnswer: "A",
        marks: 1,
        status: "draft",
        version: 1,
        isLatest: true,
        createdBy: smeSession.userId,
      });

      // SME cannot approve (403)
      const smeTry = await request(app)
        .post(`/api/v1/question-bank/questions/${q._id}/approve`)
        .set(bearer(smeSession.token));
      expect(smeTry.status).toBe(403);

      // ab_reviewer can approve
      const approveRes = await request(app)
        .post(`/api/v1/question-bank/questions/${q._id}/approve`)
        .set(bearer(reviewerSession.token));
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe("approved");
      expect(approveRes.body.approvedAt).toBeDefined();
      expect(String(approveRes.body.approvedBy)).toBe(String(reviewerSession.userId));
    });
  });

  describe("Role guards and Security", () => {
    it("strictly refuses candidate, tp, mis, and assessor access to question content", async () => {
      const q = await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-01",
        pcId: "PC-01",
        type: "mcq",
        language: "en",
        stem: "Confidential Exam Question",
        options: [
          { key: "A", text: "Secret Answer" },
          { key: "B", text: "Wrong" },
        ],
        correctAnswer: "A",
        marks: 1,
        status: "approved",
        version: 1,
        isLatest: true,
        createdBy: adminSession.userId,
      });

      // Candidate
      expect(
        (
          await request(app)
            .get(`/api/v1/question-bank/questions/${q._id}`)
            .set(bearer(candidateSession.token))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get("/api/v1/question-bank/questions")
            .set(bearer(candidateSession.token))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/api/v1/question-bank/questions")
            .set(bearer(candidateSession.token))
            .send({ stem: "X" })
        ).status,
      ).toBe(403);

      // Training Partner
      expect(
        (
          await request(app)
            .get(`/api/v1/question-bank/questions/${q._id}`)
            .set(bearer(tpSession.token))
        ).status,
      ).toBe(403);
      expect(
        (await request(app).get("/api/v1/question-bank/questions").set(bearer(tpSession.token)))
          .status,
      ).toBe(403);

      // MIS
      expect(
        (
          await request(app)
            .get(`/api/v1/question-bank/questions/${q._id}`)
            .set(bearer(misSession.token))
        ).status,
      ).toBe(403);
      expect(
        (await request(app).get("/api/v1/question-bank/questions").set(bearer(misSession.token)))
          .status,
      ).toBe(403);
    });

    it("rejects national-id style fields on write endpoints", async () => {
      const res = await request(app)
        .post("/api/v1/question-bank/questions")
        .set(bearer(adminSession.token))
        .send({
          qualificationId: String(qual._id),
          nosId: "NOS-01",
          pcId: "PC-01",
          type: "mcq",
          language: "en",
          stem: "Identify test",
          options: [
            { key: "A", text: "1" },
            { key: "B", text: "2" },
          ],
          correctAnswer: "A",
          marks: 1,
          aadhaar: "123412341234",
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("National ID fields are not permitted");
    });
  });

  describe("Coverage Endpoint", () => {
    it("reports question counts per PC and flags PCs with fewer than 5 approved questions", async () => {
      // Seed 5 approved questions for PC-01
      for (let i = 1; i <= 5; i++) {
        await Question.create({
          qualificationId: qual._id,
          nosId: "NOS-01",
          pcId: "PC-01",
          type: "short_answer",
          language: "en",
          stem: `Engine Oil Q${i}`,
          marks: 1,
          status: "approved",
          version: 1,
          isLatest: true,
          createdBy: adminSession.userId,
        });
      }

      // Seed 2 approved questions for PC-02 (fewer than 5 -> will be flagged)
      for (let i = 1; i <= 2; i++) {
        await Question.create({
          qualificationId: qual._id,
          nosId: "NOS-01",
          pcId: "PC-02",
          type: "short_answer",
          language: "en",
          stem: `Spark Plug Q${i}`,
          marks: 1,
          status: "approved",
          version: 1,
          isLatest: true,
          createdBy: adminSession.userId,
        });
      }

      // Seed 1 draft question for PC-03 (draft must not count towards approved count)
      await Question.create({
        qualificationId: qual._id,
        nosId: "NOS-02",
        pcId: "PC-03",
        type: "short_answer",
        language: "en",
        stem: "Battery draft",
        marks: 1,
        status: "draft",
        version: 1,
        isLatest: true,
        createdBy: adminSession.userId,
      });

      const res = await request(app)
        .get(`/api/v1/question-bank/coverage/${qual._id}`)
        .set(bearer(reviewerSession.token));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        qualificationId: String(qual._id),
        qualificationCode: qual.code,
        totalPCs: 3,
        totalApprovedQuestions: 7,
        flaggedPcsCount: 2, // PC-02 (2) and PC-03 (0) have < 5
      });

      const pc01 = res.body.pcs.find((p) => p.pcId === "PC-01");
      expect(pc01).toMatchObject({
        approvedQuestionCount: 5,
        flagged: false,
      });

      const pc02 = res.body.pcs.find((p) => p.pcId === "PC-02");
      expect(pc02).toMatchObject({
        approvedQuestionCount: 2,
        flagged: true,
      });

      const pc03 = res.body.pcs.find((p) => p.pcId === "PC-03");
      expect(pc03).toMatchObject({
        approvedQuestionCount: 0,
        flagged: true,
      });
    });
  });

  describe("Excel (.xlsx) Import", () => {
    it("imports nothing if any row fails unless partial=true", async () => {
      const rows = [
        {
          qualification: qual.code,
          nos: "NOS-01",
          pc: "PC-01",
          type: "mcq",
          language: "en",
          stem: "Row 1 Valid Question",
          marks: 1,
          optionA: "Option 1",
          optionB: "Option 2",
          correctAnswer: "A",
        },
        {
          qualification: qual.code,
          nos: "NON_EXISTENT_NOS", // Error here
          pc: "PC-01",
          type: "mcq",
          language: "en",
          stem: "Row 2 Bad NOS",
          marks: 1,
          optionA: "Option 1",
          optionB: "Option 2",
          correctAnswer: "A",
        },
      ];

      const excelBuffer = await buildSampleWorkbook(rows);

      // Call import without partial=true
      const failRes = await request(app)
        .post("/api/v1/question-bank/import")
        .set(bearer(smeSession.token))
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(excelBuffer);

      expect(failRes.status).toBe(400);
      expect(failRes.body).toMatchObject({
        success: false,
        code: "IMPORT_VALIDATION_FAILED",
        totalRows: 2,
        errorCount: 1,
        importedCount: 0,
      });
      expect(failRes.body.errors[0].row).toBe(3); // 2nd data row is row 3 in sheet

      // Database should have 0 questions imported
      expect(await Question.countDocuments()).toBe(0);

      // Now call import with partial=true
      const partialRes = await request(app)
        .post("/api/v1/question-bank/import?partial=true")
        .set(bearer(smeSession.token))
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(excelBuffer);

      expect(partialRes.status).toBe(201);
      expect(partialRes.body).toMatchObject({
        success: true,
        totalRows: 2,
        importedCount: 1,
        errorCount: 1,
      });

      // Exactly 1 question imported
      expect(await Question.countDocuments()).toBe(1);
      const imported = await Question.findOne({ stem: "Row 1 Valid Question" });
      expect(imported).toBeDefined();
      expect(imported.status).toBe("draft");
    });

    it("rejects files larger than 5 MB with 400 FILE_TOO_LARGE", async () => {
      const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);
      // PK magic bytes
      largeBuffer[0] = 0x50;
      largeBuffer[1] = 0x4b;
      largeBuffer[2] = 0x03;
      largeBuffer[3] = 0x04;

      const res = await request(app)
        .post("/api/v1/question-bank/import")
        .set(bearer(smeSession.token))
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(largeBuffer);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FILE_TOO_LARGE");
    });

    it("rejects non-.xlsx files with 400 INVALID_FILE_TYPE", async () => {
      const csvBuffer = Buffer.from("qualification,nos,pc\nQUAL-1,NOS-1,PC-1");

      const res = await request(app)
        .post("/api/v1/question-bank/import")
        .set(bearer(smeSession.token))
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(csvBuffer);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_FILE_TYPE");
    });

    it("rejects workbooks containing macros with 400 MACROS_NOT_ALLOWED", async () => {
      const baseBuffer = await buildSampleWorkbook([
        {
          qualification: qual.code,
          nos: "NOS-01",
          pc: "PC-01",
          stem: "Q1",
          marks: 1,
          type: "short_answer",
          language: "en",
        },
      ]);
      const macroBuffer = Buffer.concat([baseBuffer, Buffer.from("xl/vbaProject.bin")]);

      const res = await request(app)
        .post("/api/v1/question-bank/import")
        .set(bearer(smeSession.token))
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(macroBuffer);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MACROS_NOT_ALLOWED");
    });

    it("rejects workbooks containing external links with 400 EXTERNAL_LINKS_NOT_ALLOWED", async () => {
      const baseBuffer = await buildSampleWorkbook([
        {
          qualification: qual.code,
          nos: "NOS-01",
          pc: "PC-01",
          stem: "Q1",
          marks: 1,
          type: "short_answer",
          language: "en",
        },
      ]);
      const linkBuffer = Buffer.concat([
        baseBuffer,
        Buffer.from("xl/externalLinks/externalLink1.xml"),
      ]);

      const res = await request(app)
        .post("/api/v1/question-bank/import")
        .set(bearer(smeSession.token))
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .send(linkBuffer);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EXTERNAL_LINKS_NOT_ALLOWED");
    });

    it("rejects import exceeding 5,000 rows with 400 ROW_LIMIT_EXCEEDED", async () => {
      const tooManyRows = new Array(5001).fill(null).map((_, i) => ({
        qualification: qual.code,
        nos: "NOS-01",
        pc: "PC-01",
        stem: `Question ${i}`,
        marks: 1,
        type: "short_answer",
        language: "en",
      }));

      const res = await request(app)
        .post("/api/v1/question-bank/import")
        .set(bearer(smeSession.token))
        .send({ rows: tooManyRows });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ROW_LIMIT_EXCEEDED");
    });
  });
});
