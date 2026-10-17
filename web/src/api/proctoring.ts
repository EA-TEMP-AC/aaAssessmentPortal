import { apiRequest, ApiError } from "./client";
import { listEvidence, type EvidenceRow } from "./evidence";

/** API_CONTRACT "Proctoring (tasks P-01, P-04, P-08)". Staff screens only. */

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SESSION_STATUSES = ["active", "feed_lost", "ended"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  feed_lost: "Feed lost",
  ended: "Ended",
};

export const FLAG_TYPE_LABELS: Record<string, string> = {
  tab_hidden: "Tab hidden",
  fullscreen_exit: "Left full screen",
  window_blur: "Window lost focus",
  permission_revoked: "Camera permission removed",
  object_detected: "Object detected",
  face_not_present: "No face in view",
  multiple_faces: "More than one face",
  person_detected: "Another person detected",
  phone_detected: "Phone detected",
  camera_blocked: "Camera blocked",
  camera_frozen: "Camera frozen",
  face_mismatch: "Face differs from the selfie",
  id_mismatch: "ID card photo differs from the selfie",
  id_unreadable: "ID card photo not readable",
  looking_away: "Looking away from the screen",
  voice_detected: "Voice heard",
};

export const DECISION_LABELS: Record<Decision, string> = {
  dismiss: "Dismissed",
  warn: "Warned",
  invalidate_recommended: "Invalidation recommended",
};

export type Decision = "dismiss" | "warn" | "invalidate_recommended";

export type FlagCounts = { low: number; medium: number; high: number };

export type SessionItem = {
  id: string;
  attemptId: string;
  batchId: string;
  candidateId: string;
  candidateName: string | null;
  /** X-11: the batch in words (qualification and dates). Null when the server had none. */
  batchLabel: string | null;
  status: SessionStatus;
  startedAt: string | null;
  lastSeenAt: string | null;
  flagCounts: FlagCounts;
  unreviewedCount: number;
  warningCount: number;
  invalidationRecommended: boolean;
  /** B-20: the batch's flag policy has paused this exam. */
  paused: boolean;
};

export type SessionPage = {
  page: number;
  pageSize: number;
  total: number;
  items: SessionItem[];
};

export type FlagReview = {
  decision: Decision;
  note: string | null;
  decidedAt: string;
  decidedByRole: string;
};

export type Flag = {
  id: string;
  type: string;
  severity: Severity;
  capturedAt: string;
  evidenceId: string | null;
  detail: { label?: string; count?: number; confidence?: number } | null;
  /** How long the condition must last before the browser raises this type; null for one-off events. */
  sustainedSeconds: number | null;
  /** X-07: whether coordinates were kept for this flag. The coordinates come from getFlagCapture. */
  locationStatus: "captured" | "not_shared";
  review: FlagReview | null;
};

export type Warning = { id: string; message: string; createdAt: string };

export type SessionLock = {
  paused: boolean;
  pausedAt: string | null;
  timesPaused: number;
  countedFlags: number;
  policy: {
    action: "record" | "pause";
    pauseAfterFlags: number;
    countSeverities: string[];
  };
};

export type SessionDetail = SessionItem & {
  flags: Flag[];
  warnings: Warning[];
  lock: SessionLock | null;
};

export type SessionQuery = {
  batchId?: string;
  status?: string;
  minSeverity?: string;
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

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" &&
    (SEVERITIES as readonly string[]).includes(value)
  );
}

function isStatus(value: unknown): value is SessionStatus {
  return (
    typeof value === "string" &&
    (SESSION_STATUSES as readonly string[]).includes(value)
  );
}

function isDecision(value: unknown): value is Decision {
  return (
    value === "dismiss" ||
    value === "warn" ||
    value === "invalidate_recommended"
  );
}

function parseItem(value: unknown): SessionItem {
  if (!isRecord(value)) throw bad("Proctoring session");
  const id = str(value.id);
  const attemptId = str(value.attemptId);
  const batchId = str(value.batchId);
  const candidateId = str(value.candidateId);
  if (
    !id ||
    !attemptId ||
    !batchId ||
    !candidateId ||
    !isStatus(value.status)
  ) {
    throw bad("Proctoring session");
  }
  const counts = isRecord(value.flagCounts) ? value.flagCounts : {};
  return {
    id,
    attemptId,
    batchId,
    candidateId,
    candidateName: str(value.candidateName),
    batchLabel: str(value.batchLabel),
    status: value.status,
    startedAt: str(value.startedAt),
    lastSeenAt: str(value.lastSeenAt),
    flagCounts: {
      low: num(counts.low),
      medium: num(counts.medium),
      high: num(counts.high),
    },
    unreviewedCount: num(value.unreviewedCount),
    warningCount: num(value.warningCount),
    invalidationRecommended: value.invalidationRecommended === true,
    paused: value.paused === true,
  };
}

export function parseLock(value: unknown): SessionLock | null {
  if (!isRecord(value)) return null;
  const policy = isRecord(value.policy) ? value.policy : {};
  return {
    paused: value.paused === true,
    pausedAt: str(value.pausedAt),
    timesPaused: num(value.timesPaused),
    countedFlags: num(value.countedFlags),
    policy: {
      action: policy.action === "pause" ? "pause" : "record",
      pauseAfterFlags: num(policy.pauseAfterFlags),
      countSeverities: Array.isArray(policy.countSeverities)
        ? policy.countSeverities.filter(
            (s): s is string => typeof s === "string",
          )
        : [],
    },
  };
}

function parseReview(value: unknown): FlagReview | null {
  if (!isRecord(value) || !isDecision(value.decision)) return null;
  return {
    decision: value.decision,
    note: str(value.note),
    decidedAt: str(value.decidedAt) ?? "",
    decidedByRole: str(value.decidedByRole) ?? "",
  };
}

function parseFlag(value: unknown): Flag {
  if (!isRecord(value)) throw bad("Proctoring flag");
  const id = str(value.id);
  const type = str(value.type);
  const capturedAt = str(value.capturedAt);
  if (!id || !type || !capturedAt || !isSeverity(value.severity))
    throw bad("Proctoring flag");
  const detail = isRecord(value.detail)
    ? {
        label: str(value.detail.label) ?? undefined,
        count:
          typeof value.detail.count === "number"
            ? value.detail.count
            : undefined,
        confidence:
          typeof value.detail.confidence === "number"
            ? value.detail.confidence
            : undefined,
      }
    : null;
  return {
    id,
    type,
    severity: value.severity,
    capturedAt,
    evidenceId: str(value.evidenceId),
    detail,
    sustainedSeconds:
      typeof value.sustainedSeconds === "number" &&
      Number.isFinite(value.sustainedSeconds)
        ? value.sustainedSeconds
        : null,
    locationStatus:
      value.locationStatus === "captured" ? "captured" : "not_shared",
    review: parseReview(value.review),
  };
}

function parseWarning(value: unknown): Warning | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const message = str(value.message);
  const createdAt = str(value.createdAt);
  return id && message && createdAt ? { id, message, createdAt } : null;
}

export async function listProctoringSessions(
  query: SessionQuery,
  signal?: AbortSignal,
): Promise<SessionPage> {
  const params = new URLSearchParams();
  for (const key of ["batchId", "status", "minSeverity"] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const body = await apiRequest<unknown>(
    `/proctoring/sessions${qs ? `?${qs}` : ""}`,
    { signal },
  );
  if (!isRecord(body) || !Array.isArray(body.items))
    throw bad("Proctoring sessions");
  return {
    page: num(body.page) || 1,
    pageSize: num(body.pageSize) || 50,
    total: num(body.total),
    items: body.items.map(parseItem),
  };
}

export async function getProctoringSession(
  id: string,
  signal?: AbortSignal,
): Promise<SessionDetail> {
  const body = await apiRequest<unknown>(
    `/proctoring/sessions/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!isRecord(body) || !Array.isArray(body.flags))
    throw bad("Proctoring session");
  return {
    ...parseItem(body),
    flags: body.flags.map(parseFlag),
    warnings: Array.isArray(body.warnings)
      ? body.warnings.map(parseWarning).filter((w): w is Warning => w !== null)
      : [],
    lock: parseLock(body.lock),
  };
}

/** B-20: lifts a flag-policy pause. aa_admin, or the proctor of the batch. */
export async function unlockProctoringSession(
  id: string,
): Promise<SessionLock | null> {
  const body = await apiRequest<unknown>(
    `/proctoring/sessions/${encodeURIComponent(id)}/unlock`,
    {
      method: "POST",
    },
  );
  return isRecord(body) ? parseLock(body.lock) : null;
}

/**
 * Every snapshot of a session (X-06), newest first. Reads the evidence list page by page; the
 * server caps a page at 100. Stops after 10 pages so a very long session cannot loop for long.
 */
export async function listSessionSnapshots(
  sessionId: string,
  signal?: AbortSignal,
): Promise<EvidenceRow[]> {
  const rows: EvidenceRow[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await listEvidence(
      { sessionId, kind: "proctor_snapshot", page, pageSize: 100 },
      signal,
    );
    rows.push(...result.items);
    if (rows.length >= result.total || result.items.length === 0) break;
  }
  return rows;
}

export async function reviewProctoringFlag(
  id: string,
  decision: Decision,
  note?: string,
): Promise<Flag> {
  const trimmed = note?.trim();
  const body = await apiRequest<unknown>(
    `/proctoring/flags/${encodeURIComponent(id)}/review`,
    {
      method: "PATCH",
      body: trimmed ? { decision, note: trimmed } : { decision },
    },
  );
  return parseFlag(body);
}

/** X-07: what the server saved about a flag photo, to read next to the picture. */
export type FlagCapture = {
  flagId: string;
  type: string;
  reason: string;
  severity: Severity;
  /** The browser's clock; the time drawn on the photo comes from it. */
  capturedAt: string;
  /** The server's clock when the flag arrived. */
  receivedAt: string;
  evidenceId: string | null;
  locationStatus: "captured" | "not_shared";
  /** False for roles that may not see coordinates (assessor, awarding body reviewer, NCVET viewer). */
  locationVisible: boolean;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null;
};

export async function getFlagCapture(
  flagId: string,
  signal?: AbortSignal,
): Promise<FlagCapture> {
  const body = await apiRequest<unknown>(
    `/proctoring/flags/${encodeURIComponent(flagId)}/capture`,
    { signal },
  );
  if (!isRecord(body)) throw bad("Flag photo details");
  const id = str(body.flagId);
  const type = str(body.type);
  const capturedAt = str(body.capturedAt);
  const receivedAt = str(body.receivedAt);
  if (!id || !type || !capturedAt || !receivedAt || !isSeverity(body.severity))
    throw bad("Flag photo details");
  const loc = body.location;
  const location =
    isRecord(loc) &&
    typeof loc.latitude === "number" &&
    typeof loc.longitude === "number"
      ? {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: typeof loc.accuracy === "number" ? loc.accuracy : null,
        }
      : null;
  return {
    flagId: id,
    type,
    reason: str(body.reason) ?? type,
    severity: body.severity,
    capturedAt,
    receivedAt,
    evidenceId: str(body.evidenceId),
    locationStatus:
      body.locationStatus === "captured" ? "captured" : "not_shared",
    locationVisible: body.locationVisible === true,
    location,
  };
}
