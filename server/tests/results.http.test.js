import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AttendanceRecord } from "../src/models/attendance-record.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { Qualification } from "../src/models/qualification.model.js";
import { ResultChangeLog } from "../src/models/result-change-log.model.js";
import { Result } from "../src/models/result.model.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const oid = () => new mongoose.Types.ObjectId();

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function expectError(res, status, code) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
}

async function sessionFor(role, extra = {}, email = `${role}@aa.example`) {
  const { password } = await createUser({ role, email, name: role, ...extra });
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, device: webDevice });
  expect(res.status).toBe(200);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

/**
 * An assessment_completed batch on a two-NOS percent qualification.
 * Roster: Asha (present), Bala (absent), Chitra (present), and one deactivated row.
 */
async function world({ batch: batchOverrides = {}, qualification = {}, attendance = true } = {}) {
  const ab = await AwardingBody.create({
    name: "AB One",
    code: "AB-01",
    notificationEmails: ["one@ab.example"],
    active: true,
  });
  const qual = await Qualification.create({
    code: "Q-ELEC-L4",
    name: "Electrician L4",
    sector: "Electronics",
    ratioClass: "manufacturing",
    passCriteriaMode: "nos_wise",
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    nos: [
      { nosId: "NOS-01", code: "N01", name: "Safety", pcs: [] },
      { nosId: "NOS-02", code: "N02", name: "Wiring", pcs: [] },
    ],
    ...qualification,
  });
  const assessorId = oid();
  const tpId = oid();
  const batch = await Batch.create({
    abId: ab._id,
    qualificationId: qual._id,
    type: "STT",
    mode: "offline",
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    tpId,
    centreId: oid(),
    candidateCount: 3,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Hindi",
    state: "Maharashtra",
    status: "assessment_completed",
    statusVersion: 5,
    assessorId,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2099-01-01T00:00:00.000Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...batchOverrides,
  });
  const learnerIds = [oid(), oid(), oid(), oid()];
  const names = ["Asha Devi", "Bala Kumar", "Chitra Rao", "Left Early"];
  const [asha, bala, chitra, gone] = await Candidate.create(
    names.map((name, index) => ({
      batchId: batch._id,
      learnerId: learnerIds[index],
      name,
      externalRef: `R-${index + 1}`,
      active: index < 3,
    })),
  );
  if (attendance) {
    const at = new Date("2026-11-20T05:00:00.000Z");
    await AttendanceRecord.create(
      [
        [asha, true],
        [bala, false],
        [chitra, true],
      ].map(([candidate, present]) => ({
        batchId: batch._id,
        candidateId: candidate._id,
        present,
        capturedAt: at,
        receivedAt: at,
        assessorId,
        recordedBy: oid(),
      })),
    );
  }
  return { ab, qual, batch, tpId, assessorId, learnerIds, asha, bala, chitra, gone };
}

const pass = [
  { nosId: "NOS-01", theory: 70, practical: 80, viva: 75 },
  { nosId: "NOS-02", theory: 60, practical: 65, viva: 55 },
];
const fail = [
  { nosId: "NOS-01", theory: 70, practical: 80, viva: 75 },
  { nosId: "NOS-02", theory: 49, practical: 65, viva: 55 },
];

function fullRows(w) {
  return [
    { candidateId: String(w.asha._id), nos: pass },
    { candidateId: String(w.bala._id), nos: [] },
    { candidateId: String(w.chitra._id), nos: fail },
  ];
}

function putResults(token, batchId, body) {
  return request(app).put(`/api/v1/batches/${batchId}/results`).set(bearer(token)).send(body);
}

function post(token, batchId, action, body = {}) {
  return request(app).post(`/api/v1/batches/${batchId}/${action}`).set(bearer(token)).send(body);
}

function getResults(token, batchId) {
  return request(app).get(`/api/v1/batches/${batchId}/results`).set(bearer(token));
}

function outcomes(body) {
  return Object.fromEntries(body.rows.map((row) => [row.candidateId, row.outcome]));
}

/** Draft → submitted → validated → published, as far as `upTo`. */
async function advance(w, admin, reviewer, upTo) {
  expect((await putResults(admin.token, w.batch._id, { rows: fullRows(w) })).status).toBe(200);
  expect((await post(admin.token, w.batch._id, "submit-result")).status).toBe(200);
  if (upTo === "submitted") return;
  expect((await post(reviewer.token, w.batch._id, "validate")).status).toBe(200);
  if (upTo === "validated") return;
  expect((await post(reviewer.token, w.batch._id, "publish")).status).toBe(200);
}

describe("results", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      Result.syncIndexes(),
      ResultChangeLog.syncIndexes(),
      AttendanceRecord.syncIndexes(),
      Batch.syncIndexes(),
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

  describe("PUT /batches/:id/results", () => {
    it("creates the draft with server outcomes and Absent from attendance", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");

      const res = await putResults(admin.token, w.batch._id, { rows: fullRows(w) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe("draft");
      expect(res.body.batchId).toBe(String(w.batch._id));
      expect(res.body.publishedAt).toBeNull();
      expect(outcomes(res.body)).toEqual({
        [w.asha._id]: "Pass",
        [w.bala._id]: "Absent",
        [w.chitra._id]: "Fail",
      });
      const bala = res.body.rows.find((row) => row.candidateId === String(w.bala._id));
      expect(bala).toEqual({
        candidateId: String(w.bala._id),
        absent: true,
        outcome: "Absent",
        nos: [],
      });

      const batch = await Batch.findById(w.batch._id).lean();
      expect(String(batch.resultId)).toBe(res.body.id);
      expect(batch.status).toBe("assessment_completed");
      expect(batch.statusVersion).toBe(5);

      const logs = await ResultChangeLog.find({ resultId: res.body.id }).lean();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: "save", fromStatus: null, toStatus: "draft" });
      expect(logs[0].changes).toHaveLength(3);
    });

    it("replaces the draft, leaves an unfinished row without an outcome, and logs only changes", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const first = await putResults(admin.token, w.batch._id, {
        rows: [{ candidateId: String(w.asha._id), nos: [pass[0]] }],
      });
      expect(first.status).toBe(200);
      expect(first.body.rows).toHaveLength(1);
      expect(first.body.rows[0].outcome).toBeNull();

      const second = await putResults(admin.token, w.batch._id, {
        rows: fullRows(w),
        changeReason: "Marks sheet received from the assessor",
      });
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.rows).toHaveLength(3);

      // Same body again: nothing changed, so no third change-log row.
      expect((await putResults(admin.token, w.batch._id, { rows: fullRows(w) })).status).toBe(200);
      const logs = await ResultChangeLog.find({}).sort({ _id: 1 }).lean();
      expect(logs).toHaveLength(2);
      expect(logs[1].reason).toBe("Marks sheet received from the assessor");
      const asha = logs[1].changes.find((c) => String(c.candidateId) === String(w.asha._id));
      expect(asha.before.outcome).toBeNull();
      expect(asha.after.outcome).toBe("Pass");
      expect(await Result.countDocuments({})).toBe(1);
    });

    it("is allowed only while the batch is assessment_completed and the result is draft", async () => {
      const w = await world({ batch: { status: "in_progress" } });
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      expectError(
        await putResults(admin.token, w.batch._id, { rows: fullRows(w) }),
        409,
        "INVALID_TRANSITION",
      );
      expect(await Result.countDocuments({})).toBe(0);

      await Batch.updateOne({ _id: w.batch._id }, { status: "assessment_completed" });
      await advance(w, admin, reviewer, "submitted");
      expectError(
        await putResults(admin.token, w.batch._id, { rows: fullRows(w) }),
        409,
        "INVALID_TRANSITION",
      );
      // A submitted result stays closed even if the batch status were put back.
      await Batch.updateOne({ _id: w.batch._id }, { status: "assessment_completed" });
      expectError(
        await putResults(admin.token, w.batch._id, { rows: fullRows(w) }),
        409,
        "INVALID_TRANSITION",
      );

      expectError(await putResults(admin.token, oid(), { rows: [] }), 404, "NOT_FOUND");
    });

    it("is aa_admin only", async () => {
      const w = await world();
      const roles = {
        mis: {},
        assessor: { linkedProfileId: w.assessorId },
        ab_reviewer: { abId: w.ab._id },
        tp: { tpId: w.tpId },
        candidate: { linkedProfileId: w.learnerIds[0] },
        ncvet_viewer: {},
        sme: {},
        proctor: {},
      };
      for (const [role, extra] of Object.entries(roles)) {
        const session = await sessionFor(role, extra);
        expectError(
          await putResults(session.token, w.batch._id, { rows: fullRows(w) }),
          403,
          "FORBIDDEN",
        );
      }
      expectError(
        await request(app).put(`/api/v1/batches/${w.batch._id}/results`).send({ rows: [] }),
        401,
        "UNAUTHORIZED",
      );
      expect(await Result.countDocuments({})).toBe(0);
    });

    it("rejects rows that conflict with attendance or the roster", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const bad = [
        // Present in attendance, sent as absent.
        [{ candidateId: String(w.asha._id), absent: true, nos: [] }],
        // Absent in attendance, sent as not absent.
        [{ candidateId: String(w.bala._id), absent: false, nos: [] }],
        // Absent in attendance, with marks.
        [{ candidateId: String(w.bala._id), nos: pass }],
        // Deactivated roster row.
        [{ candidateId: String(w.gone._id), nos: pass }],
        // Not on this batch.
        [{ candidateId: String(oid()), nos: pass }],
        // NOS that the qualification does not have.
        [{ candidateId: String(w.asha._id), nos: [{ nosId: "NOS-99", theory: 50 }] }],
      ];
      for (const rows of bad) {
        const res = await putResults(admin.token, w.batch._id, { rows });
        expectError(res, 400, "VALIDATION_ERROR");
        expect(res.body.error.details.rows).toHaveLength(1);
      }

      const shape = [
        { rows: [{ candidateId: "nope", nos: [] }] },
        { rows: [fullRows(w)[0], fullRows(w)[0]] },
        { rows: [{ candidateId: String(w.asha._id), nos: [pass[0], pass[0]] }] },
        { rows: [{ candidateId: String(w.asha._id), nos: [{ nosId: "NOS-01", theory: -1 }] }] },
        { rows: [{ candidateId: String(w.asha._id), nos: [], status: "published" }] },
        { rows: fullRows(w), status: "published" },
        {},
      ];
      for (const body of shape) {
        expectError(await putResults(admin.token, w.batch._id, body), 400, "VALIDATION_ERROR");
      }
      expect(await Result.countDocuments({})).toBe(0);
    });

    it("lets a row declare Absent only when there is no attendance row", async () => {
      const w = await world({ attendance: false });
      const admin = await sessionFor("aa_admin");
      const res = await putResults(admin.token, w.batch._id, {
        rows: [
          { candidateId: String(w.asha._id), nos: pass },
          { candidateId: String(w.bala._id), absent: true, nos: [] },
          { candidateId: String(w.chitra._id), nos: [] },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(outcomes(res.body)).toEqual({
        [w.asha._id]: "Pass",
        [w.bala._id]: "Absent",
        [w.chitra._id]: null,
      });
    });

    it("uses passMarkUnit, the ceilings, and the pass criteria of the qualification", async () => {
      const w = await world({
        qualification: {
          passMarkUnit: "absolute",
          passCriteriaMode: "overall",
          passMarks: { theory: 40, practical: 30, viva: 10 },
          maxMarks: { theory: 40, practical: 30, viva: 10 },
        },
      });
      const admin = await sessionFor("aa_admin");
      const row = (candidate, theory2) => ({
        candidateId: String(candidate._id),
        nos: [
          { nosId: "NOS-01", theory: 15, practical: 20, viva: 5 },
          { nosId: "NOS-02", theory: theory2, practical: 10, viva: 5 },
        ],
      });
      // Overall, absolute: theory 15 + 25 = 40 passes, 15 + 24 = 39 fails.
      const res = await putResults(admin.token, w.batch._id, {
        rows: [row(w.asha, 25), row(w.chitra, 24)],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(outcomes(res.body)).toEqual({ [w.asha._id]: "Pass", [w.chitra._id]: "Fail" });

      const over = await putResults(admin.token, w.batch._id, { rows: [row(w.asha, 41)] });
      expectError(over, 400, "RESULT_PASS_MARK_INVALID");
      expect(over.body.error.details).toEqual({
        candidateId: String(w.asha._id),
        nosId: "NOS-02",
        component: "theory",
        max: 40,
      });

      // Percent with no ceiling is marked out of 100.
      await Qualification.updateOne(
        { _id: w.qual._id },
        {
          passMarkUnit: "percent",
          maxMarks: null,
          passMarks: { theory: 50, practical: 50, viva: 50 },
        },
      );
      expectError(
        await putResults(admin.token, w.batch._id, {
          rows: [{ candidateId: String(w.asha._id), nos: [{ nosId: "NOS-01", theory: 100.5 }] }],
        }),
        400,
        "RESULT_PASS_MARK_INVALID",
      );
    });

    it("rejects a client outcome that differs from the computed one", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const res = await putResults(admin.token, w.batch._id, {
        rows: [
          { candidateId: String(w.asha._id), nos: pass, outcome: "Pass" },
          { candidateId: String(w.chitra._id), nos: fail, outcome: "Pass" },
          { candidateId: String(w.bala._id), nos: [], outcome: "Fail" },
        ],
      });
      expectError(res, 400, "RESULT_OUTCOME_MISMATCH");
      expect(res.body.error.details.rows).toEqual([
        { candidateId: String(w.chitra._id), outcome: "Fail" },
        { candidateId: String(w.bala._id), outcome: "Absent" },
      ]);
      expect(await Result.countDocuments({})).toBe(0);

      const ok = await putResults(admin.token, w.batch._id, {
        rows: fullRows(w).map((row, index) => ({
          ...row,
          outcome: ["Pass", "Absent", "Fail"][index],
        })),
      });
      expect(ok.status).toBe(200);
    });
  });

  describe("POST /batches/:id/submit-result", () => {
    it("returns RESULT_INCOMPLETE until every active candidate has a complete row", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");

      const none = await post(admin.token, w.batch._id, "submit-result");
      expectError(none, 409, "RESULT_INCOMPLETE");
      expect(none.body.error.details.missingCandidates).toHaveLength(3);

      await putResults(admin.token, w.batch._id, {
        rows: [
          { candidateId: String(w.asha._id), nos: pass },
          { candidateId: String(w.chitra._id), nos: [pass[0]] },
        ],
      });
      const partial = await post(admin.token, w.batch._id, "submit-result");
      expectError(partial, 409, "RESULT_INCOMPLETE");
      // The deactivated roster row is not required.
      expect(partial.body.error.details).toEqual({
        missingCandidates: [String(w.bala._id)],
        incompleteMarks: [String(w.chitra._id)],
      });

      const batch = await Batch.findById(w.batch._id).lean();
      expect(batch.status).toBe("assessment_completed");
      expect((await Result.findOne({}).lean()).status).toBe("draft");
      expect(await ResultChangeLog.countDocuments({ action: "submit" })).toBe(0);
    });

    it("recomputes outcomes, moves batch and result, and writes a change log", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      await putResults(admin.token, w.batch._id, { rows: fullRows(w) });
      // The pass mark rises after the draft was saved: submit must use the new rule.
      await Qualification.updateOne(
        { _id: w.qual._id },
        { passMarks: { theory: 65, practical: 50, viva: 50 } },
      );

      const res = await post(admin.token, w.batch._id, "submit-result");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe("submitted");
      expect(res.body.batchStatus).toBe("result_submitted");
      expect(res.body.batchStatusVersion).toBe(6);
      expect(res.body.submittedBy).toBe(admin.userId);
      expect(res.body.submittedAt).not.toBeNull();
      expect(outcomes(res.body)).toEqual({
        [w.asha._id]: "Fail",
        [w.bala._id]: "Absent",
        [w.chitra._id]: "Fail",
      });

      const batch = await Batch.findById(w.batch._id).lean();
      expect(batch.status).toBe("result_submitted");
      expect(batch.sla.breached).toEqual([]);

      const log = await ResultChangeLog.findOne({ action: "submit" }).lean();
      expect(log).toMatchObject({ fromStatus: "draft", toStatus: "submitted", byRole: "aa_admin" });
      expect(log.changes).toHaveLength(1);
      expect(String(log.changes[0].candidateId)).toBe(String(w.asha._id));
      expect(log.changes[0].before.outcome).toBe("Pass");
      expect(log.changes[0].after.outcome).toBe("Fail");

      expectError(await post(admin.token, w.batch._id, "submit-result"), 409, "INVALID_TRANSITION");
    });

    it("needs lateReason after resultDueAt and records the breach", async () => {
      const w = await world({
        batch: {
          sla: {
            acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
            assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
            resultDueAt: new Date("2020-01-01T00:00:00.000Z"),
          },
        },
      });
      const admin = await sessionFor("aa_admin");
      await putResults(admin.token, w.batch._id, { rows: fullRows(w) });

      expectError(await post(admin.token, w.batch._id, "submit-result"), 409, "SLA_RESULT_EXPIRED");
      expect((await Batch.findById(w.batch._id).lean()).status).toBe("assessment_completed");

      const reason = "Marks verification with TP took extra day";
      const res = await post(admin.token, w.batch._id, "submit-result", { lateReason: reason });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const batch = await Batch.findById(w.batch._id).lean();
      expect(batch.sla.breached).toEqual(["result"]);
      expect(batch.sla.lateActions).toHaveLength(1);
      expect(batch.sla.lateActions[0]).toMatchObject({ key: "result", reason });
      const audit = await AuditLog.findOne({ action: "sla_late_submit" }).lean();
      expect(audit.meta).toEqual({ reason, key: "result" });
    });

    it("is aa_admin only", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      await putResults(admin.token, w.batch._id, { rows: fullRows(w) });
      for (const [role, extra] of [
        ["mis", {}],
        ["ab_reviewer", { abId: w.ab._id }],
        ["assessor", { linkedProfileId: w.assessorId }],
      ]) {
        const session = await sessionFor(role, extra);
        expectError(await post(session.token, w.batch._id, "submit-result"), 403, "FORBIDDEN");
      }
      expectError(
        await post(admin.token, w.batch._id, "submit-result", { rows: [] }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(await post(admin.token, oid(), "submit-result"), 404, "NOT_FOUND");
    });
  });

  describe("POST /batches/:id/validate and /publish", () => {
    it("lets the batch's awarding body reviewer validate, then publish with publishedAt", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      await advance(w, admin, reviewer, "submitted");

      // Publish before validate is not a legal move.
      expectError(await post(reviewer.token, w.batch._id, "publish"), 409, "INVALID_TRANSITION");

      const validated = await post(reviewer.token, w.batch._id, "validate", {
        reason: "Checked against the marks sheet",
      });
      expect(validated.status, JSON.stringify(validated.body)).toBe(200);
      expect(validated.body.status).toBe("validated");
      expect(validated.body.batchStatus).toBe("ab_validated");
      expect(validated.body.validatedBy).toBe(reviewer.userId);
      expect(validated.body.publishedAt).toBeNull();
      expectError(await post(reviewer.token, w.batch._id, "validate"), 409, "INVALID_TRANSITION");

      const before = Date.now();
      const published = await post(reviewer.token, w.batch._id, "publish");
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(published.body.status).toBe("published");
      expect(published.body.batchStatus).toBe("published");
      expect(published.body.batchStatusVersion).toBe(8);
      expect(published.body.publishedBy).toBe(reviewer.userId);

      const stored = await Result.findOne({ batchId: w.batch._id }).lean();
      expect(stored.publishedAt).toBeInstanceOf(Date);
      expect(stored.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stored.publishedAt.toISOString()).toBe(published.body.publishedAt);
      expect((await Batch.findById(w.batch._id).lean()).status).toBe("published");

      const logs = await ResultChangeLog.find({}).sort({ _id: 1 }).lean();
      expect(logs.map((row) => row.action)).toEqual(["save", "submit", "validate", "publish"]);
      expect(logs[2].reason).toBe("Checked against the marks sheet");
      expect(logs[3]).toMatchObject({ fromStatus: "validated", toStatus: "published" });

      expectError(await post(reviewer.token, w.batch._id, "publish"), 409, "INVALID_TRANSITION");
    });

    it("denies other roles and a reviewer of another awarding body", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      const other = await sessionFor("ab_reviewer", { abId: oid() }, "other-ab@aa.example");
      const unlinked = await sessionFor("ab_reviewer", {}, "no-ab@aa.example");
      const mis = await sessionFor("mis");
      await advance(w, admin, reviewer, "submitted");

      for (const action of ["validate", "publish"]) {
        for (const session of [admin, mis, other, unlinked]) {
          expectError(await post(session.token, w.batch._id, action), 403, "FORBIDDEN");
        }
      }
      expect((await Result.findOne({}).lean()).status).toBe("submitted");
      expectError(await post(reviewer.token, oid(), "validate"), 404, "NOT_FOUND");
    });

    it("does not mount dispute or resolve-dispute", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      await advance(w, admin, reviewer, "submitted");
      for (const action of ["dispute", "resolve-dispute"]) {
        for (const session of [admin, reviewer]) {
          expectError(await post(session.token, w.batch._id, action), 404, "NOT_FOUND");
        }
      }
      expect((await Batch.findById(w.batch._id).lean()).status).toBe("result_submitted");
    });
  });

  describe("GET /batches/:id/results", () => {
    it("shows a candidate only their own row, and only once published", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      const chitra = await sessionFor("candidate", { linkedProfileId: w.learnerIds[2] });
      const stranger = await sessionFor(
        "candidate",
        { linkedProfileId: oid() },
        "stranger@aa.example",
      );
      const tp = await sessionFor("tp", { tpId: w.tpId });

      expectError(await getResults(admin.token, w.batch._id), 404, "NOT_FOUND");
      await advance(w, admin, reviewer, "validated");
      expectError(await getResults(chitra.token, w.batch._id), 404, "NOT_FOUND");
      expectError(await getResults(tp.token, w.batch._id), 404, "NOT_FOUND");

      expect((await post(reviewer.token, w.batch._id, "publish")).status).toBe(200);
      const own = await getResults(chitra.token, w.batch._id);
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.status).toBe("published");
      expect(own.body.rows).toHaveLength(1);
      expect(own.body.rows[0].candidateId).toBe(String(w.chitra._id));
      expect(own.body.rows[0].outcome).toBe("Fail");
      expect(JSON.stringify(own.body)).not.toContain(String(w.asha._id));

      expectError(await getResults(stranger.token, w.batch._id), 403, "FORBIDDEN");
      expect((await getResults(tp.token, w.batch._id)).body.rows).toHaveLength(3);
    });

    it("follows batch row scope for the other roles", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      await putResults(admin.token, w.batch._id, { rows: fullRows(w) });

      const readers = {
        mis: {},
        ncvet_viewer: {},
        ab_reviewer: { abId: w.ab._id },
        assessor: { linkedProfileId: w.assessorId },
      };
      for (const [role, extra] of Object.entries(readers)) {
        const session = await sessionFor(role, extra);
        const res = await getResults(session.token, w.batch._id);
        expect(res.status, role).toBe(200);
        expect(res.body.rows).toHaveLength(3);
      }

      const otherAb = await sessionFor("ab_reviewer", { abId: oid() }, "other-ab@aa.example");
      const otherAssessor = await sessionFor(
        "assessor",
        { linkedProfileId: oid() },
        "other-asr@aa.example",
      );
      const sme = await sessionFor("sme");
      const proctor = await sessionFor("proctor", { linkedProfileId: oid() });
      for (const session of [otherAb, otherAssessor, sme, proctor]) {
        expectError(await getResults(session.token, w.batch._id), 403, "FORBIDDEN");
      }
      expectError(await getResults(admin.token, oid()), 404, "NOT_FOUND");
    });
  });

  describe("GET /results/:id/change-log", () => {
    it("lists the log oldest first for aa_admin, mis, and the batch's reviewer", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      await advance(w, admin, reviewer, "submitted");
      const result = await Result.findOne({}).lean();
      const get = (token, id = result._id) =>
        request(app).get(`/api/v1/results/${id}/change-log`).set(bearer(token));

      const res = await get(admin.token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.items.map((item) => item.action)).toEqual(["save", "submit"]);
      expect(res.body.items[0]).toMatchObject({
        resultId: String(result._id),
        batchId: String(w.batch._id),
        fromStatus: null,
        toStatus: "draft",
        byUserId: admin.userId,
        byRole: "aa_admin",
        reason: null,
      });
      expect(res.body.items[0].changes).toHaveLength(3);

      expect((await get((await sessionFor("mis")).token)).status).toBe(200);
      expect((await get(reviewer.token)).status).toBe(200);

      const otherAb = await sessionFor("ab_reviewer", { abId: oid() }, "other-ab@aa.example");
      expectError(await get(otherAb.token), 403, "FORBIDDEN");
      for (const role of ["ncvet_viewer", "tp", "assessor", "candidate", "sme"]) {
        expectError(await get((await sessionFor(role)).token), 403, "FORBIDDEN");
      }
      expectError(await get(admin.token, oid()), 404, "NOT_FOUND");
    });
  });

  describe("audit", () => {
    it("writes one row per write, scoped to the batch, with no secrets", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      const reviewer = await sessionFor("ab_reviewer", { abId: w.ab._id });
      // auditLogs are append-only, so read the rows written after this marker.
      const since = oid();
      await advance(w, admin, reviewer, "published");

      const rows = await AuditLog.find({ _id: { $gt: since } })
        .sort({ _id: 1 })
        .lean();
      expect(rows.map((row) => row.action).sort()).toEqual(
        [
          "result.save",
          "result.submit",
          "batch.submit-result",
          "result.validate",
          "batch.validate",
          "result.publish",
          "batch.publish",
        ].sort(),
      );
      for (const row of rows) {
        expect(String(row.batchId)).toBe(String(w.batch._id));
        expect(String(row.abId)).toBe(String(w.ab._id));
        expect(row.actorId).toBeTruthy();
      }
      const publish = rows.find((row) => row.action === "result.publish");
      expect(publish.actorRole).toBe("ab_reviewer");
      expect(publish.before.status).toBe("validated");
      expect(publish.after.status).toBe("published");
      expect(publish.after.publishedAt).toBeTruthy();
      const move = rows.find((row) => row.action === "batch.publish");
      expect(move.before.status).toBe("ab_validated");
      expect(move.after).toMatchObject({ status: "published", resultStatus: "published" });

      const text = JSON.stringify(rows);
      expect(text).not.toMatch(/passwordHash|accessToken|refreshToken|Bearer |eyJ/);
      expect(text).not.toContain(admin.token);
      expect(text).not.toContain(reviewer.token);
    });

    it("does not log a rejected write", async () => {
      const w = await world();
      const admin = await sessionFor("aa_admin");
      // auditLogs are append-only, so read the rows written after this marker.
      const since = oid();
      expectError(await post(admin.token, w.batch._id, "submit-result"), 409, "RESULT_INCOMPLETE");
      expectError(
        await putResults(admin.token, w.batch._id, {
          rows: [{ candidateId: String(w.asha._id), absent: true, nos: [] }],
        }),
        400,
        "VALIDATION_ERROR",
      );
      expect(await AuditLog.countDocuments({ _id: { $gt: since } })).toBe(0);
    });
  });
});
