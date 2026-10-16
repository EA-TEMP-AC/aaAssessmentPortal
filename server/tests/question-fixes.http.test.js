import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { ContentReadCounter } from "../src/models/content-read-counter.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { ReviewReminder } from "../src/models/review-reminder.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { startSlaBreachScheduler } from "../src/modules/batches/sla-breach-job.js";
import {
  queueReviewReminders,
  startReviewReminderScheduler,
} from "../src/modules/question-bank/review-reminder-job.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const base = "/api/v1/question-bank";
const oid = () => new mongoose.Types.ObjectId();

async function sessionFor(role) {
  const email = `${role}-${oid()}@aa.example`;
  const { password } = await createUser({ role, email, name: role });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken };
}

const mcq = (over = {}) => ({
  nosId: "NOS-01",
  pcId: "PC-01",
  type: "mcq",
  language: "en",
  stem: "Which tool?",
  options: [
    { key: "A", text: "Spanner" },
    { key: "B", text: "Hammer" },
  ],
  correctAnswer: "A",
  marks: 1,
  ...over,
});

describe("Question fixes (Q-06)", () => {
  let qual;
  let sme;
  let admin;
  let reviewer;

  const create = (body) =>
    request(app)
      .post(`${base}/questions`)
      .set(bearer(sme.token))
      .send({ ...mcq(), qualificationId: String(qual._id), ...body });

  const put = (id, body, session = sme) =>
    request(app).put(`${base}/questions/${id}`).set(bearer(session.token)).send(body);

  beforeAll(async () => {
    await startMongo();
    await Question.syncIndexes();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    qual = await Qualification.create({
      code: "Q-06-QUAL",
      name: "Fitter",
      sector: "Automotive",
      ratioClass: "manufacturing",
      defaultBatchType: "STT",
      passCriteriaMode: "nos_wise",
      passMarkUnit: "percent",
      passMarks: { theory: 60, practical: 70, viva: 60 },
      nos: [
        {
          nosId: "NOS-01",
          code: "N1",
          name: "Nos one",
          pcs: [{ pcId: "PC-01", code: "PC1", name: "Pc one", passMark: 60, maxMark: 100 }],
        },
      ],
    });
    sme = await sessionFor("sme");
    admin = await sessionFor("aa_admin");
    reviewer = await sessionFor("ab_reviewer");
  });

  describe("MCQ correct answer is stored as the option key", () => {
    it("create: option text (any case) is saved as the key", async () => {
      const res = await create({ correctAnswer: "  hammer " });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.correctAnswer).toBe("B");
    });

    it("create: a lower-case key is saved as the option's own key", async () => {
      const res = await create({ correctAnswer: "a" });
      expect(res.body.correctAnswer).toBe("A");
    });

    it("create: keys that repeat without case are refused", async () => {
      const res = await create({
        options: [
          { key: "A", text: "One" },
          { key: "a", text: "Two" },
        ],
      });
      expect(res.status).toBe(400);
    });

    it("update: text answer becomes the key", async () => {
      const created = await create({});
      const res = await put(created.body._id, { correctAnswer: "HAMMER" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.correctAnswer).toBe("B");
    });

    it("update: repeated keys are refused", async () => {
      const created = await create({});
      const res = await put(created.body._id, {
        options: [
          { key: "A", text: "One" },
          { key: "a", text: "Two" },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("DUPLICATE_OPTION_KEYS");
    });

    it("import: text answer is saved as the key; repeated keys are reported", async () => {
      const row = {
        qualification: qual.code,
        nos: "NOS-01",
        pc: "PC-01",
        type: "mcq",
        language: "en",
        stem: "Pick",
        optionA: "Spanner",
        optionB: "Hammer",
        correctAnswer: "hammer",
        marks: 1,
      };
      const ok = await request(app)
        .post(`${base}/import`)
        .set(bearer(sme.token))
        .send({ rows: [row] });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect((await Question.findOne({ stem: "Pick" })).correctAnswer).toBe("B");

      const rest = { ...row, optionA: undefined, optionB: undefined };
      const dup = await request(app)
        .post(`${base}/import`)
        .set(bearer(sme.token))
        .send({
          rows: [
            {
              ...rest,
              options: [
                { key: "A", text: "x" },
                { key: "a", text: "y" },
              ],
              correctAnswer: "A",
            },
          ],
        });
      expect(dup.status).toBe(400);
      expect(JSON.stringify(dup.body)).toContain("unique");
    });
  });

  describe("status is not set from the body", () => {
    it("create and update refuse status", async () => {
      expect((await create({ status: "retired" })).status).toBe(400);
      expect((await create({ status: "in_review" })).status).toBe(400);
      const created = await create({});
      expect((await put(created.body._id, { status: "in_review" })).status).toBe(400);
    });
  });

  describe("only the latest version can change", () => {
    it("update, approve and retire of an old version give 409", async () => {
      const v1 = await create({});
      expect((await put(v1.body._id, { stem: "Second" })).status).toBe(200);
      for (const res of [
        await put(v1.body._id, { stem: "Third" }),
        await request(app)
          .post(`${base}/questions/${v1.body._id}/approve`)
          .set(bearer(admin.token)),
        await request(app).post(`${base}/questions/${v1.body._id}/retire`).set(bearer(sme.token)),
      ]) {
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("QUESTION_NOT_LATEST");
      }
    });

    it("two edits at once make one new version", async () => {
      const v1 = await create({});
      const results = await Promise.all([
        put(v1.body._id, { stem: "One" }),
        put(v1.body._id, { stem: "Two" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await Question.countDocuments({ rootQuestionId: v1.body._id })).toBe(2);
      expect(await Question.countDocuments({ rootQuestionId: v1.body._id, isLatest: true })).toBe(
        1,
      );
    });

    it("the {rootQuestionId, version} pair is unique", async () => {
      const v1 = await create({});
      const copy = (await Question.findById(v1.body._id)).toObject();
      copy._id = oid();
      await expect(new Question(copy).save()).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe("approve and retire", () => {
    it("approving twice gives 409 and keeps approvedBy and approvedAt", async () => {
      const created = await create({});
      const url = `${base}/questions/${created.body._id}/approve`;
      const first = await request(app).post(url).set(bearer(admin.token));
      expect(first.status).toBe(200);
      const again = await request(app).post(url).set(bearer(reviewer.token));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("QUESTION_ALREADY_APPROVED");
      const stored = await Question.findById(created.body._id).lean();
      expect(String(stored.approvedBy)).toBe(String(first.body.approvedBy));
      expect(stored.approvedAt.toISOString()).toBe(first.body.approvedAt);
    });

    it("retiring twice gives 409", async () => {
      const created = await create({});
      const url = `${base}/questions/${created.body._id}/retire`;
      expect((await request(app).post(url).set(bearer(sme.token))).status).toBe(200);
      const again = await request(app).post(url).set(bearer(sme.token));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("QUESTION_RETIRED");
    });

    it("approve and update responses count against the content read cap", async () => {
      const created = await create({});
      await request(app)
        .post(`${base}/questions/${created.body._id}/approve`)
        .set(bearer(admin.token));
      expect((await ContentReadCounter.findOne({}).lean()).count).toBe(1);
      await put(created.body._id, { stem: "New" }, admin);
      expect((await ContentReadCounter.findOne({}).lean()).count).toBe(2);
    });
  });

  describe("coverage", () => {
    it("ignores old approved versions and uses the compliance constant", async () => {
      const rows = [];
      for (let i = 0; i < compliance.QUESTION_MIN_APPROVED_PER_PC; i += 1) {
        const id = oid();
        rows.push({
          _id: id,
          rootQuestionId: id,
          qualificationId: qual._id,
          nosId: "NOS-01",
          pcId: "PC-01",
          type: "short_answer",
          language: "en",
          stem: `S${i}`,
          marks: 1,
          status: "approved",
          version: 1,
          isLatest: i !== 0,
          createdBy: oid(),
        });
      }
      await Question.insertMany(rows);
      const res = await request(app).get(`${base}/coverage/${qual._id}`).set(bearer(sme.token));
      expect(res.status).toBe(200);
      const expected = compliance.QUESTION_MIN_APPROVED_PER_PC - 1;
      expect(res.body.pcs[0].approvedQuestionCount).toBe(expected);
      expect(res.body.pcs[0].flagged).toBe(true);
      expect(res.body.totalApprovedQuestions).toBe(expected);
    });
  });

  describe("review reminder job", () => {
    const claim = async (periodNo, over = {}) => {
      const row = await ReviewReminder.create({
        qualificationId: qual._id,
        abId: oid(),
        anchorDate: "2025-01-01",
        periodNo,
        dueQuestionCount: 1,
        ...over,
      });
      return row;
    };
    const age = (row) =>
      ReviewReminder.collection.updateOne(
        { _id: row._id },
        { $set: { createdAt: new Date(Date.now() - 3_600_000) } },
      );

    it("removes an old claim row with no email so the period can be queued again", async () => {
      const stale = await claim(1);
      await age(stale);
      await queueReviewReminders(new Date());
      expect(await ReviewReminder.findById(stale._id)).toBeNull();
    });

    it("keeps a recent claim row and an old row that has an email", async () => {
      const fresh = await claim(1);
      const sent = await claim(2, { emailId: oid() });
      await age(sent);
      await queueReviewReminders(new Date());
      expect(await ReviewReminder.findById(fresh._id)).not.toBeNull();
      expect(await ReviewReminder.findById(sent._id)).not.toBeNull();
    });

    it("IST date helper rolls over at 18:30 UTC", () => {
      expect(istCalendarDate(new Date("2026-03-31T19:00:00.000Z"))).toBe("2026-04-01");
    });
  });

  describe("jobs run once at startup", () => {
    it.each([
      ["SLA", startSlaBreachScheduler],
      ["review reminder", startReviewReminderScheduler],
    ])("%s scheduler runs at start only when asked, then on its interval", async (_name, start) => {
      vi.useFakeTimers();
      try {
        const quiet = vi.fn().mockResolvedValue({});
        start({ intervalMs: 1000, run: quiet })();
        await vi.advanceTimersByTimeAsync(0);
        expect(quiet).not.toHaveBeenCalled();

        const run = vi.fn().mockResolvedValue({});
        const stop = start({ intervalMs: 1000, run, runOnStart: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(run).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(run).toHaveBeenCalledTimes(2);
        stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
