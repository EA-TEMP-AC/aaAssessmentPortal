import { ApiError, apiRequest } from "./client";

/**
 * Per-batch settings (task B-20). API_CONTRACT "Batch settings".
 * GET and PATCH /batches/:id/settings; the candidate pop-up calls under /batches/:id/candidate-info.
 * There is no national ID field anywhere in these types.
 */

export const FLAG_ACTIONS = ["record", "pause"] as const;
export type FlagAction = (typeof FLAG_ACTIONS)[number];

export const COUNT_SEVERITY_CHOICES = ["high", "medium_high"] as const;
export type CountSeverityChoice = (typeof COUNT_SEVERITY_CHOICES)[number];

export const PAUSE_AFTER_MIN = 1;
export const PAUSE_AFTER_MAX = 20;
export const INTERVAL_MIN_SECONDS = 10;
export const INTERVAL_MAX_SECONDS = 120;

export const INFO_FIELDS = [
  "email",
  "fatherName",
  "gender",
  "dateOfBirth",
] as const;
export type InfoField = (typeof INFO_FIELDS)[number];

export const INFO_FIELD_LABELS: Record<InfoField, string> = {
  email: "Email address",
  fatherName: "Father's name",
  gender: "Gender",
  dateOfBirth: "Date of birth",
};

export const GENDER_CHOICES = ["female", "male", "other"] as const;
export const GENDER_LABELS: Record<(typeof GENDER_CHOICES)[number], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
};

/** X-12. Roles besides aa_admin that can be allowed to see a candidate's location. */
export const LOCATION_ROLES = [
  "tp",
  "assessor",
  "proctor",
  "ab_reviewer",
  "ncvet_viewer",
] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];
export const LOCATION_ROLE_LABELS: Record<LocationRole, string> = {
  tp: "Training partner of this batch",
  assessor: "Assessor of this batch",
  proctor: "Proctor of this batch",
  ab_reviewer: "Awarding body reviewer",
  ncvet_viewer: "NCVET viewer",
};

export type VideoFailureAction = "continue" | "require";

/** X-28 (ThinkExam parity). */
/** X-29 */
export const PASS_CRITERIA_CHOICES = [
  "qualification",
  "nos_wise",
  "overall",
] as const;
export type PassCriteria = (typeof PASS_CRITERIA_CHOICES)[number];
export const PASS_PERCENTAGE_MIN = 1;
export const PASS_PERCENTAGE_MAX = 100;
export const MARKING_TYPES = ["marks", "rubric"] as const;
export type MarkingType = (typeof MARKING_TYPES)[number];
/** X-29: the three fixed levels used when practical or viva is marked by rubric. */
export const RUBRIC_LEVELS = [
  { key: "good", label: "Good", percent: 100 },
  { key: "satisfactory", label: "Satisfactory", percent: 70 },
  { key: "poor", label: "Poor", percent: 10 },
] as const;
export const PROCTORING_TYPES = ["automatic", "manual"] as const;
export type ProctoringType = (typeof PROCTORING_TYPES)[number];
export const UFM_EVIDENCE_TYPES = ["image", "video"] as const;
export type UfmEvidence = (typeof UFM_EVIDENCE_TYPES)[number];
export const LANGUAGE_PARTS = ["theory", "practical", "viva"] as const;
export type LanguagePart = (typeof LANGUAGE_PARTS)[number];

export type BatchSettings = {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showMarksToCandidate: boolean;
  /** X-12: with the switch above on, marks wait until the awarding body has validated the result. */
  marksAfterValidation: boolean;
  questionsMandatory: boolean;
  flagPolicy: {
    action: FlagAction;
    pauseAfterFlags: number;
    countSeverities: ("medium" | "high")[];
    /** X-12: an unlock gives the paused time back to the candidate. */
    extendOnUnlock: boolean;
    /** X-28: flags allowed after an unlock before the exam is paused again. */
    pauseAfterUnlock: number;
  };
  imageCapture: {
    enabled: boolean;
    intervalSeconds: number;
    atStartAndEnd: boolean;
  };
  candidateInfoPopup: { enabled: boolean; fields: InfoField[] };
  captureLocation: boolean;
  /** X-19: a complete paper can be used without the reviewer's approval (mock tests). */
  skipPaperApproval: boolean;
  /** X-16: raise the looking-away flag from the camera. */
  detectLookingAway: boolean;
  /** X-16: raise the voice-heard flag from the microphone loudness. */
  detectVoice: boolean;
  requireScreenShare: boolean;
  /** X-27: record the camera and the shared screen for the whole exam (needs screen sharing). */
  recordVideo: boolean;
  /** X-27: when recording fails, `continue` flags it; `require` also stops the candidate starting. */
  videoFailureAction: VideoFailureAction;
  /** X-27: roles besides aa_admin that may watch the recording. */
  videoVisibleTo: LocationRole[];
  /** X-12: roles besides aa_admin that may see the coordinates. */
  locationVisibleTo: LocationRole[];
  /** X-28: automatic = the browser raises flags; manual = a proctor watches, no automatic flags. */
  proctoringType: ProctoringType;
  /** X-28: off switches every camera and microphone model flag off. */
  aiEnabled: boolean;
  /** X-28: what a flag keeps as evidence. `video` needs the exam video. */
  ufmEvidence: UfmEvidence;
  downloadSessionVideo: boolean;
  downloadFlagVideo: boolean;
  allowPracticalVideo: boolean;
  allowVivaVideo: boolean;
  assessorGeolocation: boolean;
  assessorAnnexureM: boolean;
  assessorFeedback: boolean;
  studentAttendance: boolean;
  studentFeedback: boolean;
  languages: Record<LanguagePart, boolean>;
  allowOjtImages: boolean;
  /** X-29: `qualification` keeps the qualification's pass rule; the other two replace it for this batch. */
  passCriteria: PassCriteria;
  passPercentage: number;
  practicalMarking: MarkingType;
  vivaMarking: MarkingType;
};

export type BatchSettingsPatch = Partial<
  Omit<
    BatchSettings,
    "flagPolicy" | "imageCapture" | "candidateInfoPopup" | "languages"
  >
> & {
  languages?: Partial<BatchSettings["languages"]>;
  flagPolicy?: Partial<BatchSettings["flagPolicy"]>;
  imageCapture?: Partial<BatchSettings["imageCapture"]>;
  candidateInfoPopup?: Partial<BatchSettings["candidateInfoPopup"]>;
};

/** Today's behaviour. Matches server/src/config/batch-settings.js. */
export const DEFAULT_BATCH_SETTINGS: BatchSettings = {
  shuffleQuestions: true,
  shuffleOptions: false,
  showMarksToCandidate: false,
  marksAfterValidation: true,
  questionsMandatory: false,
  flagPolicy: {
    action: "record",
    pauseAfterFlags: 3,
    countSeverities: ["high"],
    extendOnUnlock: false,
    pauseAfterUnlock: 3,
  },
  imageCapture: { enabled: true, intervalSeconds: 30, atStartAndEnd: true },
  candidateInfoPopup: { enabled: false, fields: [] },
  captureLocation: false,
  skipPaperApproval: false,
  detectLookingAway: true,
  detectVoice: true,
  requireScreenShare: false,
  recordVideo: false,
  videoFailureAction: "continue",
  videoVisibleTo: ["proctor"],
  locationVisibleTo: ["tp", "proctor"],
  proctoringType: "automatic",
  aiEnabled: true,
  ufmEvidence: "image",
  downloadSessionVideo: false,
  downloadFlagVideo: false,
  allowPracticalVideo: false,
  allowVivaVideo: false,
  assessorGeolocation: false,
  assessorAnnexureM: true,
  assessorFeedback: false,
  studentAttendance: true,
  studentFeedback: true,
  languages: { theory: false, practical: false, viva: false },
  allowOjtImages: false,
  passCriteria: "qualification",
  passPercentage: 50,
  practicalMarking: "marks",
  vivaMarking: "marks",
};

function bad(what: string): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    `${what} response was not recognised.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}

export function parseBatchSettings(value: unknown): BatchSettings {
  const root =
    isRecord(value) && isRecord(value.settings) ? value.settings : null;
  if (!root) throw bad("Batch settings");
  const d = DEFAULT_BATCH_SETTINGS;
  const policy = isRecord(root.flagPolicy) ? root.flagPolicy : {};
  const image = isRecord(root.imageCapture) ? root.imageCapture : {};
  const info = isRecord(root.candidateInfoPopup) ? root.candidateInfoPopup : {};
  const languages = isRecord(root.languages) ? root.languages : {};
  const severities = Array.isArray(policy.countSeverities)
    ? (policy.countSeverities.filter((s) => s === "medium" || s === "high") as (
        "medium" | "high"
      )[])
    : d.flagPolicy.countSeverities;
  return {
    shuffleQuestions: bool(root.shuffleQuestions, d.shuffleQuestions),
    shuffleOptions: bool(root.shuffleOptions, d.shuffleOptions),
    showMarksToCandidate: bool(
      root.showMarksToCandidate,
      d.showMarksToCandidate,
    ),
    marksAfterValidation: bool(
      root.marksAfterValidation,
      d.marksAfterValidation,
    ),
    questionsMandatory: bool(root.questionsMandatory, d.questionsMandatory),
    flagPolicy: {
      action: policy.action === "pause" ? "pause" : "record",
      pauseAfterFlags: int(
        policy.pauseAfterFlags,
        d.flagPolicy.pauseAfterFlags,
      ),
      countSeverities:
        severities.length > 0 ? severities : d.flagPolicy.countSeverities,
      extendOnUnlock: bool(policy.extendOnUnlock, d.flagPolicy.extendOnUnlock),
      pauseAfterUnlock: int(
        policy.pauseAfterUnlock,
        d.flagPolicy.pauseAfterUnlock,
      ),
    },
    imageCapture: {
      enabled: bool(image.enabled, d.imageCapture.enabled),
      intervalSeconds: int(
        image.intervalSeconds,
        d.imageCapture.intervalSeconds,
      ),
      atStartAndEnd: bool(image.atStartAndEnd, d.imageCapture.atStartAndEnd),
    },
    candidateInfoPopup: {
      enabled: bool(info.enabled, false),
      fields: Array.isArray(info.fields)
        ? INFO_FIELDS.filter((f) => (info.fields as unknown[]).includes(f))
        : [],
    },
    captureLocation: bool(root.captureLocation, d.captureLocation),
    skipPaperApproval: bool(root.skipPaperApproval, d.skipPaperApproval),
    detectLookingAway: bool(root.detectLookingAway, d.detectLookingAway),
    detectVoice: bool(root.detectVoice, d.detectVoice),
    requireScreenShare: bool(root.requireScreenShare, d.requireScreenShare),
    recordVideo: bool(root.recordVideo, d.recordVideo),
    videoFailureAction:
      root.videoFailureAction === "require" ? "require" : "continue",
    videoVisibleTo: Array.isArray(root.videoVisibleTo)
      ? LOCATION_ROLES.filter((r) =>
          (root.videoVisibleTo as unknown[]).includes(r),
        )
      : d.videoVisibleTo,
    locationVisibleTo: Array.isArray(root.locationVisibleTo)
      ? LOCATION_ROLES.filter((r) =>
          (root.locationVisibleTo as unknown[]).includes(r),
        )
      : d.locationVisibleTo,
    proctoringType: root.proctoringType === "manual" ? "manual" : "automatic",
    aiEnabled: bool(root.aiEnabled, d.aiEnabled),
    ufmEvidence: root.ufmEvidence === "video" ? "video" : "image",
    downloadSessionVideo: bool(
      root.downloadSessionVideo,
      d.downloadSessionVideo,
    ),
    downloadFlagVideo: bool(root.downloadFlagVideo, d.downloadFlagVideo),
    allowPracticalVideo: bool(root.allowPracticalVideo, d.allowPracticalVideo),
    allowVivaVideo: bool(root.allowVivaVideo, d.allowVivaVideo),
    assessorGeolocation: bool(root.assessorGeolocation, d.assessorGeolocation),
    assessorAnnexureM: bool(root.assessorAnnexureM, d.assessorAnnexureM),
    assessorFeedback: bool(root.assessorFeedback, d.assessorFeedback),
    studentAttendance: bool(root.studentAttendance, d.studentAttendance),
    studentFeedback: bool(root.studentFeedback, d.studentFeedback),
    languages: {
      theory: bool(languages.theory, d.languages.theory),
      practical: bool(languages.practical, d.languages.practical),
      viva: bool(languages.viva, d.languages.viva),
    },
    allowOjtImages: bool(root.allowOjtImages, d.allowOjtImages),
    passCriteria:
      root.passCriteria === "nos_wise" || root.passCriteria === "overall"
        ? root.passCriteria
        : "qualification",
    passPercentage: int(root.passPercentage, d.passPercentage),
    practicalMarking: root.practicalMarking === "rubric" ? "rubric" : "marks",
    vivaMarking: root.vivaMarking === "rubric" ? "rubric" : "marks",
  };
}

export async function getBatchSettings(
  batchId: string,
  signal?: AbortSignal,
): Promise<BatchSettings> {
  const body = await apiRequest<unknown>(
    `/batches/${encodeURIComponent(batchId)}/settings`,
    { signal },
  );
  return parseBatchSettings(body);
}

export async function saveBatchSettings(
  batchId: string,
  patch: BatchSettingsPatch,
): Promise<BatchSettings> {
  const body = await apiRequest<unknown>(
    `/batches/${encodeURIComponent(batchId)}/settings`,
    {
      method: "PATCH",
      body: patch,
    },
  );
  return parseBatchSettings(body);
}

/* ---------------------------------------------------------- candidate pop-up */

export type CandidateInfoStatus = {
  enabled: boolean;
  fields: InfoField[];
  submitted: boolean;
};

export type CandidateInfoValues = Partial<Record<InfoField, string>>;

export async function getCandidateInfoStatus(
  batchId: string,
  signal?: AbortSignal,
): Promise<CandidateInfoStatus> {
  const body = await apiRequest<unknown>(
    `/batches/${encodeURIComponent(batchId)}/candidate-info/mine`,
    { signal },
  );
  if (!isRecord(body)) throw bad("Candidate details");
  return {
    enabled: body.enabled === true,
    fields: Array.isArray(body.fields)
      ? INFO_FIELDS.filter((f) => (body.fields as unknown[]).includes(f))
      : [],
    submitted: body.submitted === true,
  };
}

export async function saveCandidateInfo(
  batchId: string,
  values: CandidateInfoValues,
): Promise<void> {
  await apiRequest<unknown>(
    `/batches/${encodeURIComponent(batchId)}/candidate-info`,
    {
      method: "PUT",
      body: values,
    },
  );
}
