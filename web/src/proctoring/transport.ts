import { apiRequest, ApiError } from "../api/client";
import { PROCTOR_THRESHOLDS } from "./config";
import type { FlagBody, ProctorTransport, SnapshotUpload } from "./types";

/**
 * Server calls for the engine. Flags are retried from a small in-memory queue (never browser
 * storage); the server is idempotent on `clientEventId`, so a resend is safe. Snapshots are
 * sent once and not queued, to keep image bytes out of memory.
 */

type Request = typeof apiRequest;

export type TransportOptions = {
  request?: Request;
  retryDelayMs?: number;
  maxQueue?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Upload path for snapshots. Open question 660: the brief said POST /evidence. */
export function snapshotPath(batchId: string): string {
  return `/batches/${encodeURIComponent(batchId)}/evidence`;
}

export function flagPath(sessionId: string): string {
  return `/proctoring/sessions/${encodeURIComponent(sessionId)}/flags`;
}

/** Network errors, timeouts, rate limits and server errors may pass on a resend; other 4xx will not. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

type Queued = { sessionId: string; body: FlagBody };

export type ApiTransport = ProctorTransport & {
  /** Flags waiting for a resend. */
  pending(): number;
  /** Try every queued flag now. */
  flush(): Promise<void>;
};

export function createTransport(options: TransportOptions = {}): ApiTransport {
  const request = options.request ?? apiRequest;
  const retryDelayMs = options.retryDelayMs ?? PROCTOR_THRESHOLDS.retryDelayMs;
  const maxQueue = options.maxQueue ?? PROCTOR_THRESHOLDS.maxQueuedFlags;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let queue: Queued[] = [];
  let timer: unknown = null;
  let flushing = false;
  let disposed = false;

  async function post(item: Queued): Promise<void> {
    await request<unknown>(flagPath(item.sessionId), { method: "POST", body: item.body });
  }

  function enqueue(item: Queued) {
    if (queue.some((q) => q.body.clientEventId === item.body.clientEventId)) return;
    queue.push(item);
    // Keep the newest; the oldest is dropped when the queue is full.
    if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
    schedule();
  }

  function schedule() {
    if (disposed || timer !== null || queue.length === 0) return;
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, retryDelayMs);
  }

  async function flush(): Promise<void> {
    if (flushing || disposed) return;
    flushing = true;
    try {
      const batch = queue;
      queue = [];
      for (const item of batch) {
        try {
          await post(item);
        } catch (error) {
          if (isRetryable(error)) queue.push(item);
        }
      }
      if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
    } finally {
      flushing = false;
      schedule();
    }
  }

  return {
    async sendFlag(sessionId, body) {
      if (disposed) return;
      const item = { sessionId, body };
      try {
        await post(item);
      } catch (error) {
        if (isRetryable(error)) enqueue(item);
      }
    },

    async uploadSnapshot(input: SnapshotUpload) {
      if (disposed) return null;
      const form = new FormData();
      form.append("clientEventId", input.clientEventId);
      form.append("kind", input.kind ?? "proctor_snapshot");
      form.append("capturedAt", input.capturedAt);
      form.append("sessionId", input.sessionId);
      form.append("file", input.blob, "snapshot.jpg");
      try {
        const body = await request<unknown>(snapshotPath(input.batchId), { method: "POST", body: form });
        const id = typeof body === "object" && body !== null ? (body as { id?: unknown }).id : null;
        return typeof id === "string" && id.length > 0 ? id : null;
      } catch {
        return null;
      }
    },

    pending: () => queue.length,
    flush,

    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      queue = [];
    },
  };
}
