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

export type NewLoginEvent = {
  type: LoginEventType;
  role: FieldRole;
  userId: string;
  batchId: string | null;
  capturedAt: string;
  gps: GpsCapture;
  device: DeviceInfo;
};

export function loginEventPath(role: string): LoginEventPath | null {
  if (role === "assessor") return "/assessor/login-event";
  if (role === "proctor") return "/proctor/login-event";
  if (role === "candidate") return "/student/login-event";
  return null;
}

export function isFieldRole(role: string): role is FieldRole {
  return loginEventPath(role) !== null;
}
