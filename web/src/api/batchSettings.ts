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
export const LOCATION_ROLES = ["tp", "assessor", "proctor", "ab_reviewer", "ncvet_viewer"] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];
export const LOCATION_ROLE_LABELS: Record<LocationRole, string> = {
  tp: "Training partner of this batch",
  assessor: "Assessor of this batch",
  proctor: "Proctor of this batch",
  ab_reviewer: "Awarding body reviewer",
  ncvet_viewer: "NCVET viewer",
};

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
  };
  imageCapture: { intervalSeconds: number; atStartAndEnd: boolean };
  candidateInfoPopup: { enabled: boolean; fields: InfoField[] };
  captureLocation: boolean;
  /** X-12: roles besides aa_admin that may see the coordinates. */
  locationVisibleTo: LocationRole[];
};

export type BatchSettingsPatch = Partial<
  Omit<BatchSettings, "flagPolicy" | "imageCapture" | "candidateInfoPopup">
> & {
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
  },
  imageCapture: { intervalSeconds: 30, atStartAndEnd: true },
  candidateInfoPopup: { enabled: false, fields: [] },
  captureLocation: false,
  locationVisibleTo: ["tp", "proctor"],
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
    marksAfterValidation: bool(root.marksAfterValidation, d.marksAfterValidation),
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
    },
    imageCapture: {
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
    locationVisibleTo: Array.isArray(root.locationVisibleTo)
      ? LOCATION_ROLES.filter((r) => (root.locationVisibleTo as unknown[]).includes(r))
      : d.locationVisibleTo,
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
