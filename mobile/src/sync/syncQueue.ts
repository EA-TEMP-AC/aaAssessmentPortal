import type { BatchFieldApi } from "../api/batchApi";
import type { RejectedResult } from "../api/http";
import type { LoginEventApi, LoginEventSuccess } from "../api/loginEvents";
import type { EventQueue } from "../queue/eventQueue";
import type { QueuedItem, ServerLoginEvent } from "../queue/types";
import { syncBackoffMs } from "./backoff";

export type SyncStop = "offline" | "backoff" | "unauthorized" | "done";

export type SyncReport = {
  attempted: number;
  synced: number;
  conflicts: number;
  /** Events the server refused for good on this pass. */
  parked: number;
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

/** The event as parked: kept on the device with the server's reason, never sent again. */
function parkedFrom<T extends QueuedItem>(event: T, result: RejectedResult, now: number): T {
  return {
    ...event,
    status: "parked",
    attempts: event.attempts + 1,
    lastError: `${result.code}: ${result.message}`,
    nextAttemptAt: null,
    parked: {
      status: result.status,
      code: result.code,
      message: result.message,
      at: new Date(now).toISOString(),
    },
  };
}

/**
 * Sends pending field events (login, attendance, checklist) in sequence order.
 * A retryable failure stops the pass so a later event cannot overtake an earlier one.
 * CONFLICT_IDEMPOTENT is stored on the event and is not retried. The event stays on the device.
 * A permanent rejection (400, 403, 404, 409 INVALID_TRANSITION) parks the event with the server's
 * code and message, and the pass carries on with the next event (open question 136).
 * A 200 replay (replayed true or false) is success.
 * NCVET:TR s9, s26 — capturedAt is the device time already stored on the event; sync does not rewrite it.
 */
export async function syncQueue(options: {
  queue: EventQueue;
  api: LoginEventApi;
  batchApi?: BatchFieldApi;
  accessToken: string;
  /** Only events captured by this user are sent. Other users' events stay queued. */
  userId: string;
  online: boolean;
  now: () => number;
}): Promise<SyncReport> {
  const report: SyncReport = { attempted: 0, synced: 0, conflicts: 0, parked: 0, stopped: "done" };
  if (!options.online) {
    report.stopped = "offline";
    return report;
  }

  const events = await options.queue.list<QueuedItem>();
  const pending = events.filter((event) => event.status === "pending" && event.userId === options.userId);

  for (const event of pending) {
    const now = options.now();
    if (event.nextAttemptAt !== null && event.nextAttemptAt > now) {
      report.stopped = "backoff";
      break;
    }

    report.attempted += 1;

    if (event.type === "login" || event.type === "logout") {
      const result = await options.api.post(event, options.accessToken);
      if (result.kind === "success") {
        const synced: QueuedItem = {
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
        const conflicted: QueuedItem = {
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

      if (result.kind === "rejected") {
        await options.queue.update(parkedFrom(event, result, now));
        report.parked += 1;
        continue;
      }

      if (result.kind === "unauthorized") {
        report.stopped = "unauthorized";
        break;
      }

      const attempts = event.attempts + 1;
      const waiting: QueuedItem = {
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

    if (event.type === "attendance") {
      if (!options.batchApi) {
        // Cannot sync attendance without batchApi
        break;
      }
      const result = await options.batchApi.postAttendance(
        event.batchId,
        { capturedAt: event.capturedAt, records: event.records },
        options.accessToken,
      );

      if (result.kind === "success") {
        const synced: QueuedItem = {
          ...event,
          status: "synced",
          syncedAt: new Date(now).toISOString(),
          lastError: null,
          nextAttemptAt: null,
          server: result.items,
        };
        await options.queue.update(synced);
        report.synced += 1;
        continue;
      }

      if (result.kind === "conflict") {
        const conflicted: QueuedItem = {
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

      if (result.kind === "rejected") {
        await options.queue.update(parkedFrom(event, result, now));
        report.parked += 1;
        continue;
      }

      if (result.kind === "unauthorized") {
        report.stopped = "unauthorized";
        break;
      }

      const attempts = event.attempts + 1;
      const waiting: QueuedItem = {
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

    if (event.type === "checklist") {
      if (!options.batchApi) {
        break;
      }
      const result = await options.batchApi.postChecklist(
        event.batchId,
        {
          clientEventId: event.clientEventId,
          capturedAt: event.capturedAt,
          items: event.items,
          completeAssessment: event.completeAssessment,
        },
        options.accessToken,
      );

      if (result.kind === "success") {
        const synced: QueuedItem = {
          ...event,
          status: "synced",
          syncedAt: new Date(now).toISOString(),
          lastError: null,
          nextAttemptAt: null,
          server: result.checklist,
        };
        await options.queue.update(synced);
        report.synced += 1;
        continue;
      }

      if (result.kind === "conflict") {
        const conflicted: QueuedItem = {
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

      if (result.kind === "rejected") {
        await options.queue.update(parkedFrom(event, result, now));
        report.parked += 1;
        continue;
      }

      if (result.kind === "unauthorized") {
        report.stopped = "unauthorized";
        break;
      }

      const attempts = event.attempts + 1;
      const waiting: QueuedItem = {
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
  }

  if (report.synced > 0) {
    await options.queue.setLastSyncAt(new Date(options.now()).toISOString());
  }
  return report;
}
