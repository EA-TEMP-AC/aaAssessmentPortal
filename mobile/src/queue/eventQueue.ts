import type { KeyValueStore } from "../storage/types";
import {
  type AnyNewEvent,
  isFieldRole,
  loginEventPath,
  type NewAttendanceEvent,
  type NewChecklistEvent,
  type NewLoginEvent,
  type QueuedAttendanceEvent,
  type QueuedChecklistEvent,
  type QueuedItem,
  type QueuedLoginEvent,
} from "./types";

const QUEUE_KEY = "aa.loginEventQueue.v1";

type QueueBlob = {
  nextSequence: number;
  lastSyncAt: string | null;
  events: QueuedItem[];
};

export type QueueConflict = {
  clientEventId: string;
  type: string;
  message: string;
};

export type QueueSnapshot = {
  /** Events that are not synced. Includes conflicts so a failure stays visible. */
  queueLength: number;
  pending: number;
  lastSyncAt: string | null;
  conflicts: QueueConflict[];
  retryMessage: string | null;
};

export type EventQueue = {
  enqueue<T extends AnyNewEvent>(
    input: T,
  ): Promise<
    T extends NewLoginEvent
      ? QueuedLoginEvent
      : T extends NewAttendanceEvent
        ? QueuedAttendanceEvent
        : T extends NewChecklistEvent
          ? QueuedChecklistEvent
          : QueuedItem
  >;
  list<T extends QueuedItem = QueuedLoginEvent>(): Promise<T[]>;
  update(event: QueuedItem): Promise<void>;
  setLastSyncAt(iso: string): Promise<void>;
  snapshot(): Promise<QueueSnapshot>;
  attachBatchId(batchId: string, userId?: string): Promise<number>;
};

function emptyBlob(): QueueBlob {
  return { nextSequence: 1, lastSyncAt: null, events: [] };
}

function copyBlob(blob: QueueBlob): QueueBlob {
  return JSON.parse(JSON.stringify(blob)) as QueueBlob;
}

export function createEventQueue(
  store: KeyValueStore,
  options?: { createId?: () => string },
): EventQueue {
  const createId = options?.createId ?? (() => crypto.randomUUID());
  let chain: Promise<void> = Promise.resolve();

  async function read(): Promise<QueueBlob> {
    const raw = await store.getItem(QUEUE_KEY);
    if (!raw) return emptyBlob();
    try {
      const parsed = JSON.parse(raw) as QueueBlob;
      if (!parsed || !Array.isArray(parsed.events) || typeof parsed.nextSequence !== "number") {
        throw new Error("Queue store is not a valid queue");
      }
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.message === "Queue store is not a valid queue") throw err;
      throw new Error("Queue store could not be read");
    }
  }

  async function write(blob: QueueBlob): Promise<void> {
    await store.setItem(QUEUE_KEY, JSON.stringify(blob));
  }

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    enqueue: (async (input: AnyNewEvent): Promise<QueuedItem> => {
      return exclusive(async () => {
        if (!input.capturedAt) {
          throw new Error("capturedAt is required");
        }
        if (!input.userId) {
          throw new Error("userId is required");
        }

        const blob = await read();
        const clientEventId = createId();
        const sequence = blob.nextSequence;
        blob.nextSequence += 1;

        let event: QueuedItem;

        if (input.type === "login" || input.type === "logout") {
          if (!isFieldRole(input.role)) {
            throw new Error(`Role ${input.role} has no login-event path`);
          }
          const path = loginEventPath(input.role);
          if (!path) throw new Error(`Role ${input.role} has no login-event path`);

          event = {
            clientEventId,
            sequence,
            type: input.type,
            role: input.role,
            userId: input.userId,
            path,
            batchId: input.batchId,
            capturedAt: input.capturedAt,
            gps: input.gps,
            device: input.device,
            status: "pending",
            attempts: 0,
            nextAttemptAt: null,
            lastError: null,
            conflict: null,
            syncedAt: null,
            server: null,
          };
        } else if (input.type === "attendance") {
          if (!input.batchId) {
            throw new Error("batchId is required for attendance");
          }
          if (!input.records || input.records.length === 0) {
            throw new Error("records must not be empty for attendance");
          }
          event = {
            clientEventId,
            sequence,
            type: "attendance",
            userId: input.userId,
            batchId: input.batchId,
            capturedAt: input.capturedAt,
            records: input.records,
            status: "pending",
            attempts: 0,
            nextAttemptAt: null,
            lastError: null,
            conflict: null,
            syncedAt: null,
          };
        } else if (input.type === "checklist") {
          if (!input.batchId) {
            throw new Error("batchId is required for checklist");
          }
          if (!input.items || input.items.length === 0) {
            throw new Error("items must not be empty for checklist");
          }
          event = {
            clientEventId,
            sequence,
            type: "checklist",
            userId: input.userId,
            batchId: input.batchId,
            capturedAt: input.capturedAt,
            items: input.items,
            completeAssessment: input.completeAssessment ?? false,
            status: "pending",
            attempts: 0,
            nextAttemptAt: null,
            lastError: null,
            conflict: null,
            syncedAt: null,
          };
        } else {
          throw new Error(`Unknown event type: ${(input as { type: string }).type}`);
        }

        blob.events.push(event);
        await write(blob);
        return JSON.parse(JSON.stringify(event)) as QueuedItem;
      });
    }) as EventQueue["enqueue"],

    list<T extends QueuedItem = QueuedLoginEvent>() {
      return exclusive(async () => {
        const blob = await read();
        return copyBlob(blob).events.sort((a, b) => a.sequence - b.sequence) as unknown as T[];
      });
    },

    update(event) {
      return exclusive(async () => {
        const blob = await read();
        const index = blob.events.findIndex((item) => item.clientEventId === event.clientEventId);
        if (index < 0) {
          throw new Error(`Unknown clientEventId ${event.clientEventId}`);
        }
        blob.events[index] = JSON.parse(JSON.stringify(event)) as QueuedItem;
        await write(blob);
      });
    },

    setLastSyncAt(iso) {
      return exclusive(async () => {
        const blob = await read();
        blob.lastSyncAt = iso;
        await write(blob);
      });
    },

    snapshot() {
      return exclusive(async () => {
        const blob = await read();
        const events = [...blob.events].sort((a, b) => a.sequence - b.sequence);
        const unsynced = events.filter((event) => event.status !== "synced");
        const pending = unsynced.filter((event) => event.status === "pending");
        const head = pending[0];
        return {
          queueLength: unsynced.length,
          pending: pending.length,
          lastSyncAt: blob.lastSyncAt,
          conflicts: events
            .filter((event) => event.status === "conflict" && event.conflict)
            .map((event) => ({
              clientEventId: event.clientEventId,
              type: event.type,
              message: event.conflict?.message ?? "Conflict",
            })),
          retryMessage: head?.lastError ?? null,
        };
      });
    },

    attachBatchId(batchId, userId) {
      return exclusive(async () => {
        const blob = await read();
        let updated = 0;
        for (const item of blob.events) {
          if (item.status === "pending" && !item.batchId && (!userId || item.userId === userId)) {
            item.batchId = batchId;
            updated += 1;
          }
        }
        if (updated > 0) {
          await write(blob);
        }
        return updated;
      });
    },
  };
}
