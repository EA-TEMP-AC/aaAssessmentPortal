import type { DeviceInfo } from "../domain/device";

/** NCVET:TR s9, s26 — login and logout are both geo-tagged. */
export type LoginEventType = "login" | "logout";

export type FieldRole = "assessor" | "proctor" | "candidate";

export type LoginEventPath = "/assessor/login-event" | "/proctor/login-event" | "/student/login-event";

export type GpsUnavailableReason = "permission_denied" | "position_unavailable" | "timeout" | "unknown";

/**
 * A captured fix keeps the device coordinates.
 * Unavailable is an explicit result: lat/lng are omitted rather than filled with a placeholder.
 */
export type GpsCapture =
  | { status: "captured"; lat: number; lng: number; capturedAt: string }
  | { status: "unavailable"; reason: GpsUnavailableReason; detail?: string };

export type QueueStatus = "pending" | "synced" | "conflict";

export type ServerLoginEvent = {
  replayed: boolean;
  lateSync: boolean;
  clockSkewFlag: boolean;
  abEmailQueuedAt: string | null;
  abEmailSentAt: string | null;
};

export type QueuedLoginEvent = {
  clientEventId: string;
  sequence: number;
  type: LoginEventType;
  role: FieldRole;
  userId: string;
  path: LoginEventPath;
  batchId: string | null;
  capturedAt: string;
  gps: GpsCapture;
  device: DeviceInfo;
  status: QueueStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  conflict: { code: "CONFLICT_IDEMPOTENT"; message: string } | null;
  syncedAt: string | null;
  server: ServerLoginEvent | null;
};

export type AttendanceRecordInput = {
  candidateId: string;
  present: boolean;
  idVerified?: boolean;
  note?: string;
};

export type QueuedAttendanceEvent = {
  clientEventId: string;
  sequence: number;
  type: "attendance";
  userId: string;
  batchId: string;
  capturedAt: string;
  records: AttendanceRecordInput[];
  status: QueueStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  conflict: { code: "CONFLICT_IDEMPOTENT"; message: string } | null;
  syncedAt: string | null;
  server?: unknown;
};

export type ChecklistItemInput = {
  key: string;
  label?: string;
  available: boolean;
  note?: string;
};

export type QueuedChecklistEvent = {
  clientEventId: string;
  sequence: number;
  type: "checklist";
  userId: string;
  batchId: string;
  capturedAt: string;
  items: ChecklistItemInput[];
  completeAssessment: boolean;
  status: QueueStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  conflict: { code: "CONFLICT_IDEMPOTENT"; message: string } | null;
  syncedAt: string | null;
  server?: unknown;
};

export type QueuedItem = QueuedLoginEvent | QueuedAttendanceEvent | QueuedChecklistEvent;

export type NewLoginEvent = {
  type: LoginEventType;
  role: FieldRole;
  userId: string;
  batchId: string | null;
  capturedAt: string;
  gps: GpsCapture;
  device: DeviceInfo;
};

export type NewAttendanceEvent = {
  type: "attendance";
  userId: string;
  batchId: string;
  capturedAt: string;
  records: AttendanceRecordInput[];
};

export type NewChecklistEvent = {
  type: "checklist";
  userId: string;
  batchId: string;
  capturedAt: string;
  items: ChecklistItemInput[];
  completeAssessment?: boolean;
};

export type AnyNewEvent = NewLoginEvent | NewAttendanceEvent | NewChecklistEvent;

export function loginEventPath(role: string): LoginEventPath | null {
  if (role === "assessor") return "/assessor/login-event";
  if (role === "proctor") return "/proctor/login-event";
  if (role === "candidate") return "/student/login-event";
  return null;
}

export function isFieldRole(role: string): role is FieldRole {
  return loginEventPath(role) !== null;
}
