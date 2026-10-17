import { compliance } from "./compliance.js";

/**
 * Per-batch settings. Task B-20. docs/SCHEMA.md §3.8 `settings`.
 * A batch with no stored `settings` behaves exactly as before: every default below is today's
 * behaviour. Stored values only override a default; `resolveBatchSettings` always returns the
 * full shape.
 */
export const FLAG_POLICY_ACTIONS = Object.freeze(["record", "pause"]);
export const FLAG_COUNT_SEVERITIES = Object.freeze(["medium", "high"]);
export const FLAG_PAUSE_AFTER_MIN = 1;
export const FLAG_PAUSE_AFTER_MAX = 20;
/** Roles besides aa_admin that can be allowed to see a candidate's location (X-12). */
export const LOCATION_VIEWER_ROLES = Object.freeze([
  "tp",
  "assessor",
  "proctor",
  "ab_reviewer",
  "ncvet_viewer",
]);
export const IMAGE_INTERVAL_MIN_SECONDS = 10;
export const IMAGE_INTERVAL_MAX_SECONDS = 120;
/** The only personal fields the pop-up can ask for. There is deliberately no national ID field. */
export const CANDIDATE_INFO_FIELDS = Object.freeze([
  "email",
  "fatherName",
  "gender",
  "dateOfBirth",
]);
export const CANDIDATE_INFO_GENDERS = Object.freeze(["female", "male", "other"]);

export function defaultBatchSettings() {
  return {
    // Today the start of an attempt already shuffles the questions, so the default stays on.
    shuffleQuestions: true,
    shuffleOptions: false,
    showMarksToCandidate: false,
    // X-12 (DECISIONS 805): marks wait until the awarding body has validated the result.
    marksAfterValidation: true,
    questionsMandatory: false,
    // extendOnUnlock (X-12): off keeps the clock running while paused; on gives the paused time back.
    flagPolicy: {
      action: "record",
      pauseAfterFlags: 3,
      countSeverities: ["high"],
      extendOnUnlock: false,
    },
    imageCapture: {
      intervalSeconds: compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS,
      atStartAndEnd: true,
    },
    candidateInfoPopup: { enabled: false, fields: [] },
    captureLocation: false,
    // X-16: the two newer camera and microphone checks can be switched off for a batch.
    // X-19: on, a complete paper can be used without the awarding body reviewer approving it (mock tests).
    skipPaperApproval: false,
    detectLookingAway: true,
    detectVoice: true,
    // X-12: aa_admin always sees it; these roles may too (the batch's own people only).
    locationVisibleTo: ["tp", "proctor"],
  };
}

const sortedSeverities = (list) => FLAG_COUNT_SEVERITIES.filter((s) => list.includes(s));

/** Stored settings (maybe missing, maybe partial) merged over the defaults. */
export function resolveBatchSettings(stored) {
  const base = defaultBatchSettings();
  if (!stored) return base;
  const policy = stored.flagPolicy ?? {};
  const image = stored.imageCapture ?? {};
  const info = stored.candidateInfoPopup ?? {};
  return {
    shuffleQuestions: stored.shuffleQuestions ?? base.shuffleQuestions,
    shuffleOptions: stored.shuffleOptions ?? base.shuffleOptions,
    showMarksToCandidate: stored.showMarksToCandidate ?? base.showMarksToCandidate,
    marksAfterValidation: stored.marksAfterValidation ?? base.marksAfterValidation,
    questionsMandatory: stored.questionsMandatory ?? base.questionsMandatory,
    flagPolicy: {
      action: policy.action ?? base.flagPolicy.action,
      pauseAfterFlags: policy.pauseAfterFlags ?? base.flagPolicy.pauseAfterFlags,
      countSeverities: sortedSeverities(
        policy.countSeverities?.length ? policy.countSeverities : base.flagPolicy.countSeverities,
      ),
      extendOnUnlock: policy.extendOnUnlock ?? base.flagPolicy.extendOnUnlock,
    },
    imageCapture: {
      intervalSeconds: image.intervalSeconds ?? base.imageCapture.intervalSeconds,
      atStartAndEnd: image.atStartAndEnd ?? base.imageCapture.atStartAndEnd,
    },
    candidateInfoPopup: {
      enabled: info.enabled ?? base.candidateInfoPopup.enabled,
      fields: CANDIDATE_INFO_FIELDS.filter((f) => (info.fields ?? []).includes(f)),
    },
    captureLocation: stored.captureLocation ?? base.captureLocation,
    skipPaperApproval: stored.skipPaperApproval ?? base.skipPaperApproval,
    detectLookingAway: stored.detectLookingAway ?? base.detectLookingAway,
    detectVoice: stored.detectVoice ?? base.detectVoice,
    locationVisibleTo: stored.locationVisibleTo
      ? LOCATION_VIEWER_ROLES.filter((r) => stored.locationVisibleTo.includes(r))
      : base.locationVisibleTo,
  };
}
