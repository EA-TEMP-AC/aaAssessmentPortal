import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AssessorPayment } from "../src/models/assessor-payment.model.js";
import { AccessSettings } from "../src/models/access-settings.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { Batch } from "../src/models/batch.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();
const oid = () => new mongoose.Types.ObjectId();

const abId = oid();
const tpId = oid();
const assessorA = oid();
const assessorB = oid();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}) {
  const email = `${role}-${new mongoose.Types.ObjectId()}@aa.example`;
  const { password } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function makeBatch(overrides = {}) {
  const _id = oid();
  return Batch.create({
    _id,
    abId,
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId,
    centreId: oid(),
    candidateCount: 3,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Marathi",
    state: "Maharashtra",
    status: "assessor_assigned",
    statusVersion: 4,
    isReassessment: false,
    firstAssessmentBatchId: _id,
    assessorId: assessorA,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...overrides,
  });
}

const put = (token, id, body) =>
  request(app).put(`/api/v1/batches/${id}/assessor-payment`).set(bearer(token)).send(body);
const listBatch = (token, id, qs = "") =>
  request(app).get(`/api/v1/batches/${id}/assessor-payments${qs}`).set(bearer(token));
const list = (token, qs = "") =>
  request(app).get(`/api/v1/assessor-payments${qs}`).set(bearer(token));

describe("assessor payments", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([Batch.syncIndexes(), AssessorPayment.syncIndexes(), AuditLog.syncIndexes()]);
  });
  afterAll(async () => {
    await stopMongo();
  });
  beforeEach(async () => {
    await clearCollections();
    resetLoginRateLimit();
  });

  describe("PUT /batches/:id/assessor-payment", () => {
    it("creates the row and sets pending on the server", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      const res = await put(admin.token, batch._id, {
        amountDue: 4500,
        amountPaid: 2000,
        logisticsNote: "Rail ticket booked",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        batchId: String(batch._id),
        assessorId: String(assessorA),
        amountDue: 4500,
        amountPaid: 2000,
        pending: 2500,
        logisticsNote: "Rail ticket booked",
        updatedBy: admin.userId,
      });
      const stored = await Batch.findById(batch._id).lean();
      expect(stored.status).toBe("assessor_assigned");
      expect(stored.statusVersion).toBe(4);
    });

    it("computes pending exactly for decimal amounts", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      const cases = [
        [0.3, 0.1, 0.2],
        [100.1, 100.1, 0],
        [1234.56, 0.01, 1234.55],
        [0, 0, 0],
      ];
      for (const [amountDue, amountPaid, pending] of cases) {
        const res = await put(admin.token, batch._id, { amountDue, amountPaid });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.pending).toBe(pending);
        expect(res.body.logisticsNote).toBeNull();
      }
    });

    it("never accepts pending from the client", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      expectError(
        await put(admin.token, batch._id, { amountDue: 100, amountPaid: 40, pending: 0 }),
        400,
        "VALIDATION_ERROR",
      );
      expect(await AssessorPayment.countDocuments()).toBe(0);
    });

    it("lets mis write, and replaces the one row on a second PUT", async () => {
      const batch = await makeBatch();
      const mis = await sessionFor("mis");
      await put(mis.token, batch._id, { amountDue: 1000, amountPaid: 0, logisticsNote: "first" });
      const res = await put(mis.token, batch._id, { amountDue: 1000, amountPaid: 1000 });
      expect(res.status).toBe(200);
      expect(res.body.pending).toBe(0);
      expect(res.body.logisticsNote).toBeNull();
      expect(await AssessorPayment.countDocuments()).toBe(1);
    });

    it("rejects invalid amounts", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      for (const body of [
        { amountDue: 100, amountPaid: 100.01 },
        { amountDue: -1, amountPaid: 0 },
        { amountDue: 100, amountPaid: -1 },
        { amountDue: 10.123, amountPaid: 0 },
        { amountDue: "100", amountPaid: 0 },
        { amountDue: 100 },
        { amountPaid: 0 },
        {},
        { amountDue: 100, amountPaid: 0, logisticsNote: "x".repeat(2001) },
        { amountDue: 100, amountPaid: 0, extra: true },
        { amountDue: 100, amountPaid: 0, assessorId: "nope" },
      ]) {
        expectError(await put(admin.token, batch._id, body), 400, "VALIDATION_ERROR");
      }
      const over = await put(admin.token, batch._id, { amountDue: 100, amountPaid: 150 });
      expect(over.body.error.details.amountPaid).toBeDefined();
      expect(await AssessorPayment.countDocuments()).toBe(0);
    });

    it("needs an assigned assessor", async () => {
      const batch = await makeBatch({ assessorId: null, status: "accepted" });
      const admin = await sessionFor("aa_admin");
      expectError(
        await put(admin.token, batch._id, { amountDue: 100, amountPaid: 0 }),
        409,
        "INVALID_TRANSITION",
      );
      expect(await AssessorPayment.countDocuments()).toBe(0);
    });

    it("keeps the previous assessor's row when the batch is reassigned", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      await put(admin.token, batch._id, { amountDue: 1000, amountPaid: 250 });
      await Batch.updateOne({ _id: batch._id }, { $set: { assessorId: assessorB } });

      const next = await put(admin.token, batch._id, { amountDue: 2000, amountPaid: 0 });
      expect(next.body.assessorId).toBe(String(assessorB));
      expect(await AssessorPayment.countDocuments()).toBe(2);

      const old = await put(admin.token, batch._id, {
        assessorId: String(assessorA),
        amountDue: 1000,
        amountPaid: 1000,
      });
      expect(old.status, JSON.stringify(old.body)).toBe(200);
      expect(old.body).toMatchObject({ assessorId: String(assessorA), pending: 0 });

      const stranger = await put(admin.token, batch._id, {
        assessorId: String(oid()),
        amountDue: 1,
        amountPaid: 0,
      });
      expectError(stranger, 400, "VALIDATION_ERROR");
      expect(await AssessorPayment.countDocuments()).toBe(2);
    });

    it("answers 404 for an unknown batch and 400 for a malformed id", async () => {
      const admin = await sessionFor("aa_admin");
      const body = { amountDue: 1, amountPaid: 0 };
      expectError(await put(admin.token, oid(), body), 404, "NOT_FOUND");
      expectError(await put(admin.token, "nope", body), 400, "VALIDATION_ERROR");
    });

    it("refuses every role except aa_admin and mis", async () => {
      const batch = await makeBatch();
      const sessions = [
        await sessionFor("ncvet_viewer"),
        await sessionFor("ab_reviewer", { abId }),
        await sessionFor("assessor", { linkedProfileId: assessorA }),
        await sessionFor("proctor", { linkedProfileId: oid() }),
        await sessionFor("tp", { tpId }),
        await sessionFor("candidate", { linkedProfileId: oid() }),
        await sessionFor("sme"),
      ];
      for (const s of sessions) {
        expectError(
          await put(s.token, batch._id, { amountDue: 1, amountPaid: 0 }),
          403,
          "FORBIDDEN",
        );
      }
      const anon = await request(app)
        .put(`/api/v1/batches/${batch._id}/assessor-payment`)
        .send({ amountDue: 1, amountPaid: 0 });
      expect(anon.status).toBe(401);
      expect(await AssessorPayment.countDocuments()).toBe(0);
    });

    it("writes one audit row per write, with before and after", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      await put(admin.token, batch._id, { amountDue: 500, amountPaid: 100, logisticsNote: "n1" });
      await put(admin.token, batch._id, { amountDue: 500, amountPaid: 500 });
      const rows = await AuditLog.find({ action: "assessor_payment.save" })
        .sort({ createdAt: 1 })
        .lean();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        entity: "assessorPayment",
        actorRole: "aa_admin",
      });
      expect(String(rows[0].batchId)).toBe(String(batch._id));
      expect(String(rows[0].abId)).toBe(String(abId));
      expect(rows[0].before ?? null).toBeNull();
      expect(rows[0].after).toMatchObject({ amountDue: 500, amountPaid: 100, pending: 400 });
      expect(rows[1].before).toMatchObject({ pending: 400, logisticsNote: "n1" });
      expect(rows[1].after).toMatchObject({ amountPaid: 500, pending: 0 });
      expect(JSON.stringify(rows)).not.toMatch(/token|password|hash/i);
    });

    it("writes no audit row for a refused write", async () => {
      const batch = await makeBatch();
      const admin = await sessionFor("aa_admin");
      await put(admin.token, batch._id, { amountDue: 1, amountPaid: 5 });
      expect(await AuditLog.countDocuments({ action: "assessor_payment.save" })).toBe(0);
    });
  });

  describe("GET lists", () => {
    async function seed() {
      const b1 = await makeBatch({ assessorId: assessorA });
      const b2 = await makeBatch({ assessorId: assessorB });
      const b3 = await makeBatch({ assessorId: assessorA });
      const admin = await sessionFor("aa_admin");
      await put(admin.token, b1._id, { amountDue: 1000, amountPaid: 400 });
      await put(admin.token, b2._id, { amountDue: 2000, amountPaid: 2000 });
      await put(admin.token, b3._id, { amountDue: 3000, amountPaid: 0 });
      return { b1, b2, b3, admin };
    }

    it("pages the list across batches", async () => {
      const { admin } = await seed();
      const all = await list(admin.token);
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
      expect(all.body.items).toHaveLength(3);

      const first = await list(admin.token, "?page=1&pageSize=2");
      const second = await list(admin.token, "?page=2&pageSize=2");
      expect(first.body.items).toHaveLength(2);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.total).toBe(3);
      const ids = [...first.body.items, ...second.body.items].map((row) => row.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("filters by assessorId and by pending only", async () => {
      const { admin } = await seed();
      const byAssessor = await list(admin.token, `?assessorId=${assessorA}`);
      expect(byAssessor.body.total).toBe(2);
      expect(byAssessor.body.items.every((row) => row.assessorId === String(assessorA))).toBe(true);

      const pending = await list(admin.token, "?pendingOnly=true");
      expect(pending.body.total).toBe(2);
      expect(pending.body.items.every((row) => row.pending > 0)).toBe(true);

      const both = await list(admin.token, `?pendingOnly=true&assessorId=${assessorB}`);
      expect(both.body.total).toBe(0);
      const falsy = await list(admin.token, "?pendingOnly=false");
      expect(falsy.body.total).toBe(3);
    });

    it("rejects bad query values", async () => {
      const { admin } = await seed();
      for (const qs of [
        "?page=0",
        "?pageSize=101",
        "?pendingOnly=yes",
        "?assessorId=x",
        "?foo=1",
      ]) {
        expectError(await list(admin.token, qs), 400, "VALIDATION_ERROR");
      }
    });

    it("lists one batch's rows, with the same filters", async () => {
      const { b1, admin } = await seed();
      const res = await listBatch(admin.token, b1._id);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].batchId).toBe(String(b1._id));
      expect((await listBatch(admin.token, b1._id, "?pendingOnly=true")).body.total).toBe(1);
      expectError(await listBatch(admin.token, oid()), 404, "NOT_FOUND");
    });

    it("lets mis and ncvet_viewer read everything", async () => {
      const { b1 } = await seed();
      for (const role of ["mis", "ncvet_viewer"]) {
        const s = await sessionFor(role);
        expect((await list(s.token)).body.total).toBe(3);
        expect((await listBatch(s.token, b1._id)).body.total).toBe(1);
      }
    });

    it("shows an assessor only their own payments", async () => {
      const { b1, b2 } = await seed();
      const a = await sessionFor("assessor", { linkedProfileId: assessorA });
      const mine = await list(a.token);
      expect(mine.status).toBe(200);
      expect(mine.body.total).toBe(2);
      expect(mine.body.items.every((row) => row.assessorId === String(assessorA))).toBe(true);

      expect((await list(a.token, `?assessorId=${assessorB}`)).body).toMatchObject({
        total: 0,
        items: [],
      });
      expect((await listBatch(a.token, b1._id)).body.total).toBe(1);
      expect((await listBatch(a.token, b2._id)).body.total).toBe(0);

      const unlinked = await sessionFor("assessor");
      expectError(await list(unlinked.token), 403, "FORBIDDEN");
    });

    it("denies every other role", async () => {
      const { b1 } = await seed();
      const sessions = [
        await sessionFor("ab_reviewer", { abId }),
        await sessionFor("proctor", { linkedProfileId: oid() }),
        await sessionFor("tp", { tpId }),
        await sessionFor("candidate", { linkedProfileId: oid() }),
        await sessionFor("sme"),
      ];
      for (const s of sessions) {
        expectError(await list(s.token), 403, "FORBIDDEN");
        expectError(await listBatch(s.token, b1._id), 403, "FORBIDDEN");
      }
      expect((await request(app).get("/api/v1/assessor-payments")).status).toBe(401);
    });
  });

  describe("ab_reviewer read access (Q161, decision 174)", () => {
    async function seedTwoAbs() {
      const own = await makeBatch();
      const other = await makeBatch({ abId: oid() });
      const admin = await sessionFor("aa_admin");
      await put(admin.token, own._id, { amountDue: 1000, amountPaid: 0 });
      await put(admin.token, other._id, { amountDue: 2000, amountPaid: 0 });
      return { own, other, admin };
    }
    const setFlag = (value) =>
      AccessSettings.updateOne(
        { key: "access" },
        { $set: { abReviewerCanReadAssessorPayments: value } },
        { upsert: true },
      );

    it("is denied by default, and when the flag is explicitly false", async () => {
      const { own } = await seedTwoAbs();
      const reviewer = await sessionFor("ab_reviewer", { abId });
      expectError(await list(reviewer.token), 403, "FORBIDDEN");
      expectError(await listBatch(reviewer.token, own._id), 403, "FORBIDDEN");
      await setFlag(false);
      expectError(await list(reviewer.token), 403, "FORBIDDEN");
    });

    it("reads only its own awarding body's rows once the flag is on", async () => {
      const { own, other } = await seedTwoAbs();
      await setFlag(true);
      const reviewer = await sessionFor("ab_reviewer", { abId });

      const all = await list(reviewer.token);
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.total).toBe(1);
      expect(all.body.items[0].batchId).toBe(String(own._id));

      expect((await listBatch(reviewer.token, own._id)).body.total).toBe(1);
      expectError(await listBatch(reviewer.token, other._id), 403, "FORBIDDEN");
      expectError(await listBatch(reviewer.token, oid()), 404, "NOT_FOUND");
    });

    it("still refuses writes, and refuses a reviewer with no awarding body", async () => {
      const { own } = await seedTwoAbs();
      await setFlag(true);
      const reviewer = await sessionFor("ab_reviewer", { abId });
      expectError(
        await put(reviewer.token, own._id, { amountDue: 1, amountPaid: 0 }),
        403,
        "FORBIDDEN",
      );
      const noAb = await sessionFor("ab_reviewer");
      expectError(await list(noAb.token), 403, "FORBIDDEN");
    });

    it("turns off again when the flag is switched back", async () => {
      await seedTwoAbs();
      const reviewer = await sessionFor("ab_reviewer", { abId });
      await setFlag(true);
      expect((await list(reviewer.token)).status).toBe(200);
      await setFlag(false);
      expectError(await list(reviewer.token), 403, "FORBIDDEN");
    });
  });
});
