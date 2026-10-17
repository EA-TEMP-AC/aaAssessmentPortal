import { resolveBatchSettings } from "../../config/batch-settings.js";
import { AppError, forbidden, invalidTransition, notFound } from "../../lib/errors.js";
import { Batch } from "../../models/batch.model.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { presentBatch } from "./batch.service.js";

/** Batch statuses from which learner feedback may be recorded. SCHEMA §3.8. */
export const LEARNER_FEEDBACK_STATUSES = Object.freeze([
  "assessment_completed",
  "result_submitted",
  "ab_validated",
  "published",
  "disputed",
]);

function idOf(value) {
  return value == null ? null : value.toString();
}

export function presentLearnerFeedback(value) {
  if (!value) return null;
  return {
    collected: value.collected,
    reason: value.reason ?? null,
    note: value.note ?? null,
    collectedOn: value.collectedOn ?? null,
    recordedBy: idOf(value.recordedBy),
    recordedAt: new Date(value.recordedAt).toISOString(),
  };
}

/** GET. Unknown id is 404; a batch outside the caller's row scope is 403. */
export async function getLearnerFeedback(user, id) {
  const doc = await Batch.findById(id)
    .select("abId tpId assessorId proctorId learnerFeedback")
    .lean();
  if (!doc) throw notFound();
  if (!isInBatchScope(user, doc)) throw forbidden();
  return { batchId: idOf(doc._id), learnerFeedback: presentLearnerFeedback(doc.learnerFeedback) };
}

/**
 * PUT. Replaces the batch's one feedback record. Status is not touched.
 * The status check is part of the update filter, so a batch cancelled in
 * between cannot take a record.
 * @returns {Promise<{ before: object|null, batch: object, after: object }>}
 */
export async function saveLearnerFeedback(user, id, body, context = {}) {
  const now = context.now ?? new Date();
  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();
  if (!isInBatchScope(user, existing)) throw forbidden();
  if (!LEARNER_FEEDBACK_STATUSES.includes(existing.status)) throw invalidTransition();
  // X-30: the batch can switch student feedback off.
  if (resolveBatchSettings(existing.settings).studentFeedback === false) {
    throw new AppError(409, "BATCH_FEATURE_OFF", "Student feedback is switched off for this batch");
  }

  const record = {
    collected: body.collected,
    reason: body.collected ? null : body.reason,
    note: body.note ?? null,
    collectedOn: body.collectedOn ?? null,
    recordedBy: user._id,
    recordedAt: now,
  };
  const updated = await Batch.findOneAndUpdate(
    { _id: existing._id, status: { $in: LEARNER_FEEDBACK_STATUSES } },
    { $set: { learnerFeedback: record } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) {
    if (!(await Batch.exists({ _id: existing._id }))) throw notFound();
    throw invalidTransition();
  }
  return {
    before: presentLearnerFeedback(existing.learnerFeedback),
    batch: presentBatch(updated, { now }),
    after: presentLearnerFeedback(updated.learnerFeedback),
  };
}
