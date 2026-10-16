import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { Assessor } from "../src/models/assessor.model.js";
import { AttendanceRecord } from "../src/models/attendance-record.model.js";
import { AuditLog } from "../src/models/audit-log.model.js";
import { AwardingBody } from "../src/models/awarding-body.model.js";
import { Batch } from "../src/models/batch.model.js";
import { Candidate } from "../src/models/candidate.model.js";
import { EquipmentChecklist } from "../src/models/equipment-checklist.model.js";
import { LoginEvent } from "../src/models/login-event.model.js";
import { Proctor } from "../src/models/proctor.model.js";
import {
  absentCandidateIds,
  attendanceByCandidate,
} from "../src/modules/attendance/attendance.service.js";
import { resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import { clearCollections, startMongo, stopMongo } from "./helpers/db.js";
import { createUser, webDevice } from "./helpers/fixtures.js";

const app = createApp();

const WINDOW_START = "2026-11-20";
const WINDOW_END = "2026-11-21";
/** 10:30 IST on the first assessment day. */
const CAPTURED_AT = "2026-11-20T05:00:00.000Z";
const LATER_AT = "2026-11-20T09:00:00.000Z";

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

/** An in-progress batch with an assessor, a proctor, two active roster rows and one deactivated. */
async function world(overrides = {}) {
  const ab = await AwardingBody.create({
    name: "AB One",
    code: "AB-01",
    notificationEmails: ["one@ab.example"],
    active: true,
  });
  const assessor = await Assessor.create({ name: "Ravi Assessor", code: "ASR-1" });
  const proctor = await Proctor.create({ name: "Priya Proctor", code: "PRC-1" });
  const batch = await Batch.create({
    abId: ab._id,
    qualificationId: oid(),
    type: "STT",
    mode: "offline",
    assessmentStartDate: WINDOW_START,
    assessmentEndDate: WINDOW_END,
    tpId: oid(),
    centreId: oid(),
    candidateCount: 2,
    sector: "Electronics",
    ratioClass: "manufacturing",
    assessmentLanguage: "Hindi",
    state: "Maharashtra",
    status: "in_progress",
    statusVersion: 4,
    assessorId: assessor._id,
    proctorId: proctor._id,
    sla: {
      acceptDueAt: new Date("2026-10-12T18:29:59.999Z"),
      assignDueAt: new Date("2026-10-19T18:29:59.999Z"),
      resultDueAt: new Date("2026-11-25T18:29:59.999Z"),
    },
    allocatedAt: new Date("2026-10-08T08:00:00.000Z"),
    ...overrides,
  });
  const learnerIds = [oid(), oid(), oid()];
  const [asha, bala, gone] = await Candidate.create([
    {
      batchId: batch._id,
      learnerId: learnerIds[0],
      name: "Asha Devi",
      externalRef: "R-1",
      active: true,
    },
    {
      batchId: batch._id,
      learnerId: learnerIds[1],
      name: "Bala Kumar",
      externalRef: "R-2",
      active: true,
    },
    {
      batchId: batch._id,
      learnerId: learnerIds[2],
      name: "Left Early",
      externalRef: "R-3",
      active: false,
    },
  ]);
  return { ab, assessor, proctor, batch, learnerIds, asha, bala, gone };
}

function attendanceBody(w, overrides = {}) {
  return {
    capturedAt: CAPTURED_AT,
    records: [
      { candidateId: String(w.asha._id), present: true, idVerified: true },
      { candidateId: String(w.bala._id), present: false, note: "Did not report" },
    ],
    ...overrides,
  };
}

function checklistBody(overrides = {}) {
  return {
    clientEventId: "chk-0001",
    capturedAt: CAPTURED_AT,
    items: [
      { key: "multimeter", label: "Digital multimeter", available: true },
      { key: "soldering-station", available: false, note: "One of two units faulty" },
    ],
    ...overrides,
  };
}

function postAttendance(token, batchId, body) {
  return request(app)
    .post(`/api/v1/assessor/batches/${batchId}/attendance`)
    .set(bearer(token))
    .send(body);
}

function postChecklist(token, batchId, body) {
  return request(app)
    .post(`/api/v1/assessor/batches/${batchId}/checklist`)
    .set(bearer(token))
    .send(body);
}

function get(token, batchId, child, query = {}) {
  return request(app).get(`/api/v1/batches/${batchId}/${child}`).set(bearer(token)).query(query);
}

describe("attendance and checklist", () => {
  beforeAll(async () => {
    await startMongo();
    await Promise.all([
      AttendanceRecord.syncIndexes(),
      EquipmentChecklist.syncIndexes(),
      LoginEvent.syncIndexes(),
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

  describe("POST /assessor/batches/:id/attendance", () => {
    it("stores one row per candidate and feeds Absent to B-05", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const res = await postAttendance(assessor.token, w.batch._id, attendanceBody(w));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.items).toHaveLength(2);
      const byCandidate = Object.fromEntries(res.body.items.map((row) => [row.candidateId, row]));
      expect(byCandidate[String(w.asha._id)]).toMatchObject({
        batchId: String(w.batch._id),
        present: true,
        idVerified: true,
        note: null,
        capturedAt: CAPTURED_AT,
        assessorId: String(w.assessor._id),
      });
      expect(byCandidate[String(w.bala._id)]).toMatchObject({
        present: false,
        idVerified: null,
        note: "Did not report",
      });

      expect(await absentCandidateIds(w.batch._id)).toEqual([String(w.bala._id)]);
      expect(await attendanceByCandidate(w.batch._id)).toEqual(
        new Map([
          [String(w.asha._id), true],
          [String(w.bala._id), false],
        ]),
      );
      // Attendance alone never changes the batch.
      const batch = await Batch.findById(w.batch._id).lean();
      expect(batch.status).toBe("in_progress");
      expect(batch.statusVersion).toBe(4);

      const audit = await AuditLog.findOne({ action: "attendance.record" }).lean();
      expect(audit.entity).toBe("attendance");
      expect(String(audit.batchId)).toBe(String(w.batch._id));
      expect(String(audit.abId)).toBe(String(w.ab._id));
      expect(String(audit.actorId)).toBe(assessor.userId);
      expect(audit.before).toEqual([]);
      expect(audit.after).toHaveLength(2);
    });

    it("replaces a row with a later capture and ignores an older one", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const one = (present, capturedAt) => ({
        capturedAt,
        records: [{ candidateId: String(w.bala._id), present }],
      });
      expect((await postAttendance(assessor.token, w.batch._id, attendanceBody(w))).status).toBe(
        200,
      );

      const corrected = await postAttendance(assessor.token, w.batch._id, one(true, LATER_AT));
      expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
      expect(corrected.body.items[0]).toMatchObject({
        present: true,
        note: null,
        capturedAt: LATER_AT,
      });

      // A queued, older submission that syncs late does not undo the correction.
      const stale = await postAttendance(assessor.token, w.batch._id, one(false, CAPTURED_AT));
      expect(stale.status).toBe(200);
      expect(stale.body.items[0]).toMatchObject({ present: true, capturedAt: LATER_AT });

      expect(await AttendanceRecord.countDocuments({})).toBe(2);
      expect(await absentCandidateIds(w.batch._id)).toEqual([]);
      const audits = await AuditLog.find({ action: "attendance.record" }).sort({ _id: 1 }).lean();
      expect(audits).toHaveLength(3);
      expect(audits[1].before[0].present).toBe(false);
      expect(audits[1].after[0].present).toBe(true);
    });

    it("rejects callers who are not the assigned assessor", async () => {
      const w = await world();
      const other = await Assessor.create({ name: "Other", code: "ASR-2" });
      const stranger = await sessionFor(
        "assessor",
        { linkedProfileId: other._id },
        "stranger@aa.example",
      );
      const unlinked = await sessionFor("assessor", {}, "unlinked@aa.example");
      const assigned = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const body = attendanceBody(w);

      expectError(await postAttendance(stranger.token, w.batch._id, body), 403, "FORBIDDEN");
      expectError(await postAttendance(unlinked.token, w.batch._id, body), 403, "FORBIDDEN");
      for (const role of ["aa_admin", "mis", "proctor", "candidate", "tp", "ab_reviewer"]) {
        const session = await sessionFor(role, { linkedProfileId: w.proctor._id });
        expectError(await postAttendance(session.token, w.batch._id, body), 403, "FORBIDDEN");
        expectError(
          await postChecklist(session.token, w.batch._id, checklistBody()),
          403,
          "FORBIDDEN",
        );
      }
      expectError(await postAttendance(assigned.token, oid(), body), 404, "NOT_FOUND");
      expect(
        (await request(app).post(`/api/v1/assessor/batches/${w.batch._id}/attendance`).send(body))
          .status,
      ).toBe(401);
      expect(await AttendanceRecord.countDocuments({})).toBe(0);
      expect(await EquipmentChecklist.countDocuments({})).toBe(0);
    });

    it.each(["assessor_assigned", "assessment_completed", "result_submitted", "cancelled"])(
      "rejects a batch in status %s",
      async (status) => {
        const w = await world({ status });
        const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
        expectError(
          await postAttendance(assessor.token, w.batch._id, attendanceBody(w)),
          409,
          "INVALID_TRANSITION",
        );
        expectError(
          await postChecklist(assessor.token, w.batch._id, checklistBody()),
          409,
          "INVALID_TRANSITION",
        );
        expect(await AttendanceRecord.countDocuments({})).toBe(0);
        expect(await EquipmentChecklist.countDocuments({})).toBe(0);
      },
    );

    it("validates the body, the roster, and the capture date", async () => {
      const w = await world();
      const elsewhere = await Candidate.create({
        batchId: oid(),
        learnerId: oid(),
        name: "Other Batch",
        externalRef: "R-9",
        active: true,
      });
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const send = (body) => postAttendance(assessor.token, w.batch._id, body);
      const row = (candidate, extra = {}) => ({
        candidateId: String(candidate._id),
        present: true,
        ...extra,
      });

      const bad = [
        {},
        attendanceBody(w, { records: [] }),
        attendanceBody(w, { capturedAt: "2026-11-20 10:30" }),
        attendanceBody(w, { receivedAt: CAPTURED_AT }),
        attendanceBody(w, { records: [row(w.asha), row(w.asha, { present: false })] }),
        attendanceBody(w, { records: [row(w.asha, { aadhaar: "1234" })] }),
        attendanceBody(w, { records: [{ candidateId: String(w.asha._id), present: "yes" }] }),
        // Deactivated row, a row on another batch, and an unknown id.
        attendanceBody(w, { records: [row(w.asha), row(w.gone)] }),
        attendanceBody(w, { records: [row(elsewhere)] }),
        attendanceBody(w, { records: [{ candidateId: String(oid()), present: true }] }),
        // 22 Nov IST is after the window.
        attendanceBody(w, { capturedAt: "2026-11-22T05:00:00.000Z" }),
      ];
      for (const body of bad) expectError(await send(body), 400, "VALIDATION_ERROR");
      expect(await AttendanceRecord.countDocuments({})).toBe(0);
      expect(await AuditLog.countDocuments({ action: "attendance.record" })).toBe(0);
    });
  });

  describe("POST /assessor/batches/:id/checklist", () => {
    it("stores a checklist without moving the batch", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const res = await postChecklist(assessor.token, w.batch._id, checklistBody());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        clientEventId: "chk-0001",
        batchId: String(w.batch._id),
        assessorId: String(w.assessor._id),
        items: [
          { key: "multimeter", label: "Digital multimeter", available: true, note: null },
          {
            key: "soldering-station",
            label: null,
            available: false,
            note: "One of two units faulty",
          },
        ],
        completeAssessment: false,
        capturedAt: CAPTURED_AT,
        replayed: false,
        batchStatus: "in_progress",
        batchStatusVersion: 4,
      });
      expect(res.body.payloadHash).toBeUndefined();
      expect((await Batch.findById(w.batch._id).lean()).statusVersion).toBe(4);
      expect(await AuditLog.countDocuments({ action: "checklist.create" })).toBe(1);
      expect(await AuditLog.countDocuments({ action: "batch.checklist" })).toBe(0);
    });

    it("validates the body and the capture date", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const item = { key: "multimeter", available: true };
      const bad = [
        {},
        checklistBody({ clientEventId: "" }),
        checklistBody({ items: [] }),
        checklistBody({ items: [item, item] }),
        checklistBody({ items: [{ key: "multimeter" }] }),
        checklistBody({ completeAssessment: "yes" }),
        checklistBody({ status: "assessment_completed" }),
        checklistBody({ capturedAt: "2026-11-19T05:00:00.000Z" }),
      ];
      for (const body of bad) {
        expectError(
          await postChecklist(assessor.token, w.batch._id, body),
          400,
          "VALIDATION_ERROR",
        );
      }
      expect(await EquipmentChecklist.countDocuments({})).toBe(0);
    });

    it("holds the batch until every active candidate has attendance, then completes it", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      const completing = checklistBody({ completeAssessment: true });

      const blocked = await postChecklist(assessor.token, w.batch._id, completing);
      expectError(blocked, 409, "INVALID_TRANSITION");
      expect(blocked.body.error.details.missingAttendance.sort()).toEqual(
        [String(w.asha._id), String(w.bala._id)].sort(),
      );
      expect(await EquipmentChecklist.countDocuments({})).toBe(0);

      // The deactivated roster row needs no attendance.
      expect((await postAttendance(assessor.token, w.batch._id, attendanceBody(w))).status).toBe(
        200,
      );
      const done = await postChecklist(assessor.token, w.batch._id, completing);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body).toMatchObject({
        completeAssessment: true,
        replayed: false,
        batchStatus: "assessment_completed",
        batchStatusVersion: 5,
      });
      const batch = await Batch.findById(w.batch._id).lean();
      expect(batch.status).toBe("assessment_completed");
      expect(batch.statusVersion).toBe(5);

      const audit = await AuditLog.findOne({ action: "batch.checklist" }).lean();
      expect(audit.before).toEqual({ status: "in_progress", statusVersion: 4 });
      expect(audit.after).toEqual({ status: "assessment_completed", statusVersion: 5 });
      expect(audit.meta.checklistId).toBe(done.body.id);
      expect(String(audit.actorId)).toBe(assessor.userId);
      expect(audit.actorRole).toBe("assessor");

      // A queued resend still succeeds; nothing moves twice.
      const again = await postChecklist(assessor.token, w.batch._id, completing);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ ...done.body, replayed: true });
      expect(await EquipmentChecklist.countDocuments({})).toBe(1);
      expect(await AuditLog.countDocuments({ action: "batch.checklist" })).toBe(1);
      expect(await AuditLog.countDocuments({ action: "checklist.replay" })).toBe(1);
      expect((await Batch.findById(w.batch._id).lean()).statusVersion).toBe(5);

      // The batch is closed to new field writes.
      expectError(
        await postChecklist(
          assessor.token,
          w.batch._id,
          checklistBody({ clientEventId: "chk-0002" }),
        ),
        409,
        "INVALID_TRANSITION",
      );
      expectError(
        await postAttendance(assessor.token, w.batch._id, attendanceBody(w)),
        409,
        "INVALID_TRANSITION",
      );
    });

    it("stores nothing when the status change loses a race", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      await postAttendance(assessor.token, w.batch._id, attendanceBody(w));
      const realFind = Batch.findOneAndUpdate.bind(Batch);
      const spy = vi.spyOn(Batch, "findOneAndUpdate").mockImplementation((filter, ...rest) => {
        // Another request bumped statusVersion between the read and the CAS.
        return realFind({ ...filter, statusVersion: filter.statusVersion + 1 }, ...rest);
      });
      const res = await postChecklist(
        assessor.token,
        w.batch._id,
        checklistBody({ completeAssessment: true }),
      );
      spy.mockRestore();
      expectError(res, 409, "INVALID_TRANSITION");
      expect(await EquipmentChecklist.countDocuments({})).toBe(0);
      expect((await Batch.findById(w.batch._id).lean()).status).toBe("in_progress");
      expect(await AuditLog.countDocuments({ action: "batch.checklist" })).toBe(0);
    });

    it("is idempotent on clientEventId", async () => {
      const w = await world();
      const other = { batch: await Batch.create({ ...w.batch.toObject(), _id: oid() }) };
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });

      const both = await Promise.all([
        postChecklist(assessor.token, w.batch._id, checklistBody()),
        postChecklist(assessor.token, w.batch._id, checklistBody()),
      ]);
      expect(both.map((res) => res.status)).toEqual([200, 200]);
      expect(both[0].body.id).toBe(both[1].body.id);
      expect(await EquipmentChecklist.countDocuments({})).toBe(1);

      expectError(
        await postChecklist(
          assessor.token,
          w.batch._id,
          checklistBody({ completeAssessment: true }),
        ),
        409,
        "CONFLICT_IDEMPOTENT",
      );
      // The same id on another batch is a different payload.
      expectError(
        await postChecklist(assessor.token, other.batch._id, checklistBody()),
        409,
        "CONFLICT_IDEMPOTENT",
      );
      expect(await EquipmentChecklist.countDocuments({})).toBe(1);
    });

    it("keeps secrets and the payload hash out of audit rows", async () => {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      await postAttendance(assessor.token, w.batch._id, attendanceBody(w));
      await postChecklist(assessor.token, w.batch._id, checklistBody({ completeAssessment: true }));
      const rows = await AuditLog.find({
        action: { $in: ["attendance.record", "checklist.create", "batch.checklist"] },
      }).lean();
      expect(rows).toHaveLength(3);
      const text = JSON.stringify(rows);
      expect(text).not.toContain("payloadHash");
      expect(text).not.toContain(assessor.token);
      expect(text).not.toMatch(/passwordHash|refreshToken|Bearer /);
    });
  });

  describe("batch child reads", () => {
    async function seeded() {
      const w = await world();
      const assessor = await sessionFor("assessor", { linkedProfileId: w.assessor._id });
      await postAttendance(assessor.token, w.batch._id, attendanceBody(w));
      await postChecklist(assessor.token, w.batch._id, checklistBody());
      await postChecklist(
        assessor.token,
        w.batch._id,
        checklistBody({ clientEventId: "chk-0002", capturedAt: LATER_AT }),
      );
      const event = (actorType, actorId, capturedAt, extra = {}) => ({
        clientEventId: `evt-${actorType}-${capturedAt}-${String(actorId)}`,
        actorType,
        actorId,
        userId: oid(),
        batchId: w.batch._id,
        type: "login",
        lat: 19.07,
        lng: 72.87,
        capturedAt: new Date(capturedAt),
        receivedAt: new Date(capturedAt),
        clockSkewMs: 0,
        clockSkewFlag: false,
        lateSync: false,
        syncedAt: new Date(capturedAt),
        payloadHash: "never-returned",
        ...extra,
      });
      await LoginEvent.create([
        event("assessor", w.assessor._id, CAPTURED_AT),
        event("proctor", w.proctor._id, "2026-11-20T05:10:00.000Z"),
        event("student", w.learnerIds[0], "2026-11-20T05:20:00.000Z", { candidateId: w.asha._id }),
        event("student", w.learnerIds[1], LATER_AT, { candidateId: w.bala._id }),
        { ...event("assessor", w.assessor._id, LATER_AT), batchId: oid() },
      ]);
      return { w, assessor };
    }

    it("lists login events, attendance and checklists for scoped readers", async () => {
      const { w, assessor } = await seeded();
      const readers = [
        await sessionFor("aa_admin"),
        await sessionFor("mis"),
        await sessionFor("ncvet_viewer"),
        await sessionFor("ab_reviewer", { abId: w.ab._id }),
        await sessionFor("tp", { tpId: w.batch.tpId }),
        await sessionFor("proctor", { linkedProfileId: w.proctor._id }),
        assessor,
      ];
      for (const reader of readers) {
        const events = await get(reader.token, w.batch._id, "login-events");
        expect(events.status, JSON.stringify(events.body)).toBe(200);
        expect(events.body.items.map((row) => row.actorType)).toEqual([
          "assessor",
          "proctor",
          "student",
          "student",
        ]);
        expect(events.body.items[0].payloadHash).toBeUndefined();
        expect(events.body.items[0].replayed).toBeUndefined();

        const attendance = await get(reader.token, w.batch._id, "attendance");
        expect(attendance.status).toBe(200);
        expect(attendance.body.items).toHaveLength(2);

        const checklists = await get(reader.token, w.batch._id, "checklist");
        expect(checklists.status).toBe(200);
        expect(checklists.body.items.map((row) => row.clientEventId)).toEqual([
          "chk-0002",
          "chk-0001",
        ]);
        expect(checklists.body.items[0].payloadHash).toBeUndefined();
      }

      const admin = readers[0];
      const latest = await get(admin.token, w.batch._id, "checklist", { latest: "true" });
      expect(latest.body.items.map((row) => row.clientEventId)).toEqual(["chk-0002"]);

      const students = await get(admin.token, w.batch._id, "login-events", {
        actorType: "student",
        from: "2026-11-20T05:20:00.000Z",
        to: "2026-11-20T06:00:00.000Z",
      });
      expect(students.status, JSON.stringify(students.body)).toBe(200);
      expect(students.body.items).toHaveLength(1);
      expect(students.body.items[0].candidateId).toBe(String(w.asha._id));

      expectError(
        await get(admin.token, w.batch._id, "login-events", { actorType: "admin" }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await get(admin.token, w.batch._id, "login-events", { from: LATER_AT, to: CAPTURED_AT }),
        400,
        "VALIDATION_ERROR",
      );
      expectError(
        await get(admin.token, w.batch._id, "checklist", { latest: "1" }),
        400,
        "VALIDATION_ERROR",
      );
    });

    it("hides GPS and device id from tp, shows them to aa_admin, mis and the field staff (D8)", async () => {
      const { w } = await seeded();
      await LoginEvent.updateMany(
        { batchId: w.batch._id },
        {
          $set: {
            accuracy: 12,
            device: { deviceId: "DEV-SECRET-1", platform: "android", appVersion: "1.0.0" },
          },
        },
      );

      const tp = await sessionFor("tp", { tpId: w.batch.tpId });
      const asTp = await get(tp.token, w.batch._id, "login-events");
      expect(asTp.status, JSON.stringify(asTp.body)).toBe(200);
      expect(asTp.body.items).toHaveLength(4);
      for (const row of asTp.body.items) {
        expect(row.lat).toBeNull();
        expect(row.lng).toBeNull();
        expect(row.accuracy).toBeNull();
        expect(row.device).toEqual({ platform: "android", appVersion: "1.0.0" });
      }
      const text = JSON.stringify(asTp.body);
      expect(text).not.toContain("DEV-SECRET-1");
      expect(text).not.toContain("19.07");

      const admin = await sessionFor("aa_admin");
      const asAdmin = await get(admin.token, w.batch._id, "login-events");
      expect(asAdmin.body.items).toHaveLength(4);
      for (const row of asAdmin.body.items) {
        expect(row).toMatchObject({ lat: 19.07, lng: 72.87, accuracy: 12 });
        expect(row.device.deviceId).toBe("DEV-SECRET-1");
      }
    });

    it("shows a candidate only their own events and attendance", async () => {
      const { w } = await seeded();
      const candidate = await sessionFor("candidate", { linkedProfileId: w.learnerIds[1] });

      const events = await get(candidate.token, w.batch._id, "login-events");
      expect(events.status, JSON.stringify(events.body)).toBe(200);
      expect(events.body.items).toHaveLength(1);
      expect(events.body.items[0]).toMatchObject({
        actorType: "student",
        candidateId: String(w.bala._id),
      });
      const asAssessor = await get(candidate.token, w.batch._id, "login-events", {
        actorType: "assessor",
      });
      expect(asAssessor.body.items).toEqual([]);

      const attendance = await get(candidate.token, w.batch._id, "attendance");
      expect(attendance.body.items).toHaveLength(1);
      expect(attendance.body.items[0]).toMatchObject({
        candidateId: String(w.bala._id),
        present: false,
      });
    });

    it("denies readers outside the batch scope", async () => {
      const { w } = await seeded();
      const outsiders = [
        await sessionFor("sme"),
        await sessionFor("ab_reviewer", { abId: oid() }),
        await sessionFor("tp", { tpId: oid() }),
        await sessionFor("proctor", { linkedProfileId: oid() }),
        await sessionFor("assessor", { linkedProfileId: oid() }, "other-assessor@aa.example"),
        await sessionFor("candidate", { linkedProfileId: oid() }),
      ];
      for (const child of ["login-events", "attendance", "checklist"]) {
        for (const outsider of outsiders) {
          expectError(await get(outsider.token, w.batch._id, child), 403, "FORBIDDEN");
        }
        expect((await request(app).get(`/api/v1/batches/${w.batch._id}/${child}`)).status).toBe(
          401,
        );
      }
      const admin = await sessionFor("aa_admin");
      for (const child of ["login-events", "attendance", "checklist"]) {
        expectError(await get(admin.token, oid(), child), 404, "NOT_FOUND");
        expectError(await get(admin.token, "not-an-id", child), 400, "VALIDATION_ERROR");
      }
    });
  });
});
