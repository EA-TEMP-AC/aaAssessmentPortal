import type { DeviceInfo } from "../domain/device";
import type { EventQueue } from "../queue/eventQueue";
import { isFieldRole, type GpsCapture, type LoginEventType, type QueuedLoginEvent } from "../queue/types";

/**
 * Stamps capturedAt on the device at login or logout, then stores the event.
 * A GPS failure still enqueues the event with locationStatus unavailable.
 * NCVET:TR s9, s26.
 */
export async function recordAuthGeoEvent(options: {
  queue: EventQueue;
  type: LoginEventType;
  role: string;
  userId: string;
  batchId: string | null;
  device: DeviceInfo;
  capture: () => Promise<GpsCapture>;
  now: () => number;
}): Promise<QueuedLoginEvent | null> {
  if (!isFieldRole(options.role)) return null;
  const startedAt = new Date(options.now()).toISOString();
  const gps = await options.capture();
  const capturedAt = gps.status === "captured" ? gps.capturedAt : startedAt;
  return options.queue.enqueue({
    type: options.type,
    role: options.role,
    userId: options.userId,
    batchId: options.batchId,
    capturedAt,
    gps,
    device: options.device,
  });
}
