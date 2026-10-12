import { forbidden, invalidTransition, notFound, validationError } from "../../lib/errors.js";
import { AttendanceRecord } from "../../models/attendance-record.model.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { ATTENDANCE_WRITE_ROLES } from "../../models/roles.js";
import { loadReadableBatch } from "../batches/batch.service.js";
import { assertAssigned, assertInWindow } from "../login-events/login-event.service.js";

/** Attendance and checklist writes are open only while the assessment runs. */
export const FIELD_WRITE_BATCH_STATUSES = Object.freeze(["in_progress"]);

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

export function presentAttendance(doc) {
  return {
    id: String(doc._id),
    batchId: String(doc.batchId),
    candidateId: String(doc.candidateId),
    present: doc.present,
    idVerified: doc.idVerified ?? null,
    note: doc.note ?? null,
    capturedAt: iso(doc.capturedAt),
    receivedAt: iso(doc.receivedAt),
    assessorId: String(doc.assessorId),
  };
}

/**
 * The batch for an assessor field write. Unknown id is 404, an assessor who
 * is not the batch's `assessorId` is 403, and any status other than
 * `in_progress` is 409. `capturedAt` must fall in the assessment window.
 */
export async function loadBatchForFieldWrite(user, batchId, capturedAt) {
  if (!ATTENDANCE_WRITE_ROLES.includes(user?.role)) throw forbidden();
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  await assertAssigned(user, "assessor", batch);
  if (!FIELD_WRITE_BATCH_STATUSES.includes(batch.status)) {
    throw invalidTransition("Batch is not in progress");
  }
  assertInWindow(batch, capturedAt);
  return batch;
}

/**
 * Record attendance for roster candidates. docs/SCHEMA.md §3.13. NCVET:FR §E.
 * One row per candidate; a later submission replaces it. A submission whose
 * `capturedAt` is older than the stored row is ignored for that candidate, so
 * an offline queue that syncs out of order cannot undo a correction.
 * @param {object} user
 * @param {string} batchId
 * @param {object} body parsed attendanceBodySchema
 * @param {{ now?: Date }} [context]
 */
export async function recordAttendance(user, batchId, body, context = {}) {
  const receivedAt = context.now ?? new Date();
  const capturedAt = new Date(body.capturedAt);
  const batch = await loadBatchForFieldWrite(user, batchId, capturedAt);

  const candidateIds = body.records.map((row) => row.candidateId);
  const roster = await Candidate.find({
    _id: { $in: candidateIds },
    batchId: batch._id,
    active: true,
  })
    .select("_id")
    .lean();
  const onRoster = new Set(roster.map((row) => String(row._id)));
  const unknown = candidateIds.filter((id) => !onRoster.has(id.toLowerCase()));
  if (unknown.length > 0) {
    throw validationError("Not an active roster row on this batch", {
      records: unknown.map((id) => `candidateId ${id} is not an active roster row`),
    });
  }

  const existing = await AttendanceRecord.find({
    batchId: batch._id,
    candidateId: { $in: candidateIds },
  }).lean();
  const stored = new Map(existing.map((row) => [String(row.candidateId), row]));

  const writes = body.records
    .filter((row) => {
      const prior = stored.get(row.candidateId.toLowerCase());
      return !prior || prior.capturedAt.getTime() <= capturedAt.getTime();
    })
    .map((row) => ({
      updateOne: {
        filter: { batchId: batch._id, candidateId: row.candidateId },
        update: {
          $set: {
            present: row.present,
            idVerified: row.idVerified ?? null,
            note: row.note ?? null,
            capturedAt,
            receivedAt,
            assessorId: user.linkedProfileId,
            recordedBy: user._id,
          },
        },
        upsert: true,
      },
    }));
  if (writes.length > 0) await AttendanceRecord.bulkWrite(writes);

  const saved = await AttendanceRecord.find({
    batchId: batch._id,
    candidateId: { $in: candidateIds },
  })
    .sort({ candidateId: 1 })
    .lean();
  return {
    abId: batch.abId,
    before: existing.map(presentAttendance),
    items: saved.map(presentAttendance),
  };
}

/**
 * GET /batches/:id/attendance. A candidate sees only their own row.
 */
export async function listAttendance(user, batchId) {
  const batch = await loadReadableBatch(user, batchId);
  const filter = { batchId: batch._id };
  if (user?.role === "candidate") {
    const own = await Candidate.find({ batchId: batch._id, learnerId: user.linkedProfileId })
      .select("_id")
      .lean();
    filter.candidateId = { $in: own.map((row) => row._id) };
  }
  const docs = await AttendanceRecord.find(filter).sort({ candidateId: 1 }).lean();
  return { items: docs.map(presentAttendance) };
}

/**
 * For B-05: candidates marked `present: false` take the outcome `Absent`.
 * @returns {Promise<Map<string, boolean>>} candidateId → present, recorded rows only
 */
export async function attendanceByCandidate(batchId) {
  const docs = await AttendanceRecord.find({ batchId }).select("candidateId present").lean();
  return new Map(docs.map((row) => [String(row.candidateId), row.present]));
}

/** For B-05. Candidate ids recorded as absent on this batch. */
export async function absentCandidateIds(batchId) {
  const byCandidate = await attendanceByCandidate(batchId);
  return [...byCandidate].filter(([, present]) => !present).map(([id]) => id);
}

/** Active roster candidates on the batch with no attendance row. */
export async function candidatesMissingAttendance(batchId) {
  const [roster, recorded] = await Promise.all([
    Candidate.find({ batchId, active: true }).select("_id").lean(),
    AttendanceRecord.find({ batchId }).select("candidateId").lean(),
  ]);
  const have = new Set(recorded.map((row) => String(row.candidateId)));
  return roster.map((row) => String(row._id)).filter((id) => !have.has(id));
}
