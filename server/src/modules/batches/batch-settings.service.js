import { resolveBatchSettings } from "../../config/batch-settings.js";
import { AppError, forbidden, notFound, validationError } from "../../lib/errors.js";
import { isInBatchScope } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { Result } from "../../models/result.model.js";

const idOf = (value) => (value == null ? null : value.toString());

/** Settings of one batch as the API shows them: the full shape, defaults filled in. */
export function presentBatchSettings(batch) {
  return { batchId: idOf(batch._id), settings: resolveBatchSettings(batch.settings) };
}

/** GET. Unknown id is 404; a batch outside the caller's row scope is 403. */
export async function getBatchSettings(user, id) {
  const batch = await Batch.findById(id).select("abId tpId assessorId proctorId settings").lean();
  if (!batch) throw notFound();
  if (!isInBatchScope(user, batch)) throw forbidden();
  return presentBatchSettings(batch);
}

/** Overlays the groups and keys the request carries on the current full settings. */
export function mergeSettings(current, patch) {
  const next = {
    ...current,
    flagPolicy: { ...current.flagPolicy },
    imageCapture: { ...current.imageCapture },
    candidateInfoPopup: { ...current.candidateInfoPopup },
    languages: { ...current.languages },
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      next[key] = { ...next[key], ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * PATCH. aa_admin only (route and here). The merged settings must hold together: the pop-up
 * cannot be on with no fields. Stores the full merged shape so the change is explicit, and
 * returns before and after for the audit row. The settings hold no personal data.
 */
export async function updateBatchSettings(user, id, patch) {
  if (user.role !== "aa_admin") throw forbidden();
  const existing = await Batch.findById(id).lean();
  if (!existing) throw notFound();

  const before = resolveBatchSettings(existing.settings);
  const after = mergeSettings(before, patch);
  if (after.candidateInfoPopup.enabled && after.candidateInfoPopup.fields.length === 0) {
    throw validationError("Request validation failed", {
      "candidateInfoPopup.fields": ["Choose at least one field when the pop-up is on"],
    });
  }
  // X-27: recording the video records the shared screen, so screen sharing must be on.
  if (after.recordVideo === true && after.requireScreenShare !== true) {
    throw validationError("Request validation failed", {
      recordVideo: ["Turn on screen sharing to record the exam video"],
    });
  }
  // X-28: a flag can only keep a video moment when the exam video is recorded; the downloads need it too.
  if (after.recordVideo !== true) {
    const needs = {
      ufmEvidence: after.ufmEvidence === "video",
      downloadSessionVideo: after.downloadSessionVideo === true,
      downloadFlagVideo: after.downloadFlagVideo === true,
    };
    const errors = Object.fromEntries(
      Object.entries(needs)
        .filter(([, on]) => on)
        .map(([key]) => [key, ["Turn on exam video recording first"]]),
    );
    if (Object.keys(errors).length > 0) throw validationError("Request validation failed", errors);
  }
  // X-29: the pass rule and the marking type cannot change once marks have been saved for the batch.
  const RESULT_KEYS = ["passCriteria", "passPercentage", "practicalMarking", "vivaMarking"];
  if (
    RESULT_KEYS.some((key) => after[key] !== before[key]) &&
    (await Result.exists({ batchId: existing._id }))
  ) {
    throw new AppError(
      409,
      "BATCH_SETTINGS_LOCKED",
      "The pass rule and the marking type cannot be changed after marks were saved for this batch",
    );
  }
  // X-22: a batch under a scheme is a real assessment; it cannot be switched to a mock test.
  if (after.skipPaperApproval === true && before.skipPaperApproval !== true && existing.schemeId) {
    throw new AppError(
      409,
      "BATCH_MOCK_NOT_ALLOWED",
      "A batch linked to a scheme must use an approved paper, so it cannot be set up as a mock test",
    );
  }
  const normalised = resolveBatchSettings(after);

  const updated = await Batch.findOneAndUpdate(
    { _id: existing._id },
    { $set: { settings: normalised } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw notFound();
  return {
    abId: updated.abId,
    before,
    after: resolveBatchSettings(updated.settings),
    body: presentBatchSettings(updated),
  };
}
