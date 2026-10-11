import type { LoginEventApi, LoginEventSuccess } from "../api/loginEvents";
import type { EventQueue } from "../queue/eventQueue";
import type { QueuedLoginEvent, ServerLoginEvent } from "../queue/types";
import { syncBackoffMs } from "./backoff";

export type SyncStop = "offline" | "backoff" | "unauthorized" | "done";

export type SyncReport = {
  attempted: number;
  synced: number;
  conflicts: number;
  stopped: SyncStop;
};

function serverFrom(result: LoginEventSuccess): ServerLoginEvent {
  return {
    replayed: result.replayed,
    lateSync: result.lateSync,
    clockSkewFlag: result.clockSkewFlag,
    abEmailQueuedAt: result.abEmailQueuedAt,
    abEmailSentAt: result.abEmailSentAt,
  };
}

/**
 * Sends pending login events in sequence order.
 * A retryable failure stops the pass so a later event cannot overtake an earlier one.
 * CONFLICT_IDEMPOTENT is stored on the event and is not retried. The event stays on the device.
 * A 200 replay (replayed true or false) is success.
 * NCVET:TR s9, s26 — capturedAt is the device time already stored on the event; sync does not rewrite it.
 */
export async function syncQueue(options: {
  queue: EventQueue;
  api: LoginEventApi;
  accessToken: string;
  /** Only events captured by this user are sent. Other users' events stay queued. */
  userId: string;
  online: boolean;
  now: () => number;
}): Promise<SyncReport> {
  const report: SyncReport = { attempted: 0, synced: 0, conflicts: 0, stopped: "done" };
  if (!options.online) {
    report.stopped = "offline";
    return report;
  }

  const events = await options.queue.list();
  const pending = events.filter((event) => event.status === "pending" && event.userId === options.userId);

  for (const event of pending) {
    const now = options.now();
    if (event.nextAttemptAt !== null && event.nextAttemptAt > now) {
      report.stopped = "backoff";
      break;
    }

    report.attempted += 1;
    const result = await options.api.post(event, options.accessToken);
    if (result.kind === "success") {
      const synced: QueuedLoginEvent = {
        ...event,
        status: "synced",
        syncedAt: new Date(now).toISOString(),
        lastError: null,
        nextAttemptAt: null,
        server: serverFrom(result),
      };
      await options.queue.update(synced);
      report.synced += 1;
      continue;
    }

    if (result.kind === "conflict") {
      const conflicted: QueuedLoginEvent = {
        ...event,
        status: "conflict",
        attempts: event.attempts + 1,
        lastError: result.message,
        nextAttemptAt: null,
        conflict: { code: result.code, message: result.message },
      };
      await options.queue.update(conflicted);
      report.conflicts += 1;
      continue;
    }

    if (result.kind === "unauthorized") {
      report.stopped = "unauthorized";
      break;
    }

    const attempts = event.attempts + 1;
    const waiting: QueuedLoginEvent = {
      ...event,
      status: "pending",
      attempts,
      lastError: result.message,
      nextAttemptAt: now + syncBackoffMs(attempts),
    };
    await options.queue.update(waiting);
    report.stopped = "backoff";
    break;
  }

  if (report.synced > 0) {
    await options.queue.setLastSyncAt(new Date(options.now()).toISOString());
  }
  return report;
}
