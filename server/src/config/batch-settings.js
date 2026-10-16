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
    questionsMandatory: false,
    flagPolicy: { action: "record", pauseAfterFlags: 3, countSeverities: ["high"] },
    imageCapture: {
      intervalSeconds: compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS,
      atStartAndEnd: true,
    },
    candidateInfoPopup: { enabled: false, fields: [] },
    captureLocation: false,
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
    questionsMandatory: stored.questionsMandatory ?? base.questionsMandatory,
    flagPolicy: {
      action: policy.action ?? base.flagPolicy.action,
      pauseAfterFlags: policy.pauseAfterFlags ?? base.flagPolicy.pauseAfterFlags,
      countSeverities: sortedSeverities(
        policy.countSeverities?.length ? policy.countSeverities : base.flagPolicy.countSeverities,
      ),
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
  };
}
