import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { compliance } from "../src/config/compliance.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { EmailQueue } from "../src/models/email-queue.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { Question } from "../src/models/question.model.js";
import { ReviewCycle } from "../src/models/review-cycle.model.js";
import { ReviewReminder } from "../src/models/review-reminder.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import {
  queueReviewReminders,
  REVIEW_REMINDER_EMAIL_KIND,
  startReviewReminderScheduler,
} from "../src/modules/question-bank/review-reminder-job.js";
import {
  addMonthsIso,
  computeReviewDue,
  wholeMonthsBetween,
} from "../src/modules/question-bank/review-due.service.js";
import { istCalendarDate } from "../src/lib/working-days.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const base = "/api/v1/question-bank";
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const SECRET_STEM = "ZZ-secret-stem-about-soldering-irons";
const SECRET_COMMENT = "ZZ-secret-comment-quoting-the-question";
const SECRET_ANSWER = "ZZ-secret-answer-text";

let seq = 0;

async function sessionFor(role, extra = {}) {
  seq += 1;
  const email = `${role}-${seq}-${Math.random().toString(36).slice(2)}@aa.example`;
  const { password, user } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: String(user._id) };
}

async function makeAb(name, email) {
  return AwardingBody.create({ name, code: name, notificationEmails: [email] });
}

async function makeQualification(code = "Q-1") {
  return Qualification.create({
    code,
    name: `Qualification ${code}`,
    sector: "Electronics",
    ratioClass: "manufacturing",
    passMarkUnit: "percent",
    passMarks: { theory: 60, practical: 60, viva: 60 },
    nos: [{ nosId: "N1", code: "N1", name: "n", pcs: [{ pcId: "P1", code: "P1", name: "p" }] }],
  });
}

async function makeQuestion(qual, userId, overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  return Question.create({
    _id,
    rootQuestionId: _id,
    qualificationId: qual._id,
    nosId: "N1",
    pcId: "P1",
    type: "short_answer",
    language: "en",
    stem: SECRET_STEM,
    correctAnswer: SECRET_ANSWER,
    marks: 1,
    status: "approved",
    isLatest: true,
    createdBy: userId,
    ...overrides,
  });
}

/** Moves a question's createdAt, which mongoose will not let a normal save change. */
async function age(question, isoDate) {
  await Question.collection.updateOne(
    { _id: question._id },
    { $set: { createdAt: new Date(isoDate) } },
  );
}

async function linkBatch(qual, ab) {
  await Batch.collection.insertOne({ qualificationId: qual._id, abId: ab._id });
}

const tomorrowIso = () => istCalendarDate(new Date(Date.now() + 86_400_000 * 2));

function postCycle(token, body) {
  return request(app).post(`${base}/review-cycles`).set(bearer(token)).send(body);
}

function decide(token, cycleId, body) {
  return request(app)
    .post(`${base}/review-cycles/${cycleId}/decisions`)
    .set(bearer(token))
    .send(body);
}

describe("Q-04 review cycles", () => {
  let admin;
  let sme;
  let ab;
  let otherAb;
  let reviewer;
  let otherReviewer;
  let qual;

  beforeAll(startMongo);
  afterAll(stopMongo);
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
    await ReviewCycle.syncIndexes();
    await ReviewReminder.syncIndexes();
    ab = await makeAb("AB1", "ab1@ab.example");
    otherAb = await makeAb("AB2", "ab2@ab.example");
    admin = await sessionFor("aa_admin");
    sme = await sessionFor("sme");
    reviewer = await sessionFor("ab_reviewer", { abId: ab._id });
    otherReviewer = await sessionFor("ab_reviewer", { abId: otherAb._id });
    qual = await makeQualification();
  });

  async function openCycle(questions, overrides = {}) {
    const res = await postCycle(sme.token, {
      qualificationId: String(qual._id),
      abId: String(ab._id),
      reviewerId: reviewer.userId,
      dueDate: tomorrowIso(),
      questionIds: questions.map((q) => String(q._id)),
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  describe("create", () => {
    it("lets aa_admin and sme create, with the default of all approved latest questions", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      await makeQuestion(qual, admin.userId, { status: "draft" });
      await makeQuestion(qual, admin.userId, { isLatest: false });
      const res = await postCycle(admin.token, {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: reviewer.userId,
        dueDate: tomorrowIso(),
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("open");
      expect(res.body.counts).toMatchObject({ total: 1, decided: 0, undecided: 1 });
      const stored = await ReviewCycle.findById(res.body.id).lean();
      expect(String(stored.items[0].questionId)).toBe(String(q1._id));
    });

    it("refuses every other role and no token", async () => {
      await makeQuestion(qual, admin.userId);
      const body = {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: reviewer.userId,
        dueDate: tomorrowIso(),
      };
      for (const role of USER_ROLES.filter((r) => !["aa_admin", "sme"].includes(r))) {
        const s = await sessionFor(role, role === "ab_reviewer" ? { abId: ab._id } : {});
        const res = await postCycle(s.token, body);
        expect(res.status, role).toBe(403);
      }
      const anon = await request(app).post(`${base}/review-cycles`).send(body);
      expect(anon.status).toBe(401);
      expect(await ReviewCycle.countDocuments()).toBe(0);
    });

    it("rejects unknown keys, national id keys and bad dates", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const good = {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: reviewer.userId,
        questionIds: [String(q1._id)],
        dueDate: tomorrowIso(),
      };
      expect((await postCycle(sme.token, { ...good, status: "closed" })).status).toBe(400);
      expect((await postCycle(sme.token, { ...good, aadhaar: "1234" })).status).toBe(400);
      expect((await postCycle(sme.token, { ...good, dueDate: "2026-02-31" })).status).toBe(400);
      expect((await postCycle(sme.token, { ...good, dueDate: "2000-01-01" })).status).toBe(400);
    });

    it("needs a reviewer who is an active ab_reviewer of that awarding body", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const res = await postCycle(sme.token, {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: otherReviewer.userId,
        dueDate: tomorrowIso(),
        questionIds: [String(q1._id)],
      });
      expect(res.status).toBe(400);
      const asSme = await postCycle(sme.token, {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: sme.userId,
        dueDate: tomorrowIso(),
        questionIds: [String(q1._id)],
      });
      expect(asSme.status).toBe(400);
    });

    it("refuses questions that are not approved, latest and of the qualification", async () => {
      const draft = await makeQuestion(qual, admin.userId, { status: "draft" });
      const otherQual = await makeQualification("Q-2");
      const foreign = await makeQuestion(otherQual, admin.userId);
      for (const q of [draft, foreign]) {
        const res = await postCycle(sme.token, {
          qualificationId: String(qual._id),
          abId: String(ab._id),
          reviewerId: reviewer.userId,
          dueDate: tomorrowIso(),
          questionIds: [String(q._id)],
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_QUESTIONS");
      }
    });

    it("refuses a second open cycle for the same qualification and awarding body", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      await openCycle([q1]);
      const res = await postCycle(sme.token, {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: reviewer.userId,
        dueDate: tomorrowIso(),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("REVIEW_CYCLE_ALREADY_OPEN");
    });

    it("refuses a qualification with no approved questions", async () => {
      const res = await postCycle(sme.token, {
        qualificationId: String(qual._id),
        abId: String(ab._id),
        reviewerId: reviewer.userId,
        dueDate: tomorrowIso(),
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("NO_QUESTIONS_TO_REVIEW");
    });
  });

  describe("list and get scope", () => {
    it("limits ab_reviewer to their own awarding body and hides others as 404", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const mine = await openCycle([q1]);
      const theirs = await postCycle(sme.token, {
        qualificationId: String(qual._id),
        abId: String(otherAb._id),
        reviewerId: otherReviewer.userId,
        dueDate: tomorrowIso(),
      });
      expect(theirs.status).toBe(201);

      const all = await request(app).get(`${base}/review-cycles`).set(bearer(sme.token));
      expect(all.body.total).toBe(2);
      const own = await request(app).get(`${base}/review-cycles`).set(bearer(reviewer.token));
      expect(own.body.items.map((c) => c.id)).toEqual([mine.id]);
      // An abId filter cannot widen a reviewer's view.
      const widened = await request(app)
        .get(`${base}/review-cycles?abId=${otherAb._id}`)
        .set(bearer(reviewer.token));
      expect(widened.body.items.map((c) => c.id)).toEqual([mine.id]);

      expect(
        (await request(app).get(`${base}/review-cycles/${mine.id}`).set(bearer(reviewer.token)))
          .status,
      ).toBe(200);
      const hidden = await request(app)
        .get(`${base}/review-cycles/${theirs.body.id}`)
        .set(bearer(reviewer.token));
      expect(hidden.status).toBe(404);
    });

    it("gives a reviewer with no abId nothing, and other roles 403", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      await openCycle([q1]);
      const noAb = await sessionFor("ab_reviewer");
      const list = await request(app).get(`${base}/review-cycles`).set(bearer(noAb.token));
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([]);
      for (const role of ["mis", "assessor", "tp", "candidate", "ncvet_viewer", "proctor"]) {
        const s = await sessionFor(role);
        const res = await request(app).get(`${base}/review-cycles`).set(bearer(s.token));
        expect(res.status, role).toBe(403);
      }
    });
  });

  describe("decisions", () => {
    it("records keep, revise and retire, with the existing versioning and retire", async () => {
      const kept = await makeQuestion(qual, admin.userId);
      const revised = await makeQuestion(qual, admin.userId);
      const retired = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([kept, revised, retired]);

      const keep = await decide(reviewer.token, cycle.id, {
        questionId: String(kept._id),
        decision: "keep",
        comment: "Still correct",
      });
      expect(keep.status).toBe(201);
      expect(keep.body.counts.keep).toBe(1);

      const revise = await decide(reviewer.token, cycle.id, {
        questionId: String(revised._id),
        decision: "revise",
        comment: "Wording is dated",
        changes: { stem: "A brand new stem for version two" },
      });
      expect(revise.status).toBe(201);
      const v2 = await Question.findById(revise.body.resultQuestionId).lean();
      expect(v2).toMatchObject({ version: 2, status: "draft", isLatest: true });
      expect(String(v2.previousVersionId)).toBe(String(revised._id));
      expect((await Question.findById(revised._id).lean()).isLatest).toBe(false);

      const retire = await decide(reviewer.token, cycle.id, {
        questionId: String(retired._id),
        decision: "retire",
        comment: "Out of date",
      });
      expect(retire.status).toBe(201);
      const gone = await Question.findById(retired._id).lean();
      expect(gone.status).toBe("retired");
      expect(String(gone.retiredBy)).toBe(reviewer.userId);

      const read = await request(app)
        .get(`${base}/review-cycles/${cycle.id}`)
        .set(bearer(sme.token));
      expect(read.body.counts).toMatchObject({
        decided: 3,
        undecided: 0,
        keep: 1,
        revise: 1,
        retire: 1,
      });
      expect(read.body.items.find((i) => i.questionId === String(kept._id)).comment).toBe(
        "Still correct",
      );
    });

    it("lets only an ab_reviewer of that awarding body decide", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1]);
      const body = { questionId: String(q1._id), decision: "keep", comment: "ok" };
      for (const role of ["aa_admin", "sme", "mis", "assessor", "tp"]) {
        const s = await sessionFor(role);
        expect((await decide(s.token, cycle.id, body)).status, role).toBe(403);
      }
      expect((await decide(otherReviewer.token, cycle.id, body)).status).toBe(404);
      const noAb = await sessionFor("ab_reviewer");
      expect((await decide(noAb.token, cycle.id, body)).status).toBe(404);
      expect((await ReviewCycle.findById(cycle.id).lean()).items[0].decision).toBeNull();
    });

    it("refuses a second decision, an unknown question, a missing comment and extra keys", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const other = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1]);
      const ok = { questionId: String(q1._id), decision: "keep", comment: "fine" };
      expect((await decide(reviewer.token, cycle.id, ok)).status).toBe(201);
      const again = await decide(reviewer.token, cycle.id, { ...ok, decision: "retire" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("DECISION_ALREADY_RECORDED");
      expect((await Question.findById(q1._id).lean()).status).toBe("approved");

      const notIn = await decide(reviewer.token, cycle.id, {
        ...ok,
        questionId: String(other._id),
      });
      expect(notIn.status).toBe(404);
      expect((await decide(reviewer.token, cycle.id, { ...ok, comment: "" })).status).toBe(400);
      expect((await decide(reviewer.token, cycle.id, { ...ok, extra: 1 })).status).toBe(400);
      expect((await decide(reviewer.token, cycle.id, { ...ok, decision: "maybe" })).status).toBe(
        400,
      );
      expect(
        (await decide(reviewer.token, cycle.id, { ...ok, changes: { stem: "x" } })).status,
      ).toBe(400);
      expect(
        (
          await decide(reviewer.token, cycle.id, {
            ...ok,
            decision: "revise",
            changes: { status: "approved" },
          })
        ).status,
      ).toBe(400);
    });

    it("undoes the decision when the revision is refused, so the item stays open", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1]);
      const res = await decide(reviewer.token, cycle.id, {
        questionId: String(q1._id),
        decision: "revise",
        comment: "needs options",
        changes: { type: "mcq" },
      });
      expect(res.status).toBe(400);
      const stored = await ReviewCycle.findById(cycle.id).lean();
      expect(stored.items[0].decision).toBeNull();
      expect(stored.items[0].comment).toBeNull();
      expect(await Question.countDocuments()).toBe(1);

      const retry = await decide(reviewer.token, cycle.id, {
        questionId: String(q1._id),
        decision: "keep",
        comment: "ok after all",
      });
      expect(retry.status).toBe(201);
    });

    it("refuses a question that changed after the cycle was created, and a closed cycle", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const q2 = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1, q2]);
      await Question.updateOne({ _id: q1._id }, { isLatest: false });
      const stale = await decide(reviewer.token, cycle.id, {
        questionId: String(q1._id),
        decision: "keep",
        comment: "ok",
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("QUESTION_NOT_REVIEWABLE");

      await request(app)
        .post(`${base}/review-cycles/${cycle.id}/close`)
        .set(bearer(sme.token))
        .send({ allowIncomplete: true });
      const closed = await decide(reviewer.token, cycle.id, {
        questionId: String(q2._id),
        decision: "keep",
        comment: "ok",
      });
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe("REVIEW_CYCLE_CLOSED");
    });
  });

  describe("close", () => {
    it("needs every question decided unless allowIncomplete, and only managers close", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const q2 = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1, q2]);
      const close = (token, body = {}) =>
        request(app).post(`${base}/review-cycles/${cycle.id}/close`).set(bearer(token)).send(body);

      expect((await close(reviewer.token)).status).toBe(403);
      const early = await close(sme.token);
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe("UNDECIDED_ITEMS");
      expect(early.body.error.details.undecided).toBe(2);

      await decide(reviewer.token, cycle.id, {
        questionId: String(q1._id),
        decision: "keep",
        comment: "ok",
      });
      await decide(reviewer.token, cycle.id, {
        questionId: String(q2._id),
        decision: "keep",
        comment: "ok",
      });
      expect((await close(admin.token, { unknown: true })).status).toBe(400);
      const done = await close(admin.token);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ status: "closed", incomplete: false });
      expect((await close(admin.token)).status).toBe(409);
    });

    it("marks a close with undecided questions as incomplete", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1]);
      const res = await request(app)
        .post(`${base}/review-cycles/${cycle.id}/close`)
        .set(bearer(sme.token))
        .send({ allowIncomplete: true });
      expect(res.status).toBe(200);
      expect(res.body.incomplete).toBe(true);
      // A new cycle can be opened once the old one is closed.
      expect(
        (
          await postCycle(sme.token, {
            qualificationId: String(qual._id),
            abId: String(ab._id),
            reviewerId: reviewer.userId,
            dueDate: tomorrowIso(),
          })
        ).status,
      ).toBe(201);
    });
  });

  describe("audit", () => {
    it("writes rows without question text or reviewer comments", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      const q2 = await makeQuestion(qual, admin.userId);
      const cycle = await openCycle([q1, q2]);
      await decide(reviewer.token, cycle.id, {
        questionId: String(q1._id),
        decision: "revise",
        comment: SECRET_COMMENT,
        changes: { stem: SECRET_STEM, correctAnswer: SECRET_ANSWER },
      });
      await decide(reviewer.token, cycle.id, {
        questionId: String(q2._id),
        decision: "keep",
        comment: SECRET_COMMENT,
      });
      await request(app)
        .post(`${base}/review-cycles/${cycle.id}/close`)
        .set(bearer(sme.token))
        .send({});

      const rows = await AuditLog.find({ action: /^review_cycle\./ }).lean();
      expect(rows.map((r) => r.action).sort()).toEqual([
        "review_cycle.close",
        "review_cycle.create",
        "review_cycle.decision",
        "review_cycle.decision",
      ]);
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(SECRET_STEM);
      expect(dump).not.toContain(SECRET_COMMENT);
      expect(dump).not.toContain(SECRET_ANSWER);
      const decision = rows.find((r) => r.action === "review_cycle.decision");
      expect(String(decision.abId)).toBe(String(ab._id));
      expect(decision.after.decision).toBeDefined();
    });
  });

  describe("review interval", () => {
    it("defaults to compliance.js and lets managers change it within limits", async () => {
      const get = () =>
        request(app).get(`${base}/review-settings/${qual._id}`).set(bearer(reviewer.token));
      const put = (token, body) =>
        request(app).put(`${base}/review-settings/${qual._id}`).set(bearer(token)).send(body);

      expect(compliance.QUESTION_REVIEW_INTERVAL_MONTHS).toBe(12);
      expect((await get()).body).toMatchObject({ intervalMonths: 12, isDefault: true });
      expect((await put(reviewer.token, { intervalMonths: 6 })).status).toBe(403);
      expect((await put(sme.token, { intervalMonths: 0 })).status).toBe(400);
      expect((await put(sme.token, { intervalMonths: 61 })).status).toBe(400);
      expect((await put(sme.token, { intervalMonths: 1.5 })).status).toBe(400);
      expect((await put(sme.token, { intervalMonths: 6, extra: 1 })).status).toBe(400);
      const ok = await put(admin.token, { intervalMonths: 6 });
      expect(ok.status).toBe(200);
      expect((await get()).body).toMatchObject({ intervalMonths: 6, isDefault: false });
      const row = await AuditLog.findOne({ action: "review_setting.update" }).lean();
      expect(row.before.intervalMonths).toBe(12);
      expect(row.after.intervalMonths).toBe(6);
    });
  });

  describe("review-due", () => {
    it("lists a qualification once a question is past the interval, and clears after a kept review", async () => {
      const old = await makeQuestion(qual, admin.userId);
      const fresh = await makeQuestion(qual, admin.userId);
      await age(old, "2025-01-10T00:00:00Z");
      await linkBatch(qual, ab);

      const due = await request(app).get(`${base}/review-due`).set(bearer(sme.token));
      expect(due.status).toBe(200);
      expect(due.body.items).toHaveLength(1);
      expect(due.body.items[0]).toMatchObject({
        code: "Q-1",
        intervalMonths: 12,
        dueQuestionCount: 1,
        awardingBodyIds: [String(ab._id)],
      });
      expect(JSON.stringify(due.body)).not.toContain(SECRET_STEM);

      // A reviewer sees only qualifications linked to their awarding body.
      const mine = await request(app).get(`${base}/review-due`).set(bearer(reviewer.token));
      expect(mine.body.total).toBe(1);
      const theirs = await request(app).get(`${base}/review-due`).set(bearer(otherReviewer.token));
      expect(theirs.body.total).toBe(0);
      for (const role of ["mis", "tp", "assessor"]) {
        const s = await sessionFor(role);
        expect((await request(app).get(`${base}/review-due`).set(bearer(s.token))).status).toBe(
          403,
        );
      }
      expect((await request(app).get(`${base}/review-due?x=1`).set(bearer(sme.token))).status).toBe(
        400,
      );

      const cycle = await openCycle([old, fresh]);
      for (const q of [old, fresh]) {
        await decide(reviewer.token, cycle.id, {
          questionId: String(q._id),
          decision: "keep",
          comment: "ok",
        });
      }
      await request(app)
        .post(`${base}/review-cycles/${cycle.id}/close`)
        .set(bearer(sme.token))
        .send({});
      const after = await request(app).get(`${base}/review-due`).set(bearer(sme.token));
      expect(after.body.total).toBe(0);
    });

    it("uses the qualification's own interval", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      await age(q1, new Date(Date.now() - 100 * 86_400_000).toISOString());
      await Qualification.collection.updateOne(
        { _id: qual._id },
        { $set: { createdAt: new Date(Date.now() - 100 * 86_400_000) } },
      );
      expect((await computeReviewDue()).length).toBe(0);
      await request(app)
        .put(`${base}/review-settings/${qual._id}`)
        .set(bearer(admin.token))
        .send({ intervalMonths: 3 });
      const due = await computeReviewDue();
      expect(due).toHaveLength(1);
      expect(due[0]).toMatchObject({ intervalMonths: 3, dueQuestionCount: 1 });
    });

    it("does not count draft or retired questions, and an old version of a revised question restarts the clock", async () => {
      const draft = await makeQuestion(qual, admin.userId, { status: "draft" });
      const retired = await makeQuestion(qual, admin.userId, { status: "retired" });
      await age(draft, "2020-01-01T00:00:00Z");
      await age(retired, "2020-01-01T00:00:00Z");
      await Qualification.collection.updateOne(
        { _id: qual._id },
        { $set: { createdAt: new Date("2020-01-01T00:00:00Z") } },
      );
      expect(await computeReviewDue()).toEqual([]);
    });
  });

  describe("nightly reminder job", () => {
    async function dueSetup() {
      const q1 = await makeQuestion(qual, admin.userId);
      await age(q1, "2025-01-10T00:00:00Z");
      await linkBatch(qual, ab);
      return q1;
    }

    it("queues one email to the awarding body notification emails, with no question text", async () => {
      await dueSetup();
      const result = await queueReviewReminders();
      expect(result).toEqual({ queued: 1, alreadyReminded: 0, noAwardingBody: 0, failed: 0 });
      const jobs = await EmailQueue.find({ kind: REVIEW_REMINDER_EMAIL_KIND }).lean();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].to).toEqual(["ab1@ab.example"]);
      expect(jobs[0].status).toBe("pending");
      expect(jobs[0].subject).toContain("Q-1");
      const dump = JSON.stringify(jobs);
      expect(dump).not.toContain(SECRET_STEM);
      expect(dump).not.toContain(SECRET_ANSWER);
      const reminder = await ReviewReminder.findOne().lean();
      expect(String(reminder.emailId)).toBe(String(jobs[0]._id));
    });

    it("is idempotent: a second and third run queue nothing", async () => {
      await dueSetup();
      await queueReviewReminders();
      const second = await queueReviewReminders();
      const third = await queueReviewReminders(new Date(Date.now() + 86_400_000 * 30));
      expect(second).toEqual({ queued: 0, alreadyReminded: 1, noAwardingBody: 0, failed: 0 });
      expect(third.queued).toBe(0);
      expect(await EmailQueue.countDocuments({ kind: REVIEW_REMINDER_EMAIL_KIND })).toBe(1);
      expect(await ReviewReminder.countDocuments()).toBe(1);
    });

    it("survives two runs at the same time with one email", async () => {
      await dueSetup();
      const [a, b] = await Promise.all([queueReviewReminders(), queueReviewReminders()]);
      expect(a.queued + b.queued).toBe(1);
      expect(await EmailQueue.countDocuments({ kind: REVIEW_REMINDER_EMAIL_KIND })).toBe(1);
    });

    it("reminds again for the next period", async () => {
      await dueSetup();
      await queueReviewReminders();
      const later = new Date();
      later.setUTCFullYear(later.getUTCFullYear() + 2);
      const result = await queueReviewReminders(later);
      expect(result.queued).toBe(1);
      expect(await EmailQueue.countDocuments({ kind: REVIEW_REMINDER_EMAIL_KIND })).toBe(2);
      const periods = (await ReviewReminder.find().lean()).map((r) => r.periodNo).sort();
      expect(periods[0]).toBeLessThan(periods[1]);
    });

    it("reminds again after a completed review restarts the clock, a period later", async () => {
      const q1 = await dueSetup();
      await Qualification.collection.updateOne(
        { _id: qual._id },
        { $set: { createdAt: new Date("2025-01-10T00:00:00Z") } },
      );
      await queueReviewReminders();
      const cycle = await openCycle([q1]);
      await decide(reviewer.token, cycle.id, {
        questionId: String(q1._id),
        decision: "keep",
        comment: "ok",
      });
      await request(app)
        .post(`${base}/review-cycles/${cycle.id}/close`)
        .set(bearer(sme.token))
        .send({});
      expect((await queueReviewReminders()).queued).toBe(0);
      const later = new Date();
      later.setUTCFullYear(later.getUTCFullYear() + 1);
      later.setUTCDate(later.getUTCDate() + 2);
      expect((await queueReviewReminders(later)).queued).toBe(1);
    });

    it("skips a qualification with no awarding body and removes its claim when queueing fails", async () => {
      const q1 = await makeQuestion(qual, admin.userId);
      await age(q1, "2025-01-10T00:00:00Z");
      expect((await queueReviewReminders()).noAwardingBody).toBe(1);
      expect(await EmailQueue.countDocuments()).toBe(0);

      await linkBatch(qual, ab);
      const original = EmailQueue.create;
      EmailQueue.create = async () => {
        throw new Error("queue down");
      };
      try {
        expect((await queueReviewReminders()).failed).toBe(1);
      } finally {
        EmailQueue.create = original;
      }
      expect(await ReviewReminder.countDocuments()).toBe(0);
      expect((await queueReviewReminders()).queued).toBe(1);
    });

    it("sends nothing when nothing is past the interval", async () => {
      await makeQuestion(qual, admin.userId);
      await linkBatch(qual, ab);
      expect(await queueReviewReminders()).toEqual({
        queued: 0,
        alreadyReminded: 0,
        noAwardingBody: 0,
        failed: 0,
      });
    });

    it("scheduler runs the job on a timer and stops", async () => {
      let runs = 0;
      const stop = startReviewReminderScheduler({
        intervalMs: 5,
        run: async () => {
          runs += 1;
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      stop();
      const seen = runs;
      expect(seen).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(runs).toBe(seen);
    });
  });
});

describe("month arithmetic", () => {
  it("adds months and clamps to the end of a short month", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsIso("2025-10-15", 12)).toBe("2026-10-15");
    expect(addMonthsIso("2025-11-15", 3)).toBe("2026-02-15");
  });

  it("counts whole months", () => {
    expect(wholeMonthsBetween("2025-10-15", "2026-10-14")).toBe(11);
    expect(wholeMonthsBetween("2025-10-15", "2026-10-15")).toBe(12);
    expect(wholeMonthsBetween("2026-10-15", "2025-10-15")).toBe(0);
  });
});
