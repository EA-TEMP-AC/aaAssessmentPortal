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
/** X-27: what happens when the exam video cannot be recorded. `continue` flags it; `require` also blocks the start. */
export const VIDEO_FAILURE_ACTIONS = Object.freeze(["continue", "require"]);
/** X-28: automatic = the browser raises flags by itself; manual = a proctor watches, no automatic flags. */
export const PROCTORING_TYPES = Object.freeze(["automatic", "manual"]);
/** X-28: what a proctoring flag keeps as evidence. `video` needs the exam video (recordVideo). */
export const UFM_EVIDENCE_TYPES = Object.freeze(["image", "video"]);
/** X-28: the three parts of an assessment that can each have their own languages. */
export const LANGUAGE_PARTS = Object.freeze(["theory", "practical", "viva"]);
/** X-28: the flags that come from the camera and microphone models. Manual proctoring or "AI off" switches them off. */
export const AI_FLAG_TYPES = Object.freeze([
  "face_not_present",
  "multiple_faces",
  "person_detected",
  "phone_detected",
  "object_detected",
  "face_mismatch",
  "looking_away",
  "voice_detected",
]);
/**
 * X-29. `qualification` keeps the pass rule of the qualification. `nos_wise` and `overall` replace its
 * rule for this batch: one percentage for theory, practical and viva, judged per NOS or on the sums.
 */
export const PASS_CRITERIA_CHOICES = Object.freeze(["qualification", "nos_wise", "overall"]);
export const PASS_PERCENTAGE_MIN = 1;
export const PASS_PERCENTAGE_MAX = 100;
/** X-29. `rubric`: the assessor picks one of the three levels below instead of typing a mark. */
export const MARKING_TYPES = Object.freeze(["marks", "rubric"]);
/** X-29. Fixed for every batch (the human chose the three levels of the reference system). */
export const RUBRIC_LEVELS = Object.freeze([
  Object.freeze({ key: "good", label: "Good", percent: 100 }),
  Object.freeze({ key: "satisfactory", label: "Satisfactory", percent: 70 }),
  Object.freeze({ key: "poor", label: "Poor", percent: 10 }),
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
      // X-28: flags allowed after an unlock before the exam is paused again.
      pauseAfterUnlock: 3,
    },
    imageCapture: {
      // X-28: false stops the pictures taken during the exam (start and end pictures have their own switch).
      enabled: true,
      intervalSeconds: compliance.PROCTOR_SNAPSHOT_INTERVAL_SECONDS,
      atStartAndEnd: true,
    },
    candidateInfoPopup: { enabled: false, fields: [] },
    captureLocation: false,
    // X-16: the two newer camera and microphone checks can be switched off for a batch.
    // X-19: on, a complete paper can be used without the awarding body reviewer approving it (mock tests).
    skipPaperApproval: false,
    // X-21: the candidate must share the whole screen for the exam; stopping the share raises a flag.
    requireScreenShare: false,
    detectLookingAway: true,
    detectVoice: true,
    // X-27: record the camera and the shared screen for the whole exam (needs requireScreenShare).
    recordVideo: false,
    videoFailureAction: "continue",
    // X-27: aa_admin always can watch; these roles too, for batches in their own scope.
    videoVisibleTo: ["proctor"],
    // X-12: aa_admin always sees it; these roles may too (the batch's own people only).
    locationVisibleTo: ["tp", "proctor"],
    // X-28 (ThinkExam parity). Wired: proctoringType, aiEnabled, the session video download, the
    // practical/viva video, assessor geolocation, student attendance and feedback, OJT pictures (X-30).
    // Stored only until their own feature exists: ufmEvidence video, the flag video download,
    // Annexure M, assessor feedback and the languages. Defaults keep today's behaviour.
    proctoringType: "automatic",
    aiEnabled: true,
    ufmEvidence: "image",
    downloadSessionVideo: false,
    downloadFlagVideo: false,
    allowPracticalVideo: true,
    allowVivaVideo: true,
    assessorGeolocation: true,
    assessorAnnexureM: true,
    assessorFeedback: false,
    // X-31: identity-card checks for the assessor. Switches only; the card number is never entered or stored.
    assessorIdCardCheck: false,
    assessorIdNameCheck: false,
    studentAttendance: true,
    studentFeedback: true,
    languages: { theory: false, practical: false, viva: false },
    allowOjtImages: false,
    // X-29: a pass rule for this batch only; `qualification` leaves the qualification's rule alone.
    passCriteria: "qualification",
    passPercentage: 50,
    practicalMarking: "marks",
    vivaMarking: "marks",
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
      pauseAfterUnlock: policy.pauseAfterUnlock ?? base.flagPolicy.pauseAfterUnlock,
    },
    imageCapture: {
      enabled: image.enabled ?? base.imageCapture.enabled,
      intervalSeconds: image.intervalSeconds ?? base.imageCapture.intervalSeconds,
      atStartAndEnd: image.atStartAndEnd ?? base.imageCapture.atStartAndEnd,
    },
    candidateInfoPopup: {
      enabled: info.enabled ?? base.candidateInfoPopup.enabled,
      fields: CANDIDATE_INFO_FIELDS.filter((f) => (info.fields ?? []).includes(f)),
    },
    captureLocation: stored.captureLocation ?? base.captureLocation,
    skipPaperApproval: stored.skipPaperApproval ?? base.skipPaperApproval,
    requireScreenShare: stored.requireScreenShare ?? base.requireScreenShare,
    detectLookingAway: stored.detectLookingAway ?? base.detectLookingAway,
    detectVoice: stored.detectVoice ?? base.detectVoice,
    recordVideo: stored.recordVideo ?? base.recordVideo,
    videoFailureAction: stored.videoFailureAction ?? base.videoFailureAction,
    videoVisibleTo: stored.videoVisibleTo
      ? LOCATION_VIEWER_ROLES.filter((r) => stored.videoVisibleTo.includes(r))
      : base.videoVisibleTo,
    locationVisibleTo: stored.locationVisibleTo
      ? LOCATION_VIEWER_ROLES.filter((r) => stored.locationVisibleTo.includes(r))
      : base.locationVisibleTo,
    proctoringType: stored.proctoringType ?? base.proctoringType,
    aiEnabled: stored.aiEnabled ?? base.aiEnabled,
    ufmEvidence: stored.ufmEvidence ?? base.ufmEvidence,
    downloadSessionVideo: stored.downloadSessionVideo ?? base.downloadSessionVideo,
    downloadFlagVideo: stored.downloadFlagVideo ?? base.downloadFlagVideo,
    allowPracticalVideo: stored.allowPracticalVideo ?? base.allowPracticalVideo,
    allowVivaVideo: stored.allowVivaVideo ?? base.allowVivaVideo,
    assessorGeolocation: stored.assessorGeolocation ?? base.assessorGeolocation,
    assessorAnnexureM: stored.assessorAnnexureM ?? base.assessorAnnexureM,
    assessorFeedback: stored.assessorFeedback ?? base.assessorFeedback,
    assessorIdCardCheck: stored.assessorIdCardCheck ?? base.assessorIdCardCheck,
    assessorIdNameCheck: stored.assessorIdNameCheck ?? base.assessorIdNameCheck,
    studentAttendance: stored.studentAttendance ?? base.studentAttendance,
    studentFeedback: stored.studentFeedback ?? base.studentFeedback,
    languages: Object.fromEntries(
      LANGUAGE_PARTS.map((part) => [part, stored.languages?.[part] ?? base.languages[part]]),
    ),
    allowOjtImages: stored.allowOjtImages ?? base.allowOjtImages,
    passCriteria: stored.passCriteria ?? base.passCriteria,
    passPercentage: stored.passPercentage ?? base.passPercentage,
    practicalMarking: stored.practicalMarking ?? base.practicalMarking,
    vivaMarking: stored.vivaMarking ?? base.vivaMarking,
  };
}
