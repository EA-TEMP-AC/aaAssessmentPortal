import mongoose from "mongoose";
import request from "supertest";
import { vi } from "vitest";
import { createApp } from "../src/app.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { AccessLog } from "../src/models/access-log.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { ContentAnomaly } from "../src/models/content-anomaly.model.js";
import { ContentReadCounter } from "../src/models/content-read-counter.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { TestPaper } from "../src/models/test-paper.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

// The cap under test is small so a few requests reach it. The real number lives in the config file.
const limits = vi.hoisted(() => ({ cap: 5, roleCaps: {} }));
vi.mock("../src/config/content-controls.js", async (importOriginal) => ({
  ...(await importOriginal()),
  contentReadCapFor: (role) => limits.roleCaps[role] ?? limits.cap,
}));

const app = createApp();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const SECRETS = ["SECRET-STEM", "SECRET-OPT", "SECRET-ANSWER"];

async function sessionFor(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id, role };
}

function makeQualification() {
  return Qualification.create({
    code: "QUAL-CC-01",
    name: "Content Controls Qualification",
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
}

let seq = 0;
async function addQuestion(qual) {
  seq += 1;
  const q = new Question({
    qualificationId: qual._id,
    nosId: "NOS-01",
    pcId: "PC-01",
    type: "mcq",
    language: "en",
    stem: `SECRET-STEM-${seq}`,
    options: [
      { key: "A", text: "SECRET-OPT-A" },
      { key: "B", text: "SECRET-OPT-B" },
    ],
    correctAnswer: "SECRET-ANSWER",
    marks: 1,
    status: "approved",
    version: 1,
    isLatest: true,
    createdBy: mongoose.Types.ObjectId.createFromTime(1),
  });
  q.rootQuestionId = q._id;
  await q.save();
  return q;
}

async function addQuestions(qual, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await addQuestion(qual));
  return out;
}

async function makePaper(qual, qs) {
  return TestPaper.create({
    qualificationId: qual._id,
    status: "draft",
    seed: 1,
    rules: { language: "en", quotas: [{ nosId: "NOS-01", count: Math.max(qs.length, 1) }] },
    poolHash: "test-pool",
    totalMarks: qs.length,
    complete: true,
    items: qs.map((q) => ({
      questionId: q._id,
      rootQuestionId: q._id,
      version: 1,
      nosId: "NOS-01",
      pcId: "PC-01",
      type: "mcq",
      marks: 1,
    })),
    createdBy: mongoose.Types.ObjectId.createFromTime(1),
  });
}

function noSecrets(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("Content-theft controls (S-02)", () => {
  let qual;
  let admin;
  let sme;
  let reviewer;

  const list = (session, query = "") =>
    request(app).get(`/api/v1/question-bank/questions${query}`).set(bearer(session.token));
  const detail = (session, id) =>
    request(app).get(`/api/v1/question-bank/questions/${id}`).set(bearer(session.token));

  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Question.syncIndexes(),
      TestPaper.syncIndexes(),
      ContentReadCounter.syncIndexes(),
      ContentAnomaly.syncIndexes(),
    ]);
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    limits.cap = 5;
    limits.roleCaps = {};
    qual = await makeQualification();
    admin = await sessionFor("aa_admin");
    sme = await sessionFor("sme");
    reviewer = await sessionFor("ab_reviewer");
  });

  describe("daily cap", () => {
    it("counts questions read, and refuses with 429 CONTENT_READ_LIMIT above the cap", async () => {
      await addQuestions(qual, 4);

      const first = await list(sme, "?pageSize=3");
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(3);

      const refused = await list(sme, "?pageSize=3");
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe("CONTENT_READ_LIMIT");
      noSecrets(refused.body);

      const counter = await ContentReadCounter.findOne({ userId: sme.userId });
      expect(counter.count).toBe(3);
      expect(counter.day).toBe(istCalendarDate(new Date()));
    });

    it("lets a user read right up to the cap, then refuses one more", async () => {
      await addQuestions(qual, 4);
      expect((await list(sme, "?pageSize=3")).status).toBe(200);
      expect((await list(sme, "?pageSize=2")).status).toBe(200); // 5 of 5
      const over = await list(sme, "?pageSize=1");
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe("CONTENT_READ_LIMIT");
    });

    it("counts a single question detail as one read", async () => {
      const [q] = await addQuestions(qual, 1);
      for (let i = 0; i < 5; i += 1) expect((await detail(sme, q._id)).status).toBe(200);
      const over = await detail(sme, q._id);
      expect(over.status).toBe(429);
      noSecrets(over.body);
    });

    it("counts each user on their own", async () => {
      await addQuestions(qual, 4);
      expect((await list(sme, "?pageSize=4")).status).toBe(200);
      expect((await list(sme, "?pageSize=4")).status).toBe(429);
      expect((await list(reviewer, "?pageSize=4")).status).toBe(200);
      expect((await list(admin, "?pageSize=4")).status).toBe(200);
    });

    it("uses a per-role cap from the config when one is set", async () => {
      limits.roleCaps = { aa_admin: 2 };
      await addQuestions(qual, 4);
      expect((await list(admin, "?pageSize=3")).status).toBe(429);
      expect((await list(sme, "?pageSize=3")).status).toBe(200);
    });

    it("refuses a page bigger than the whole cap, without a counter row", async () => {
      limits.cap = 2;
      await addQuestions(qual, 3);
      const res = await list(sme, "?pageSize=3");
      expect(res.status).toBe(429);
      expect(await ContentReadCounter.countDocuments({ userId: sme.userId })).toBe(0);
      const anomaly = await ContentAnomaly.findOne({ userId: sme.userId });
      expect(anomaly.readCount).toBe(0);
      expect(anomaly.attemptedCount).toBe(3);
    });

    it("does not count empty pages, errors or reads that carry no content", async () => {
      const empty = await list(sme, "?status=retired");
      expect(empty.status).toBe(200);
      expect((await list(sme, "?pageSize=999")).status).toBe(400);
      expect((await request(app).get("/api/v1/tests").set(bearer(sme.token))).status).toBe(200);
      expect(await ContentReadCounter.countDocuments({})).toBe(0);
    });

    it("cannot be beaten by parallel requests", async () => {
      const [q] = await addQuestions(qual, 1);
      const results = await Promise.all(Array.from({ length: 12 }, () => detail(sme, q._id)));
      const ok = results.filter((r) => r.status === 200).length;
      const refused = results.filter((r) => r.status === 429).length;
      expect(ok).toBe(5);
      expect(refused).toBe(7);
      expect((await ContentReadCounter.findOne({ userId: sme.userId })).count).toBe(5);
    });
  });

  describe("anomaly rows", () => {
    async function overCap(session) {
      await addQuestions(qual, 4);
      await list(session, "?pageSize=4");
      return list(session, "?pageSize=4");
    }

    it("records user, role, counts and time, and no content", async () => {
      expect((await overCap(sme)).status).toBe(429);
      const rows = await ContentAnomaly.find({}).lean();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(String(row.userId)).toBe(sme.userId);
      expect(row.role).toBe("sme");
      expect(row.day).toBe(istCalendarDate(new Date()));
      expect(row.cap).toBe(5);
      expect(row.readCount).toBe(4);
      expect(row.attemptedCount).toBe(4);
      expect(row.refusedRequests).toBe(1);
      expect(row.route).toBe("GET /api/v1/question-bank/questions");
      expect(row.firstAt).toBeInstanceOf(Date);
      expect(row.lastAt).toBeInstanceOf(Date);
      noSecrets(row);
      expect(Object.keys(row).sort()).toEqual(
        [
          "__v",
          "_id",
          "attemptedCount",
          "cap",
          "day",
          "firstAt",
          "lastAt",
          "readCount",
          "refusedRequests",
          "role",
          "route",
          "userId",
        ].sort(),
      );
    });

    it("keeps one row per user per day and counts the refusals", async () => {
      await overCap(sme);
      await list(sme, "?pageSize=2");
      await list(sme, "?pageSize=3");
      const rows = await ContentAnomaly.find({ userId: sme.userId }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0].refusedRequests).toBe(3);
      expect(rows[0].attemptedCount).toBe(3);
      expect(rows[0].lastAt.getTime()).toBeGreaterThanOrEqual(rows[0].firstAt.getTime());
    });

    it("writes no row for a user who stays under the cap", async () => {
      await addQuestions(qual, 2);
      await list(sme, "?pageSize=2");
      expect(await ContentAnomaly.countDocuments({})).toBe(0);
    });

    it("is listed for aa_admin at GET /security/content-anomalies", async () => {
      await overCap(sme);
      const res = await request(app)
        .get("/api/v1/security/content-anomalies")
        .set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(res.body.items[0]).toMatchObject({
        userId: sme.userId,
        role: "sme",
        cap: 5,
        readCount: 4,
        attemptedCount: 4,
        refusedRequests: 1,
        route: "GET /api/v1/question-bank/questions",
      });
      noSecrets(res.body);
    });

    it("filters by user and day, and rejects unknown filters", async () => {
      await overCap(sme);
      const other = await request(app)
        .get(`/api/v1/security/content-anomalies?userId=${reviewer.userId}`)
        .set(bearer(admin.token));
      expect(other.body.total).toBe(0);
      const mine = await request(app)
        .get(
          `/api/v1/security/content-anomalies?userId=${sme.userId}&day=${istCalendarDate(new Date())}`,
        )
        .set(bearer(admin.token));
      expect(mine.body.total).toBe(1);
      const bad = await request(app)
        .get("/api/v1/security/content-anomalies?bogus=1")
        .set(bearer(admin.token));
      expect(bad.status).toBe(400);
    });
  });

  describe("role limits", () => {
    it("only aa_admin lists anomalies", async () => {
      for (const role of ["mis", "sme", "ab_reviewer", "ncvet_viewer", "tp", "candidate"]) {
        const session = await sessionFor(role);
        const res = await request(app)
          .get("/api/v1/security/content-anomalies")
          .set(bearer(session.token));
        expect(res.status, role).toBe(403);
      }
      const anon = await request(app).get("/api/v1/security/content-anomalies");
      expect(anon.status).toBe(401);
    });

    it("question and test paper content stays closed to every other role", async () => {
      const [q] = await addQuestions(qual, 1);
      const paper = await makePaper(qual, [q]);
      for (const role of ["mis", "assessor", "proctor", "candidate", "tp", "ncvet_viewer"]) {
        const session = await sessionFor(role);
        const a = await list(session);
        const b = await detail(session, q._id);
        expect(a.status, `list ${role}`).toBe(403);
        expect(b.status, `detail ${role}`).toBe(403);
        noSecrets(a.body);
        noSecrets(b.body);
        {
          const c = await request(app)
            .get(`/api/v1/tests/${paper._id}?withQuestions=true`)
            .set(bearer(session.token));
          expect(c.status, `paper ${role}`).toBe(403);
        }
      }
      expect(await ContentReadCounter.countDocuments({})).toBe(0);
      expect(await AccessLog.countDocuments({ subjectType: "question" })).toBe(0);
    });
  });

  describe("no bulk export", () => {
    it("refuses more than 50 questions per page and allows exactly 50", async () => {
      limits.cap = 1000;
      await addQuestions(qual, 52);
      const over = await list(sme, "?pageSize=51");
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe("VALIDATION_ERROR");
      const exact = await list(sme, "?pageSize=50");
      expect(exact.status).toBe(200);
      expect(exact.body.items).toHaveLength(50);
      expect(exact.body.total).toBe(52);
      const page2 = await list(sme, "?pageSize=50&page=2");
      expect(page2.body.items).toHaveLength(2);
    });

    it("pages the questions of a test paper at 50 a page", async () => {
      limits.cap = 1000;
      const qs = await addQuestions(qual, 60);
      const paper = await makePaper(qual, qs);

      const get = (query) =>
        request(app).get(`/api/v1/tests/${paper._id}${query}`).set(bearer(sme.token));

      const page1 = await get("?withQuestions=true");
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(50);
      expect(page1.body).toMatchObject({ itemPage: 1, itemPageSize: 50, itemTotal: 60 });
      expect(page1.body.items[0].stem).toMatch(/^SECRET-STEM-/);

      const page2 = await get("?withQuestions=true&itemPage=2");
      expect(page2.body.items).toHaveLength(10);
      expect(page2.body.items.every((i) => i.stem && i.correctAnswer)).toBe(true);

      const ids = new Set([...page1.body.items, ...page2.body.items].map((i) => i.questionId));
      expect(ids.size).toBe(60);

      // Without text the paper stays ids only and is not paged.
      const plain = await get("");
      expect(plain.status).toBe(200);
      expect(plain.body.items).toHaveLength(60);
      expect(plain.body.items[0].stem).toBeUndefined();

      // Reading a paper counts the questions it carried.
      expect((await ContentReadCounter.findOne({ userId: sme.userId })).count).toBe(60);
    });

    it("a paper read over the cap is refused with no question text", async () => {
      const qs = await addQuestions(qual, 6);
      const paper = await makePaper(qual, qs);
      const res = await request(app)
        .get(`/api/v1/tests/${paper._id}?withQuestions=true`)
        .set(bearer(sme.token));
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("CONTENT_READ_LIMIT");
      noSecrets(res.body);
      expect(await AccessLog.countDocuments({})).toBe(0);
      expect(await ContentAnomaly.countDocuments({ userId: sme.userId })).toBe(1);
    });
  });

  describe("access log", () => {
    it("records question list and detail reads as `question` rows", async () => {
      const qs = await addQuestions(qual, 3);
      await list(sme, "?pageSize=3");
      await detail(reviewer, qs[0]._id);

      const listRows = await AccessLog.find({ subjectType: "question", kind: "list" }).lean();
      expect(listRows).toHaveLength(3);
      expect(new Set(listRows.map((r) => r.subjectId))).toEqual(
        new Set(qs.map((q) => String(q._id))),
      );
      expect(listRows[0]).toMatchObject({
        actorRole: "sme",
        fields: ["stem", "options", "correctAnswer"],
        route: "GET /api/v1/question-bank/questions",
      });
      expect(new Set(listRows.map((r) => r.requestId)).size).toBe(1);

      const detailRows = await AccessLog.find({ subjectType: "question", kind: "detail" }).lean();
      expect(detailRows).toHaveLength(1);
      expect(detailRows[0]).toMatchObject({
        actorRole: "ab_reviewer",
        subjectId: String(qs[0]._id),
        route: "GET /api/v1/question-bank/questions/:id",
      });
    });

    it("records a test paper read as a `testPaper` row plus its question rows", async () => {
      limits.cap = 100;
      const qs = await addQuestions(qual, 2);
      const paper = await makePaper(qual, qs);

      await request(app).get(`/api/v1/tests/${paper._id}`).set(bearer(sme.token));
      expect(await AccessLog.countDocuments({ subjectType: "testPaper" })).toBe(1);
      expect(await AccessLog.countDocuments({ subjectType: "question" })).toBe(0);
      expect(await ContentReadCounter.countDocuments({})).toBe(0);

      await request(app)
        .get(`/api/v1/tests/${paper._id}?withQuestions=true`)
        .set(bearer(sme.token));
      expect(await AccessLog.countDocuments({ subjectType: "testPaper" })).toBe(2);
      expect(await AccessLog.countDocuments({ subjectType: "question" })).toBe(2);
    });

    it("shows the new subject types to aa_admin through GET /audit/access-log", async () => {
      await addQuestions(qual, 2);
      await list(sme, "?pageSize=2");
      const res = await request(app)
        .get("/api/v1/audit/access-log?subjectType=question")
        .set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      noSecrets(res.body);
      const bad = await request(app)
        .get("/api/v1/audit/access-log?subjectType=testPaper")
        .set(bearer(admin.token));
      expect(bad.status).toBe(200);
    });

    it("writes no access row for a refused read", async () => {
      await addQuestions(qual, 4);
      await list(sme, "?pageSize=4");
      const before = await AccessLog.countDocuments({});
      await list(sme, "?pageSize=4");
      expect(await AccessLog.countDocuments({})).toBe(before);
    });
  });

  describe("no content in logs", () => {
    it("keeps question text out of every log, counter, anomaly and console line", async () => {
      const spies = ["log", "info", "warn", "error", "debug"].map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
      try {
        const qs = await addQuestions(qual, 4);
        await list(sme, "?pageSize=4");
        await list(sme, "?pageSize=4"); // refused
        await detail(reviewer, qs[0]._id);
        // A write that carries question text, for the audit middleware to handle.
        await request(app)
          .put(`/api/v1/question-bank/questions/${qs[1]._id}`)
          .set(bearer(admin.token))
          .send({ stem: "SECRET-STEM-EDITED" });

        const everything = [
          await AccessLog.find({}).lean(),
          await AuditLog.find({}).lean(),
          await ContentAnomaly.find({}).lean(),
          await ContentReadCounter.find({}).lean(),
          spies.flatMap((spy) => spy.mock.calls),
        ];
        noSecrets(everything);
        expect(JSON.stringify(everything)).not.toContain("SECRET-STEM-EDITED");
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });
});
