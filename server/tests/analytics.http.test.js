import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Batch } from "../src/models/batch.model.js";
import { Result } from "../src/models/result.model.js";
import { USER_ROLES } from "../src/models/roles.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();
const READERS = ["aa_admin", "mis", "ncvet_viewer", "ab_reviewer"];
const YEAR = "from=2026-01-01&to=2026-12-31";

const ab1 = oid();
const ab2 = oid();
const tp1 = oid();
const tp2 = oid();
const asr1 = oid();
const asr2 = oid();
const asr3 = oid();
const q1 = oid();
const q2 = oid();
const learnerSentinel = oid();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function sessionFor(role, extra = {}) {
  const email = `${role}-${oid()}@aa.example`;
  const { password } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken };
}

const get = (token, path, qs = YEAR) =>
  request(app).get(`/api/v1/analytics/${path}?${qs}`).set(bearer(token));

async function makeBatch(overrides = {}) {
  const _id = oid();
  const { sla, ...rest } = overrides;
  return Batch.create({
    _id,
    abId: ab1,
    qualificationId: q1,
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-04-10",
    assessmentEndDate: "2026-04-11",
    tpId: tp1,
    centreId: oid(),
    candidateCount: 4,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Marathi",
    state: "Maharashtra",
    status: "published",
    statusVersion: 9,
    isReassessment: false,
    firstAssessmentBatchId: _id,
    assessorId: asr1,
    sla: {
      acceptDueAt: new Date("2026-04-01T18:29:59.999Z"),
      assignDueAt: new Date("2026-04-05T18:29:59.999Z"),
      resultDueAt: new Date("2026-04-20T18:29:59.999Z"),
      breached: [],
      ...sla,
    },
    allocatedAt: new Date("2026-03-20T08:00:00.000Z"),
    ...rest,
  });
}

/** Inserted raw so a test can set any status and timestamp. */
async function makeResult(batch, status, submittedAt, outcomes) {
  await Result.collection.insertOne({
    batchId: batch._id,
    status,
    submittedAt: submittedAt ? new Date(submittedAt) : null,
    publishedAt: status === "published" ? new Date(submittedAt) : null,
    rows: outcomes.map((outcome) => ({
      candidateId: learnerSentinel,
      absent: outcome === "Absent",
      outcome,
      nos: [],
    })),
  });
}

/**
 * Four batches in 2026 plus one in 2025 and one of another awarding body.
 * B1 asr1/tp1/q1/Maharashtra, published, 1.5 days, Pass Pass Fail Absent
 * B2 asr1/tp1/q2/Maharashtra, published, 3 days, result late, Pass Fail
 * B3 asr2/tp2/q1/Gujarat, result only submitted (not published), accept breached
 * B4 asr3/tp1/q1/Maharashtra, other awarding body, published, Pass Pass
 */
async function seed() {
  const db = mongoose.connection.db;
  await db.collection("assessors").insertMany([
    { _id: asr1, name: "Assessor One", code: "AS-1" },
    { _id: asr2, name: "Assessor Two" },
    { _id: asr3, name: "Assessor Three" },
  ]);
  await db.collection("trainingPartners").insertMany([
    { _id: tp1, name: "Partner One", code: "TP-1" },
    { _id: tp2, name: "Partner Two" },
  ]);
  await db.collection("qualifications").insertMany([
    { _id: q1, name: "Electrician", code: "Q-EL" },
    { _id: q2, name: "Plumber", code: "Q-PL" },
  ]);

  const b1 = await makeBatch();
  await makeResult(b1, "published", "2026-04-13T06:30:00.000Z", ["Pass", "Pass", "Fail", "Absent"]);
  const b2 = await makeBatch({
    qualificationId: q2,
    assessmentStartDate: "2026-05-05",
    assessmentEndDate: "2026-05-05",
    sla: { breached: ["result"] },
  });
  await makeResult(b2, "published", "2026-05-08T18:30:00.000Z", ["Pass", "Fail"]);
  const b3 = await makeBatch({
    assessorId: asr2,
    tpId: tp2,
    state: "Gujarat",
    assessmentStartDate: "2026-06-01",
    assessmentEndDate: "2026-06-02",
    status: "result_submitted",
    sla: { breached: ["accept"] },
  });
  await makeResult(b3, "submitted", "2026-06-04T10:00:00.000Z", ["Pass", "Pass"]);
  const b4 = await makeBatch({
    abId: ab2,
    assessorId: asr3,
    assessmentStartDate: "2026-04-20",
    assessmentEndDate: "2026-04-20",
  });
  await makeResult(b4, "published", "2026-04-21T18:30:00.000Z", ["Pass", "Pass"]);
  // Outside the range.
  const old = await makeBatch({
    assessmentStartDate: "2025-01-01",
    assessmentEndDate: "2025-01-02",
  });
  await makeResult(old, "published", "2025-01-05T00:00:00.000Z", ["Fail", "Fail"]);
  return { b1, b2, b3, b4 };
}

const byId = (items, id) => items.find((row) => row.id === String(id));

describe("analytics", () => {
  beforeAll(async () => {
    await startMongo();
    await Batch.syncIndexes();
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  describe("GET /analytics/by-assessor", () => {
    it("counts batches, published pass rate, turnaround and SLA breaches per assessor", async () => {
      await seed();
      const admin = await sessionFor("aa_admin");
      const res = await get(admin.token, "by-assessor");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        from: "2026-01-01",
        to: "2026-12-31",
        page: 1,
        pageSize: 20,
      });
      expect(res.body.total).toBe(3);

      expect(byId(res.body.items, asr1)).toEqual({
        id: String(asr1),
        name: "Assessor One",
        code: "AS-1",
        batches: 2,
        publishedBatches: 2,
        learnersAssessed: 5,
        passed: 3,
        failed: 2,
        absent: 1,
        passRate: 0.6,
        avgTurnaroundDays: 2.25,
        slaBreaches: 1,
      });
      // Only a submitted result: it counts as a batch but not towards any rate.
      expect(byId(res.body.items, asr2)).toMatchObject({
        name: "Assessor Two",
        batches: 1,
        publishedBatches: 0,
        learnersAssessed: 0,
        passRate: null,
        avgTurnaroundDays: null,
        slaBreaches: 1,
      });
      expect(byId(res.body.items, asr3)).toMatchObject({ batches: 1, passRate: 1 });
      expect(res.body.items[0].id).toBe(String(asr1));
    });

    it("leaves out batches with no assessor and batches outside the range", async () => {
      await seed();
      await makeBatch({ assessorId: null, status: "allocated" });
      const admin = await sessionFor("aa_admin");
      const res = await get(admin.token, "by-assessor");
      expect(res.body.total).toBe(3);
      const narrow = await get(admin.token, "by-assessor", "from=2026-05-01&to=2026-05-31");
      expect(narrow.body.items.map((row) => row.id)).toEqual([String(asr1)]);
      expect(narrow.body.items[0]).toMatchObject({
        batches: 1,
        passRate: 0.5,
        avgTurnaroundDays: 3,
      });
      // The range is inclusive at both ends.
      const edge = await get(admin.token, "by-assessor", "from=2026-05-05&to=2026-05-05");
      expect(edge.body.total).toBe(1);
    });
  });

  describe("GET /analytics/by-training-partner, by-job-role, by-state", () => {
    it("groups by training partner with names", async () => {
      await seed();
      const admin = await sessionFor("aa_admin");
      const res = await get(admin.token, "by-training-partner");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(byId(res.body.items, tp1)).toMatchObject({
        name: "Partner One",
        code: "TP-1",
        batches: 3,
        passed: 5,
        failed: 2,
        passRate: 0.7143,
      });
      expect(byId(res.body.items, tp2)).toMatchObject({
        name: "Partner Two",
        batches: 1,
        passRate: null,
      });
    });

    it("groups by job role (qualification)", async () => {
      await seed();
      const admin = await sessionFor("mis");
      const res = await get(admin.token, "by-job-role");
      expect(res.status).toBe(200);
      expect(byId(res.body.items, q1)).toMatchObject({
        name: "Electrician",
        code: "Q-EL",
        batches: 3,
        passed: 4,
        failed: 1,
        absent: 1,
        passRate: 0.8,
      });
      expect(byId(res.body.items, q2)).toMatchObject({
        name: "Plumber",
        batches: 1,
        passRate: 0.5,
        avgTurnaroundDays: 3,
        slaBreaches: 1,
      });
    });

    it("groups by state, using the state name as id and name", async () => {
      await seed();
      const admin = await sessionFor("ncvet_viewer");
      const res = await get(admin.token, "by-state");
      expect(res.status).toBe(200);
      const maharashtra = res.body.items.find((row) => row.id === "Maharashtra");
      expect(maharashtra).toMatchObject({
        name: "Maharashtra",
        code: null,
        batches: 3,
        passed: 5,
        failed: 2,
      });
      expect(res.body.items.find((row) => row.id === "Gujarat")).toMatchObject({
        batches: 1,
        slaBreaches: 1,
      });
      expect(res.body.items[0].id).toBe("Maharashtra");
    });

    it("pages the list", async () => {
      await seed();
      const admin = await sessionFor("aa_admin");
      const first = await get(admin.token, "by-state", `${YEAR}&page=1&pageSize=1`);
      const second = await get(admin.token, "by-state", `${YEAR}&page=2&pageSize=1`);
      const third = await get(admin.token, "by-state", `${YEAR}&page=3&pageSize=1`);
      expect(first.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
      expect(first.body.items.map((row) => row.id)).toEqual(["Maharashtra"]);
      expect(second.body.items.map((row) => row.id)).toEqual(["Gujarat"]);
      expect(third.body.items).toEqual([]);
    });
  });

  describe("GET /analytics/summary", () => {
    it("reports batches by status, published results on time and late, and the overall rate", async () => {
      await seed();
      const admin = await sessionFor("aa_admin");
      const res = await get(admin.token, "summary");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.batches.total).toBe(4);
      expect(res.body.batches.byStatus).toMatchObject({
        published: 3,
        result_submitted: 1,
        allocated: 0,
        cancelled: 0,
      });
      expect(res.body.publishedResults).toEqual({ total: 3, onTime: 2, late: 1 });
      expect(res.body).toMatchObject({ learnersAssessed: 7, passRate: 0.7143, slaBreaches: 2 });
    });
  });

  describe("empty data", () => {
    it("returns empty pages and zero counts when nothing is in range", async () => {
      await seed();
      const admin = await sessionFor("aa_admin");
      const qs = "from=2020-01-01&to=2020-12-31";
      for (const path of ["by-assessor", "by-training-partner", "by-job-role", "by-state"]) {
        const res = await get(admin.token, path, qs);
        expect(res.status, path).toBe(200);
        expect(res.body).toMatchObject({ total: 0, items: [] });
      }
      const summary = await get(admin.token, "summary", qs);
      expect(summary.body.batches.total).toBe(0);
      expect(summary.body.batches.byStatus.published).toBe(0);
      expect(summary.body).toMatchObject({
        publishedResults: { total: 0, onTime: 0, late: 0 },
        learnersAssessed: 0,
        passRate: null,
        slaBreaches: 0,
      });
    });

    it("works on an empty database", async () => {
      const admin = await sessionFor("aa_admin");
      expect((await get(admin.token, "by-assessor")).body.total).toBe(0);
      expect((await get(admin.token, "summary")).body.batches.total).toBe(0);
    });
  });

  describe("roles", () => {
    it("lets aa_admin, mis, ncvet_viewer and ab_reviewer read, and gives every other role 403", async () => {
      await seed();
      for (const role of USER_ROLES) {
        const s = await sessionFor(role, role === "ab_reviewer" ? { abId: ab1 } : {});
        for (const path of [
          "summary",
          "by-assessor",
          "by-training-partner",
          "by-job-role",
          "by-state",
        ]) {
          const res = await get(s.token, path);
          expect(res.status, `${role} ${path}`).toBe(READERS.includes(role) ? 200 : 403);
        }
      }
      expect((await request(app).get(`/api/v1/analytics/summary?${YEAR}`)).status).toBe(401);
    });

    it("limits ab_reviewer to their own awarding body on every endpoint", async () => {
      await seed();
      const reviewer = await sessionFor("ab_reviewer", { abId: ab1 });
      const summary = await get(reviewer.token, "summary");
      expect(summary.body.batches.total).toBe(3);
      expect(summary.body.publishedResults.total).toBe(2);
      expect(summary.body.learnersAssessed).toBe(5);

      const assessors = await get(reviewer.token, "by-assessor");
      expect(assessors.body.items.map((row) => row.id).sort()).toEqual(
        [String(asr1), String(asr2)].sort(),
      );
      const partners = await get(reviewer.token, "by-training-partner");
      expect(byId(partners.body.items, tp1)).toMatchObject({ batches: 2, passed: 3, failed: 2 });
      expect(
        (await get(reviewer.token, "by-state")).body.items.find((r) => r.id === "Maharashtra")
          .batches,
      ).toBe(2);

      const other = await sessionFor("ab_reviewer", { abId: ab2 });
      const mine = await get(other.token, "by-assessor");
      expect(mine.body.items.map((row) => row.id)).toEqual([String(asr3)]);

      const noAb = await sessionFor("ab_reviewer");
      expect((await get(noAb.token, "summary")).status).toBe(403);
      expect((await get(noAb.token, "by-state")).status).toBe(403);
    });
  });

  describe("validation", () => {
    it("requires from and to as real IST dates, in order, within three years", async () => {
      const admin = await sessionFor("aa_admin");
      const bad = [
        "",
        "from=2026-01-01",
        "to=2026-12-31",
        "from=2026-1-1&to=2026-12-31",
        "from=2026-02-30&to=2026-12-31",
        "from=2026-12-31&to=2026-01-01",
        "from=2023-01-01&to=2026-01-01",
        `${YEAR}&foo=1`,
        `${YEAR}&page=0`,
        `${YEAR}&pageSize=101`,
        `${YEAR}&pageSize=abc`,
      ];
      for (const qs of bad) {
        for (const path of ["summary", "by-assessor"]) {
          if (path === "summary" && /page/.test(qs)) continue;
          const res = await get(admin.token, path, qs);
          expect(res.status, `${path}?${qs}`).toBe(400);
          expect(res.body.error.code).toBe("VALIDATION_ERROR");
        }
      }
      // The last day that fits in three years is accepted.
      expect((await get(admin.token, "summary", "from=2023-01-01&to=2025-12-31")).status).toBe(200);
      expect((await get(admin.token, "summary", "from=2024-02-29&to=2027-02-28")).status).toBe(200);
    });
  });

  describe("privacy", () => {
    it("returns counts and rates only, never a learner or candidate id", async () => {
      await seed();
      const admin = await sessionFor("aa_admin");
      for (const path of [
        "summary",
        "by-assessor",
        "by-training-partner",
        "by-job-role",
        "by-state",
      ]) {
        const res = await get(admin.token, path);
        const text = JSON.stringify(res.body);
        expect(text, path).not.toContain(String(learnerSentinel));
        expect(text, path).not.toMatch(/candidateId|learnerId|rows|outcome/);
      }
    });
  });

  it("does not change any data", async () => {
    await seed();
    const admin = await sessionFor("aa_admin");
    const before = await Batch.countDocuments();
    await get(admin.token, "by-assessor");
    expect(await Batch.countDocuments()).toBe(before);
    expect(
      (await request(app).post("/api/v1/analytics/summary").set(bearer(admin.token)).send({}))
        .status,
    ).toBe(404);
  });
});
