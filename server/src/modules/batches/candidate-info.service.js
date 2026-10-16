import { CANDIDATE_INFO_FIELDS, resolveBatchSettings } from "../../config/batch-settings.js";
import { AppError, forbidden, notFound, validationError } from "../../lib/errors.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { CandidateInfo } from "../../models/candidate-info.model.js";
import { Candidate } from "../../models/candidate.model.js";

const iso = (v) => (v ? new Date(v).toISOString() : null);
const idOf = (v) => (v == null ? null : String(v));

async function loadOwnRoster(user, batchId) {
  if (user.linkedProfileId == null) throw forbidden();
  const roster = await Candidate.findOne({ batchId, learnerId: user.linkedProfileId })
    .select("_id learnerId active")
    .lean();
  if (!roster || roster.active !== true) throw forbidden("Not on the active roster of this batch");
  return roster;
}

const popupOf = (batch) => resolveBatchSettings(batch.settings).candidateInfoPopup;

/** GET (candidate). Which fields to ask and whether this candidate already answered. No values. */
export async function getOwnPopup(user, batchId) {
  const batch = await Batch.findById(batchId).select("settings").lean();
  if (!batch) throw notFound();
  const roster = await loadOwnRoster(user, batch._id);
  const popup = popupOf(batch);
  const done = popup.enabled
    ? await CandidateInfo.exists({ batchId: batch._id, candidateId: roster._id })
    : null;
  return {
    batchId: idOf(batch._id),
    enabled: popup.enabled,
    fields: popup.fields,
    submitted: popup.enabled ? Boolean(done) : false,
  };
}

/**
 * PUT (candidate). Exactly the fields the batch asks for, no others. Replaces an earlier answer.
 * The values are encrypted by the model. The audit row gets only the field names.
 */
export async function saveOwnInfo(user, batchId, body, now = new Date()) {
  const batch = await Batch.findById(batchId).select("abId settings").lean();
  if (!batch) throw notFound();
  const roster = await loadOwnRoster(user, batch._id);
  const popup = popupOf(batch);
  if (!popup.enabled) {
    throw new AppError(
      409,
      "CANDIDATE_INFO_NOT_ENABLED",
      "This batch does not ask for these details",
    );
  }
  const problems = {};
  for (const key of Object.keys(body)) {
    if (!popup.fields.includes(key)) problems[key] = ["This field is not asked for in this batch"];
  }
  for (const field of popup.fields) {
    if (body[field] === undefined) problems[field] = ["Required"];
  }
  if (Object.keys(problems).length > 0) {
    throw validationError("Request validation failed", problems);
  }
  const values = Object.fromEntries(popup.fields.map((f) => [f, body[f]]));
  const dropped = CANDIDATE_INFO_FIELDS.filter((f) => !popup.fields.includes(f));
  await CandidateInfo.findOneAndUpdate(
    { batchId: batch._id, candidateId: roster._id },
    {
      $set: { ...values, learnerId: roster.learnerId, submittedAt: now },
      ...(dropped.length > 0 ? { $unset: Object.fromEntries(dropped.map((f) => [f, ""])) } : {}),
    },
    { upsert: true, new: true, runValidators: true },
  );
  return {
    abId: batch.abId,
    fields: popup.fields,
    body: { batchId: idOf(batch._id), submitted: true, fields: popup.fields },
  };
}

/** GET (aa_admin, tp of the batch). The candidates' own answers, newest first. */
export async function listBatchInfo(user, batchId) {
  const batch = await Batch.findById(batchId).select("abId tpId settings").lean();
  if (!batch) throw notFound();
  if (!isInBatchScope(user, batch)) throw forbidden();
  const popup = popupOf(batch);
  const rows = await CandidateInfo.find({ batchId: batch._id }).sort({ submittedAt: -1 }).lean();
  const names = new Map(
    (
      await Candidate.find({ _id: { $in: rows.map((r) => r.candidateId) } })
        .select("name")
        .lean()
    ).map((c) => [String(c._id), c.name]),
  );
  return {
    batchId: idOf(batch._id),
    enabled: popup.enabled,
    fields: popup.fields,
    items: rows.map((r) => ({
      candidateId: idOf(r.candidateId),
      learnerId: idOf(r.learnerId),
      candidateName: names.get(String(r.candidateId)) ?? null,
      submittedAt: iso(r.submittedAt),
      ...Object.fromEntries(CANDIDATE_INFO_FIELDS.map((f) => [f, r[f] ?? null])),
    })),
  };
}
