import { istCalendarDate } from "../api/loginEvents";
import type { AssignedBatch, CachedBatchData } from "../domain/batch";
import type { DeviceInfo } from "../domain/device";
import { recordAuthGeoEvent } from "../geo/recordAuthGeoEvent";
import type { EventQueue } from "../queue/eventQueue";
import type {
  GpsCapture,
  GpsUnavailableReason,
  LoginEventType,
  QueuedItem,
  QueuedLoginEvent,
} from "../queue/types";

/**
 * Student tracking and proctor geo-tag (M-03). NCVET:TR s9, s26.
 * Both roles post the assessor's login-event shape to their own path
 * (/student/login-event, /proctor/login-event) through the same offline queue.
 */
export type TrackingRole = "proctor" | "candidate";

export function isTrackingRole(role: string): role is TrackingRole {
  return role === "proctor" || role === "candidate";
}

export const TRACKING_TITLES: Record<TrackingRole, string> = {
  proctor: "Proctor geo-tag",
  candidate: "Student tracking",
};

export type TrackingWindow = "before" | "open" | "after";

/**
 * The server accepts a batch login event only when the IST date of capturedAt
 * is inside assessmentStartDate..assessmentEndDate (API_CONTRACT login-event
 * validation). Dates are YYYY-MM-DD, so string order is date order.
 */
export function trackingWindow(
  batch: Pick<AssignedBatch, "assessmentStartDate" | "assessmentEndDate">,
  nowMs: number,
): TrackingWindow {
  const today = istCalendarDate(nowMs);
  if (today < batch.assessmentStartDate) return "before";
  if (today > batch.assessmentEndDate) return "after";
  return "open";
}

/**
 * Batch id for a sign-in or sign-out geo event. Outside the assessment dates
 * the event goes without a batch, which the server stores without batch checks.
 */
export function batchIdForAuthEvent(cached: CachedBatchData | null, nowMs: number): string | null {
  if (!cached?.batch?.id) return null;
  return trackingWindow(cached.batch, nowMs) === "open" ? cached.batch.id : null;
}

export type TrackingRefusal = "role" | "no_batch" | "outside_window";

export type TrackingResult =
  | { kind: "queued"; event: QueuedLoginEvent }
  | { kind: "refused"; reason: TrackingRefusal; message: string };

function refused(reason: TrackingRefusal, message: string): TrackingResult {
  return { kind: "refused", reason, message };
}

/**
 * Queues one geo-tagged login or logout for a student or proctor, tied to the
 * downloaded batch. Nothing is sent here: the queue syncs it later, so this
 * works offline. A missing GPS fix is queued with its reason, never blocked.
 */
export async function recordTrackingEvent(options: {
  queue: EventQueue;
  type: LoginEventType;
  role: string;
  userId: string;
  cached: CachedBatchData | null;
  device: DeviceInfo;
  capture: () => Promise<GpsCapture>;
  now: () => number;
}): Promise<TrackingResult> {
  if (!isTrackingRole(options.role)) {
    return refused("role", "Tracking is for students and proctors.");
  }
  const batch = options.cached?.batch;
  if (!batch?.id) {
    return refused("no_batch", "Download your batch before recording a location.");
  }
  if (trackingWindow(batch, options.now()) !== "open") {
    return refused(
      "outside_window",
      `Location can be recorded only on the assessment dates (${batch.assessmentStartDate} to ${batch.assessmentEndDate}, IST).`,
    );
  }
  const event = await recordAuthGeoEvent({
    queue: options.queue,
    type: options.type,
    role: options.role,
    userId: options.userId,
    batchId: batch.id,
    device: options.device,
    capture: options.capture,
    now: options.now,
  });
  if (!event) return refused("role", "Tracking is for students and proctors.");
  return { kind: "queued", event };
}

const GPS_REASON_TEXT: Record<GpsUnavailableReason, string> = {
  permission_denied: "location permission was denied",
  position_unavailable: "the device could not get a position",
  timeout: "the location request timed out",
  unknown: "the reason is unknown",
};

/** The location line shown to the user. An unavailable fix always states why. */
export function describeGps(gps: GpsCapture): string {
  if (gps.status === "captured") {
    return `Location captured (${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)})`;
  }
  const detail = gps.detail ? ` (${gps.detail})` : "";
  return `Location unavailable: ${GPS_REASON_TEXT[gps.reason] ?? gps.reason}${detail}`;
}

export type TrackingHistoryRow = {
  clientEventId: string;
  type: LoginEventType;
  capturedAt: string;
  location: string;
  state: "pending" | "synced" | "conflict";
  /** Sync state in words, including a kept conflict or the last retry error. */
  detail: string;
};

function syncDetail(event: QueuedLoginEvent): string {
  if (event.status === "conflict") {
    return `Conflict kept on this device: ${event.conflict?.message ?? event.lastError ?? "CONFLICT_IDEMPOTENT"}`;
  }
  if (event.status === "synced") {
    const flags = [];
    if (event.server?.lateSync) flags.push("late sync");
    if (event.server?.clockSkewFlag) flags.push("clock skew");
    return flags.length > 0 ? `Synced (${flags.join(", ")})` : "Synced";
  }
  if (event.lastError) return `Waiting to retry: ${event.lastError}`;
  return "Waiting to sync";
}

/** This user's login and logout events for one batch, newest first. */
export function trackingHistory(items: QueuedItem[], userId: string, batchId: string): TrackingHistoryRow[] {
  return items
    .filter(
      (item): item is QueuedLoginEvent =>
        (item.type === "login" || item.type === "logout") && item.userId === userId && item.batchId === batchId,
    )
    .sort((a, b) => b.sequence - a.sequence)
    .map((event) => ({
      clientEventId: event.clientEventId,
      type: event.type,
      capturedAt: event.capturedAt,
      location: describeGps(event.gps),
      state: event.status,
      detail: syncDetail(event),
    }));
}
