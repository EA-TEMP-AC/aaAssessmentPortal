import { resolveBatchSettings } from "../../config/batch-settings.js";
import {
  forbidden,
  invalidTransition,
  notFound,
  resultIncomplete,
  resultOutcomeMismatch,
  slaResultExpired,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { ResultChangeLog } from "../../models/result-change-log.model.js";
import { Result } from "../../models/result.model.js";
import {
  RESULT_CHANGE_LOG_ROLES,
  RESULT_PUBLISHED_ONLY_ROLES,
  RESULT_WRITE_ROLES,
} from "../../models/roles.js";
import { attendanceByCandidate } from "../attendance/attendance.service.js";
import { resolveTransition, rolesForAction } from "../batches/batch-transitions.js";
import { loadReadableBatch } from "../batches/batch.service.js";
import { MARK_COMPONENTS } from "../master-data/pass-marks.js";
import {
  assertMarksWithinCeilings,
  assertRubricMarks,
  outcomeFromMarks,
  withBatchPassRule,
} from "./result-scoring.js";

/** PUT results is open only here. docs/SCHEMA.md §3.14. */
export const RESULT_EDIT_BATCH_STATUS = "assessment_completed";

/**
 * Batch action → result status move and change-log action.
 * The batch side of each move is a row in batch-transitions.js.
 */
const RESULT_MOVES = Object.freeze({
  "submit-result": Object.freeze({ from: "draft", to: "submitted", log: "submit" }),
  validate: Object.freeze({ from: "submitted", to: "validated", log: "validate" }),
  publish: Object.freeze({ from: "validated", to: "published", log: "publish" }),
});

/** Batch status → the result status that return-for-correction sends back to `draft`. */
const RETURNABLE_RESULT_STATUS = Object.freeze({
  result_submitted: "submitted",
  ab_validated: "validated",
});

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function idOf(value) {
  return value == null ? null : String(value);
}

function presentRow(row) {
  return {
    candidateId: String(row.candidateId),
    absent: row.absent === true,
    outcome: row.outcome ?? null,
    nos: (row.nos ?? []).map((entry) => ({
      nosId: entry.nosId,
      theory: entry.theory ?? null,
      practical: entry.practical ?? null,
      viva: entry.viva ?? null,
    })),
  };
}

/**
 * @param {object} doc
 * @param {{ onlyCandidateIds?: Set<string> }} [options] keep only these rows
 */
export function presentResult(doc, { onlyCandidateIds } = {}) {
  const rows = doc.rows.map(presentRow);
  return {
    id: String(doc._id),
    batchId: String(doc.batchId),
    status: doc.status,
    rows: onlyCandidateIds ? rows.filter((row) => onlyCandidateIds.has(row.candidateId)) : rows,
    submittedAt: iso(doc.submittedAt),
    submittedBy: idOf(doc.submittedBy),
    validatedAt: iso(doc.validatedAt),
    validatedBy: idOf(doc.validatedBy),
    publishedAt: iso(doc.publishedAt),
    publishedBy: idOf(doc.publishedBy),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function presentChangeLog(doc) {
  return {
    id: String(doc._id),
    resultId: String(doc.resultId),
    batchId: String(doc.batchId),
    action: doc.action,
    fromStatus: doc.fromStatus ?? null,
    toStatus: doc.toStatus,
    byUserId: String(doc.byUserId),
    byRole: doc.byRole,
    reason: doc.reason ?? null,
    changes: doc.changes.map((change) => ({
      candidateId: String(change.candidateId),
      before: change.before ?? null,
      after: change.after ?? null,
    })),
    createdAt: iso(doc.createdAt),
  };
}

/** The result without its rows, for audit and status-move snapshots. */
function resultHeader(doc) {
  const header = presentResult(doc);
  delete header.rows;
  return header;
}

function hasMarks(nos) {
  return nos.some((entry) =>
    MARK_COMPONENTS.some((component) => typeof entry[component] === "number"),
  );
}

/** Rows that differ between two row lists, keyed by candidate. */
function diffRows(beforeRows, afterRows) {
  const before = new Map(beforeRows.map((row) => [String(row.candidateId), presentRow(row)]));
  const after = new Map(afterRows.map((row) => [String(row.candidateId), presentRow(row)]));
  const changes = [];
  for (const candidateId of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(candidateId) ?? null;
    const now = after.get(candidateId) ?? null;
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    changes.push({ candidateId, before: was, after: now });
  }
  return changes;
}

async function loadQualification(batch) {
  const qualification = await Qualification.findById(batch.qualificationId).lean();
  if (!qualification) {
    throw validationError("The batch qualification no longer exists", {
      qualificationId: ["Does not exist"],
    });
  }
  return qualification;
}

async function activeCandidateIds(batchId) {
  const roster = await Candidate.find({ batchId, active: true }).select("_id").lean();
  return roster.map((row) => String(row._id));
}

/**
 * Server-computed rows. docs/SCHEMA.md §3.14.
 * `Absent` comes from attendance (`present: false`). A candidate with no
 * attendance row is Absent only when the row says `absent: true`. A row's
 * `absent` that contradicts attendance, marks on an absent candidate, a
 * candidate who is not an active roster row, and an unknown NOS are
 * `400 VALIDATION_ERROR`. Marks above the ceiling are
 * `400 RESULT_PASS_MARK_INVALID`. A client `outcome` that differs from the
 * computed one is `400 RESULT_OUTCOME_MISMATCH`.
 * @param {object} batch
 * @param {Array<object>} inputRows `{ candidateId, absent?, outcome?, nos }`
 */
async function computeRows(batch, inputRows) {
  const [storedQualification, activeIds, attendance] = await Promise.all([
    loadQualification(batch),
    activeCandidateIds(batch._id),
    attendanceByCandidate(batch._id),
  ]);
  // X-29: the batch's own pass rule and marking type, when it has one.
  const settings = resolveBatchSettings(batch.settings);
  const qualification = withBatchPassRule(storedQualification, settings);
  const active = new Set(activeIds);
  const nosIds = new Set((qualification.nos ?? []).map((nos) => nos.nosId));

  const problems = [];
  const rows = [];
  for (const input of inputRows) {
    const candidateId = String(input.candidateId).toLowerCase();
    if (!active.has(candidateId)) {
      problems.push(`candidateId ${candidateId} is not an active roster row`);
      continue;
    }
    const present = attendance.get(candidateId);
    if (present === true && input.absent === true) {
      problems.push(`candidateId ${candidateId} is present in attendance`);
    }
    if (present === false && input.absent === false) {
      problems.push(`candidateId ${candidateId} is absent in attendance`);
    }
    const absent = present === false || (present === undefined && input.absent === true);
    if (absent && hasMarks(input.nos)) {
      problems.push(`candidateId ${candidateId} is absent and cannot have marks`);
    }
    for (const entry of input.nos) {
      if (!nosIds.has(entry.nosId)) {
        problems.push(
          `candidateId ${candidateId}: nosId ${entry.nosId} is not on the qualification`,
        );
      }
    }
    rows.push({ candidateId, absent, nos: absent ? [] : input.nos, claimed: input.outcome });
  }
  if (problems.length > 0) throw validationError("Result rows are invalid", { rows: problems });

  const mismatches = [];
  const computed = rows.map((row) => {
    if (!row.absent) {
      assertMarksWithinCeilings(qualification, row.candidateId, row.nos);
      assertRubricMarks(qualification, row.candidateId, row.nos, settings);
    }
    const built = presentRow({
      ...row,
      outcome: row.absent ? "Absent" : outcomeFromMarks(qualification, row.nos),
    });
    if (row.claimed !== undefined && row.claimed !== built.outcome) {
      mismatches.push({ candidateId: row.candidateId, outcome: built.outcome });
    }
    return built;
  });
  if (mismatches.length > 0) throw resultOutcomeMismatch({ rows: mismatches });

  return { rows: computed, activeIds };
}

/**
 * PUT /batches/:id/results. Replaces the draft rows (creates the draft on the
 * first call). Only while the batch is `assessment_completed` and the result
 * is `draft`; otherwise `409 INVALID_TRANSITION`.
 * @param {object} user
 * @param {string} batchId
 * @param {object} body parsed resultsBodySchema
 */
export async function saveResults(user, batchId, body) {
  if (!RESULT_WRITE_ROLES.includes(user?.role)) throw forbidden();
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  if (batch.status !== RESULT_EDIT_BATCH_STATUS) {
    throw invalidTransition("Results can be saved only while the batch is assessment_completed");
  }
  const existing = await Result.findOne({ batchId: batch._id }).lean();
  if (existing && existing.status !== "draft") {
    throw invalidTransition("The result is no longer a draft");
  }

  const { rows } = await computeRows(batch, body.rows);
  const changes = diffRows(existing?.rows ?? [], rows);

  let saved;
  try {
    saved = await withTransaction(async (session) => {
      const result = await Result.findOneAndUpdate(
        { batchId: batch._id, status: "draft" },
        { $set: { rows } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session },
      ).lean();
      // Same CAS filter as a status move, so a concurrent submit cannot interleave.
      const held = await Batch.findOneAndUpdate(
        { _id: batch._id, status: batch.status, statusVersion: batch.statusVersion },
        { $set: { resultId: result._id } },
        { new: true, session },
      ).lean();
      if (!held) throw invalidTransition();
      if (!existing || changes.length > 0) {
        await ResultChangeLog.create(
          [
            {
              resultId: result._id,
              batchId: batch._id,
              action: "save",
              fromStatus: existing ? existing.status : null,
              toStatus: result.status,
              byUserId: user._id,
              byRole: user.role,
              reason: body.changeReason ?? null,
              changes,
            },
          ],
          { session },
        );
      }
      return result;
    });
  } catch (err) {
    // The draft filter missed a result that was submitted meanwhile.
    if (err?.code === 11000) throw invalidTransition("The result is no longer a draft");
    throw err;
  }

  return {
    abId: batch.abId,
    before: existing ? presentResult(existing) : null,
    result: presentResult(saved),
  };
}

function assertBatchScopeForReview(user, batch) {
  if (user.role !== "ab_reviewer") return;
  if (!user.abId || String(user.abId) !== String(batch.abId)) throw forbidden();
}

/**
 * One result status move with its batch transition and change-log row, in
 * one transaction. Both documents use compare-and-set, so a raced call is
 * `409 INVALID_TRANSITION` and nothing is stored.
 */
async function moveResult({
  user,
  batch,
  result,
  action,
  move = RESULT_MOVES[action],
  next,
  resultSet,
  batchUpdate,
  log,
}) {
  return withTransaction(async (session) => {
    const updated = await Result.findOneAndUpdate(
      { _id: result._id, status: move.from, updatedAt: result.updatedAt },
      { $set: { ...resultSet, status: move.to } },
      { new: true, runValidators: true, session },
    ).lean();
    if (!updated) throw invalidTransition();

    const moved = await Batch.findOneAndUpdate(
      { _id: batch._id, status: batch.status, statusVersion: batch.statusVersion },
      { ...batchUpdate, $set: { status: next.to }, $inc: { statusVersion: 1 } },
      { new: true, runValidators: true, session },
    ).lean();
    if (!moved) throw invalidTransition();

    await ResultChangeLog.create(
      [
        {
          resultId: result._id,
          batchId: batch._id,
          action: move.log,
          fromStatus: move.from,
          toStatus: move.to,
          byUserId: user._id,
          byRole: user.role,
          reason: log.reason ?? null,
          changes: log.changes ?? [],
        },
      ],
      { session },
    );
    return { result: updated, batch: moved };
  });
}

async function auditMove({ user, batch, before, after, action, log, meta, ip }) {
  await recordAudit({
    actorId: user._id,
    actorRole: user.role,
    action: `result.${log ?? RESULT_MOVES[action].log}`,
    entity: "result",
    entityId: String(after._id),
    abId: batch.abId,
    batchId: batch._id,
    before: resultHeader(before),
    after: resultHeader(after),
    ...(meta ? { meta } : {}),
    ip,
  });
}

function presentMove(batch, saved) {
  return {
    abId: batch.abId,
    before: { status: batch.status, statusVersion: batch.statusVersion },
    after: {
      status: saved.batch.status,
      statusVersion: saved.batch.statusVersion,
      resultId: String(saved.result._id),
      resultStatus: saved.result.status,
    },
    result: {
      ...presentResult(saved.result),
      batchStatus: saved.batch.status,
      batchStatusVersion: saved.batch.statusVersion,
    },
  };
}

/**
 * POST /batches/:id/submit-result. The server recomputes every outcome from
 * the stored marks and attendance before the result leaves `draft`.
 * `409 RESULT_INCOMPLETE` when an active roster candidate has no row
 * (`details.missingCandidates`) or a row still lacks marks
 * (`details.incompleteMarks`). Soft SLA on `resultDueAt` (SCHEMA §2.2).
 * @param {object} user
 * @param {string} batchId
 * @param {{ lateReason?: string }} body
 * @param {{ now?: Date, ip?: string }} [context]
 */
export async function submitResult(user, batchId, body = {}, context = {}) {
  const action = "submit-result";
  const now = context.now ?? new Date();
  if (!rolesForAction(action).includes(user?.role)) throw forbidden();
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  const next = resolveTransition(user.role, batch.status, action);
  if (!next) throw invalidTransition();

  const result = await Result.findOne({ batchId: batch._id }).lean();
  if (result && result.status !== RESULT_MOVES[action].from) throw invalidTransition();

  // Attendance decides Absent; the stored flag only stands in when there is none.
  const { rows, activeIds } = await computeRows(
    batch,
    (result?.rows ?? []).map((row) => ({
      candidateId: row.candidateId,
      absent: row.absent ? true : undefined,
      nos: presentRow(row).nos,
    })),
  );
  const byCandidate = new Map(rows.map((row) => [row.candidateId, row]));
  const missingCandidates = activeIds.filter((id) => !byCandidate.has(id));
  const incompleteMarks = rows.filter((row) => row.outcome === null).map((row) => row.candidateId);
  if (!result || missingCandidates.length > 0 || incompleteMarks.length > 0) {
    throw resultIncomplete({ missingCandidates, incompleteMarks });
  }

  const due = batch.sla?.resultDueAt;
  const late = Boolean(due) && now.getTime() > new Date(due).getTime();
  const lateReason = typeof body.lateReason === "string" ? body.lateReason.trim() : "";
  if (late && !lateReason) throw slaResultExpired();

  const saved = await moveResult({
    user,
    batch,
    result,
    action,
    next,
    resultSet: { rows, submittedAt: now, submittedBy: user._id },
    batchUpdate: late
      ? {
          $addToSet: { "sla.breached": "result" },
          $push: {
            "sla.lateActions": { key: "result", reason: lateReason, byUserId: user._id, at: now },
          },
        }
      : {},
    log: { changes: diffRows(result.rows, rows), reason: late ? lateReason : null },
  });

  if (late) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "sla_late_submit",
      entity: "batch",
      entityId: String(batch._id),
      abId: batch.abId,
      batchId: batch._id,
      meta: { reason: lateReason, key: "result" },
      ip: context.ip,
    });
  }
  await auditMove({ user, batch, before: result, after: saved.result, action, ip: context.ip });
  return presentMove(batch, saved);
}

/**
 * POST /batches/:id/validate and /publish. The awarding body reviewer of the
 * batch's own `abId` only. Publish sets `publishedAt`, the reassessment
 * window anchor (Guidelines 4.7, SCHEMA §4.2).
 * @param {object} user
 * @param {string} batchId
 * @param {"validate"|"publish"} action
 * @param {{ reason?: string }} body
 * @param {{ now?: Date, ip?: string }} [context]
 */
export async function reviewResult(user, batchId, action, body = {}, context = {}) {
  const now = context.now ?? new Date();
  if (!rolesForAction(action).includes(user?.role)) throw forbidden();
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  assertBatchScopeForReview(user, batch);
  const next = resolveTransition(user.role, batch.status, action);
  if (!next) throw invalidTransition();

  const result = await Result.findOne({ batchId: batch._id }).lean();
  if (!result || result.status !== RESULT_MOVES[action].from) throw invalidTransition();

  const saved = await moveResult({
    user,
    batch,
    result,
    action,
    next,
    resultSet:
      action === "publish"
        ? { publishedAt: now, publishedBy: user._id }
        : { validatedAt: now, validatedBy: user._id },
    batchUpdate: {},
    log: { reason: body.reason ?? null },
  });

  await auditMove({ user, batch, before: result, after: saved.result, action, ip: context.ip });
  return presentMove(batch, saved);
}

/**
 * POST /batches/:id/return-for-correction. The awarding body reviewer of the
 * batch's own `abId` sends a submitted or validated result back: the batch
 * returns to `assessment_completed` and the result to `draft`, so `aa_admin`
 * can PUT and submit again. A published result cannot be returned. The marks
 * are kept; the submit and validate stamps are cleared.
 * @param {object} user
 * @param {string} batchId
 * @param {{ reason: string }} body
 * @param {{ ip?: string }} [context]
 */
export async function returnForCorrection(user, batchId, body, context = {}) {
  const action = "return-for-correction";
  if (!rolesForAction(action).includes(user?.role)) throw forbidden();
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  assertBatchScopeForReview(user, batch);
  const next = resolveTransition(user.role, batch.status, action);
  if (!next) throw invalidTransition();

  const result = await Result.findOne({ batchId: batch._id }).lean();
  if (!result || result.status !== RETURNABLE_RESULT_STATUS[batch.status]) {
    throw invalidTransition();
  }

  const saved = await moveResult({
    user,
    batch,
    result,
    action,
    move: { from: result.status, to: "draft", log: "return" },
    next,
    resultSet: { submittedAt: null, submittedBy: null, validatedAt: null, validatedBy: null },
    batchUpdate: {},
    log: { reason: body.reason },
  });

  const meta = { reason: body.reason };
  await auditMove({
    user,
    batch,
    before: result,
    after: saved.result,
    action,
    log: "return",
    meta,
    ip: context.ip,
  });
  return { ...presentMove(batch, saved), meta };
}

/**
 * GET /batches/:id/results. Batch row scope. A candidate gets only their own
 * row. A candidate or training partner gets the result only once published.
 */
export async function getResults(user, batchId) {
  const batch = await loadReadableBatch(user, batchId);
  const result = await Result.findOne({ batchId: batch._id }).lean();
  if (!result) throw notFound("No result for this batch");
  if (RESULT_PUBLISHED_ONLY_ROLES.includes(user.role) && result.status !== "published") {
    throw notFound("The result is not published");
  }
  if (user.role !== "candidate") return presentResult(result);

  const own = await Candidate.find({ batchId: batch._id, learnerId: user.linkedProfileId })
    .select("_id")
    .lean();
  return presentResult(result, { onlyCandidateIds: new Set(own.map((row) => String(row._id))) });
}

/**
 * GET /results/:id/change-log. Oldest first. An awarding body reviewer reads
 * only results of batches with their own `abId`.
 */
export async function listChangeLog(user, resultId) {
  if (!RESULT_CHANGE_LOG_ROLES.includes(user?.role)) throw forbidden();
  const result = await Result.findById(resultId).select("batchId").lean();
  if (!result) throw notFound();
  if (user.role === "ab_reviewer") {
    const batch = await Batch.findById(result.batchId).select("abId").lean();
    if (!batch || !user.abId || String(batch.abId) !== String(user.abId)) throw forbidden();
  }
  const docs = await ResultChangeLog.find({ resultId: result._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return { items: docs.map(presentChangeLog) };
}
