import type { KeyValueStore } from "../storage/types";
import { isFieldRole, loginEventPath, type NewLoginEvent, type QueuedLoginEvent } from "./types";

const QUEUE_KEY = "aa.loginEventQueue.v1";

type QueueBlob = {
  nextSequence: number;
  lastSyncAt: string | null;
  events: QueuedLoginEvent[];
};

export type QueueConflict = {
  clientEventId: string;
  type: QueuedLoginEvent["type"];
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
  enqueue(input: NewLoginEvent): Promise<QueuedLoginEvent>;
  list(): Promise<QueuedLoginEvent[]>;
  update(event: QueuedLoginEvent): Promise<void>;
  setLastSyncAt(iso: string): Promise<void>;
  snapshot(): Promise<QueueSnapshot>;
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
        throw new Error("Queue store is not a login-event queue");
      }
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.message === "Queue store is not a login-event queue") throw err;
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
    enqueue(input) {
      return exclusive(async () => {
        if (!isFieldRole(input.role)) {
          throw new Error(`Role ${input.role} has no login-event path`);
        }
        if (!input.capturedAt) {
          throw new Error("capturedAt is required");
        }
        if (!input.userId) {
          throw new Error("userId is required");
        }
        const path = loginEventPath(input.role);
        if (!path) throw new Error(`Role ${input.role} has no login-event path`);
        const blob = await read();
        const event: QueuedLoginEvent = {
          clientEventId: createId(),
          sequence: blob.nextSequence,
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
        blob.nextSequence += 1;
        blob.events.push(event);
        await write(blob);
        return JSON.parse(JSON.stringify(event)) as QueuedLoginEvent;
      });
    },

    list() {
      return exclusive(async () => {
        const blob = await read();
        return copyBlob(blob).events.sort((a, b) => a.sequence - b.sequence);
      });
    },

    update(event) {
      return exclusive(async () => {
        const blob = await read();
        const index = blob.events.findIndex((item) => item.clientEventId === event.clientEventId);
        if (index < 0) {
          throw new Error(`Unknown clientEventId ${event.clientEventId}`);
        }
        blob.events[index] = JSON.parse(JSON.stringify(event)) as QueuedLoginEvent;
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
  };
}
