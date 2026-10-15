import mongoose from "mongoose";
import { compliance } from "../../config/compliance.js";
import {
  forbidden,
  notFound,
  reassessAlreadyOpen,
  reassessNotEligible,
  validationError,
} from "../../lib/errors.js";
import { withTransaction } from "../../lib/mongo-session.js";
import { istCalendarDate } from "../../lib/working-days.js";
import { recordAudit } from "../../middleware/audit.middleware.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Centre } from "../../models/centre.model.js";
import { Result } from "../../models/result.model.js";
import { recognitionDecision } from "../recognition/recognition.service.js";
import { slaDueAtCreation } from "./batch-sla.js";
import { presentBatch } from "./batch.service.js";

/** Guidelines 4.7: only these outcomes on the parent batch can be reassessed. */
export const REASSESSABLE_OUTCOMES = Object.freeze(["Fail", "Absent"]);

/**
 * The same civil date `years` later. 29 February lands on 28 February when
 * the target year is not a leap year.
 * @param {string} civilDate `YYYY-MM-DD`
 * @param {number} years
 */
export function addYearsToCivilDate(civilDate, years) {
  const [year, month, day] = civilDate.split("-").map(Number);
  const target = new Date(Date.UTC(year + years, month - 1, day));
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/**
 * Reassessment window. docs/SCHEMA.md §4.2; Guidelines 4.7.
 * Both ends are inclusive IST civil dates.
 * @param {Date|string} publishedAt the original result's publication instant
 */
export function reassessmentWindow(publishedAt) {
  const windowStart = istCalendarDate(publishedAt);
  return {
    windowStart,
    windowEnd: addYearsToCivilDate(windowStart, compliance.REASSESS_WINDOW_YEARS),
  };
}

/** Q22 (decided 2026-10-13): aa_admin, or the ab_reviewer of the batch's awarding body. */
function assertInitiator(user, batch) {
  if (user?.role === "aa_admin") return;
  if (user?.role === "ab_reviewer" && user.abId && String(user.abId) === String(batch.abId)) {
    return;
  }
  throw forbidden();
}

async function publishedResultOf(batchId) {
  const result = await Result.findOne({ batchId }).lean();
  if (!result || result.status !== "published" || !result.publishedAt) return null;
  return result;
}

/** The centre must exist, have a state, and belong to the parent's training partner. */
async function loadCentreState(centreId, tpId) {
  const centre = await Centre.findById(centreId).select("tpId state").lean();
  let problem = null;
  if (!centre) problem = "Does not exist";
  else if (String(centre.tpId) !== String(tpId)) {
    problem = "Centre does not belong to this training partner";
  } else if (!centre.state) problem = "Centre has no state";
  if (problem) {
    throw validationError("Unknown or inconsistent reference", { centreId: [problem] });
  }
  return centre.state;
}

/**
 * Parent roster rows whose published outcome is Fail or Absent, narrowed to
 * `learnerIds` when the request names them. A named learner who is not one of
 * those rows is `REASSESS_NOT_ELIGIBLE` (`outcome`), as is an empty roster.
 */
async function eligibleRoster(parent, parentResult, learnerIds) {
  const reassessable = parentResult.rows
    .filter((row) => REASSESSABLE_OUTCOMES.includes(row.outcome))
    .map((row) => row.candidateId);
  const rows = await Candidate.find({ batchId: parent._id, _id: { $in: reassessable } })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  if (!learnerIds) {
    if (rows.length === 0) throw reassessNotEligible("outcome", { learnerIds: [] });
    return rows;
  }

  const byLearner = new Map(rows.map((row) => [String(row.learnerId), row]));
  const wanted = [...new Set(learnerIds.map((id) => id.toLowerCase()))];
  const refused = wanted.filter((id) => !byLearner.has(id));
  if (refused.length > 0) throw reassessNotEligible("outcome", { learnerIds: refused });
  return wanted.map((id) => byLearner.get(id));
}

/**
 * A reassessment batch in any of these statuses no longer blocks a new one. Q144, and Q167
 * (decision 173): a published earlier reassessment frees the learner for another attempt.
 */
const NOT_LIVE_STATUSES = Object.freeze(["cancelled", "rejected", "published"]);

/**
 * Refuses the request when one of the roster's learners is on an active roster
 * row of a live, unpublished reassessment batch of the same parent.
 * @throws REASSESS_ALREADY_OPEN with `details.conflicts: [{ learnerId, batchId }]`
 */
async function assertNoLiveReassessment(parent, roster) {
  const live = await Batch.find({
    reassessmentOf: parent._id,
    status: { $nin: NOT_LIVE_STATUSES },
  })
    .select("_id")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  if (live.length === 0) return;

  const rows = await Candidate.find({
    batchId: { $in: live.map((batch) => batch._id) },
    learnerId: { $in: roster.map((row) => row.learnerId) },
    active: true,
  })
    .select("batchId learnerId")
    .lean();
  if (rows.length === 0) return;

  const order = new Map(live.map((batch, index) => [String(batch._id), index]));
  const first = new Map();
  for (const row of rows) {
    const key = String(row.learnerId);
    const seen = first.get(key);
    if (!seen || order.get(String(row.batchId)) < order.get(String(seen))) {
      first.set(key, row.batchId);
    }
  }
  throw reassessAlreadyOpen(
    roster
      .filter((row) => first.has(String(row.learnerId)))
      .map((row) => ({
        learnerId: String(row.learnerId),
        batchId: String(first.get(String(row.learnerId))),
      })),
  );
}

/**
 * POST /batches/:id/reassessments. docs/SCHEMA.md §4.2; Guidelines 4.7.
 * A reassessment is a new `allocated` batch, not a status of the parent.
 * Checks run in this order: parent exists, initiator, parent published,
 * window, outcome, no live reassessment of the same learner (Q144), centre,
 * recognition.
 * @param {object} user
 * @param {string} parentId
 * @param {object} body parsed reassessmentBodySchema
 * @param {{ now?: Date, ip?: string }} [context]
 * @returns {Promise<{ batch: object, stored: object, meta: object }>}
 */
export async function createReassessment(user, parentId, body, context = {}) {
  const now = context.now ?? new Date();
  const parent = await Batch.findById(parentId).lean();
  if (!parent) throw notFound();
  assertInitiator(user, parent);

  const parentResult = parent.status === "published" ? await publishedResultOf(parent._id) : null;
  if (!parentResult) throw reassessNotEligible("not_published");

  // The window counts from the first assessment, not from the immediate parent.
  const rootId = parent.firstAssessmentBatchId ?? parent._id;
  const rootResult =
    String(rootId) === String(parent._id) ? parentResult : await publishedResultOf(rootId);
  if (!rootResult) throw reassessNotEligible("not_published");

  const window = reassessmentWindow(rootResult.publishedAt);
  if (
    body.assessmentStartDate < window.windowStart ||
    body.assessmentStartDate > window.windowEnd
  ) {
    throw reassessNotEligible("window", window);
  }

  const roster = await eligibleRoster(parent, parentResult, body.learnerIds);
  await assertNoLiveReassessment(parent, roster);
  const centreId = body.centreId ?? parent.centreId;
  const state = await loadCentreState(centreId, parent.tpId);
  const override = await recognitionDecision({
    sector: parent.sector,
    state,
    now,
    user,
    overrideReason: body.recognitionOverrideReason,
  });
  const due = await slaDueAtCreation({
    type: parent.type,
    assessmentStartDate: body.assessmentStartDate,
    assessmentEndDate: body.assessmentEndDate,
    allocatedAt: now,
  });

  const _id = new mongoose.Types.ObjectId();
  const created = await withTransaction(async (session) => {
    const [batch] = await Batch.create(
      [
        {
          _id,
          abId: parent.abId,
          qualificationId: parent.qualificationId,
          type: parent.type,
          mode: parent.mode,
          assessmentStartDate: body.assessmentStartDate,
          assessmentEndDate: body.assessmentEndDate,
          tpId: parent.tpId,
          centreId,
          candidateCount: roster.length,
          sector: parent.sector,
          ratioClass: parent.ratioClass,
          assessmentLanguage: body.assessmentLanguage ?? parent.assessmentLanguage,
          state,
          recognitionOverride: override,
          status: "allocated",
          statusVersion: 1,
          isReassessment: true,
          reassessmentOf: parent._id,
          firstAssessmentBatchId: rootId,
          sla: {
            acceptDueAt: due.acceptDueAt,
            assignDueAt: due.assignDueAt,
            resultDueAt: due.resultDueAt,
            breached: [],
            lateActions: [],
          },
          accommodations: [...(parent.accommodations ?? [])],
          allocatedAt: now,
        },
      ],
      { session },
    );
    await Candidate.create(
      roster.map((row) => ({
        batchId: _id,
        learnerId: row.learnerId,
        name: row.name,
        ...(row.externalRef ? { externalRef: row.externalRef } : {}),
        accommodations: [...(row.accommodations ?? [])],
        active: true,
        sourceOriginalCandidateId: row.sourceOriginalCandidateId ?? row._id,
      })),
      { session, ordered: true },
    );
    return batch.toObject();
  });

  if (override) {
    await recordAudit({
      actorId: user._id,
      actorRole: user.role,
      action: "recognition_override",
      entity: "batch",
      entityId: String(created._id),
      abId: created.abId,
      batchId: created._id,
      meta: { reason: override.reason, checks: [...override.checks] },
      ip: context.ip,
    });
  }

  return {
    batch: presentBatch(created, { now, recompute: true }),
    stored: presentBatch(created, { now, recompute: false }),
    meta: {
      reassessmentOf: String(parent._id),
      firstAssessmentBatchId: String(rootId),
      originalPublishedAt: new Date(rootResult.publishedAt).toISOString(),
      ...window,
      learnerIds: roster.map((row) => String(row.learnerId)),
    },
  };
}
