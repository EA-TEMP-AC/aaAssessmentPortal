import { describe, expect, it, jest } from "@jest/globals";
import { createLiveBatchApi, type BatchFieldApi } from "../api/batchApi";
import { isPermanentRejection } from "../api/http";
import { createLiveLoginEventApi, type LoginEventApi, type LoginEventPostResult } from "../api/loginEvents";
import { createEventQueue } from "../queue/eventQueue";
import type { QueuedItem } from "../queue/types";
import { newEvent, queueWith } from "../testing/fixtures";
import { trackingHistory } from "../tracking/tracking";
import { syncBackoffMs } from "./backoff";
import { syncQueue } from "./syncQueue";

const NOW = 1_800_000_000_000;

const success: LoginEventPostResult = {
  kind: "success",
  replayed: false,
  lateSync: false,
  clockSkewFlag: false,
  abEmailQueuedAt: null,
  abEmailSentAt: null,
};

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      replayed: false,
      lateSync: false,
      clockSkewFlag: false,
      abEmailQueuedAt: null,
      abEmailSentAt: null,
    }),
    { status: 200 },
  );
}

type FetchMock = jest.Mock<(url: string, init?: RequestInit) => Promise<Response>>;

/** A live login-event API over a scripted fetch, so the HTTP status is what gets classified. */
function liveApi(responses: Array<Response | Error>): { api: LoginEventApi; fetchImpl: FetchMock } {
  const fetchImpl: FetchMock = jest.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchImpl.mockRejectedValueOnce(response);
    else fetchImpl.mockResolvedValueOnce(response);
  }
  return { api: createLiveLoginEventApi({ baseUrl: "http://127.0.0.1:3000/api/v1", fetchImpl }), fetchImpl };
}

function ids(...values: string[]) {
  const left = [...values];
  return () => {
    const next = left.shift();
    if (!next) throw new Error("no id left");
    return next;
  };
}

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

function run(queue: ReturnType<typeof queueWith>["queue"], api: LoginEventApi, batchApi?: BatchFieldApi, now = NOW) {
  return syncQueue({ queue, api, batchApi, accessToken: "access", userId: "user-1", online: true, now: () => now });
}

describe("permanent rejection classes", () => {
  it("treats only 400, 403, 404, and 409 INVALID_TRANSITION as permanent", () => {
    expect(isPermanentRejection(400, "VALIDATION_ERROR")).toBe(true);
    expect(isPermanentRejection(403, "FORBIDDEN")).toBe(true);
    expect(isPermanentRejection(404, "NOT_FOUND")).toBe(true);
    expect(isPermanentRejection(409, "INVALID_TRANSITION")).toBe(true);

    expect(isPermanentRejection(409, "CONFLICT_IDEMPOTENT")).toBe(false);
    expect(isPermanentRejection(409, "DUPLICATE_RESOURCE")).toBe(false);
    expect(isPermanentRejection(401, "UNAUTHORIZED")).toBe(false);
    expect(isPermanentRejection(429, "RATE_LIMITED")).toBe(false);
    expect(isPermanentRejection(500, "INTERNAL")).toBe(false);
    expect(isPermanentRejection(503, "UNKNOWN")).toBe(false);
  });

  it.each([
    [400, "VALIDATION_ERROR", "capturedAt is outside the assessment window"],
    [403, "FORBIDDEN", "Role or row scope denied"],
    [404, "NOT_FOUND", "Unknown id"],
    [409, "INVALID_TRANSITION", "Illegal status change"],
  ])("parks an event on %i %s and sends the next one", async (status, code, message) => {
    const { queue } = queueWith(ids(FIRST, SECOND));
    await queue.enqueue(newEvent({ batchId: "batch-1" }));
    await queue.enqueue(newEvent({ type: "logout", capturedAt: "2026-10-10T09:00:00.000Z" }));
    const { api, fetchImpl } = liveApi([errorResponse(status, code, message), okResponse()]);

    const report = await run(queue, api);

    expect(report).toEqual({ attempted: 2, synced: 1, conflicts: 0, parked: 1, stopped: "done" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = await queue.list();
    expect(first).toMatchObject({
      clientEventId: FIRST,
      status: "parked",
      attempts: 1,
      nextAttemptAt: null,
      lastError: `${code}: ${message}`,
      parked: { status, code, message, at: new Date(NOW).toISOString() },
      // The captured event itself is untouched.
      capturedAt: "2026-10-10T08:00:00.000Z",
      batchId: "batch-1",
      syncedAt: null,
    });
    expect(second).toMatchObject({ clientEventId: SECOND, status: "synced" });

    const snapshot = await queue.snapshot();
    expect(snapshot.parked).toEqual([
      { clientEventId: FIRST, type: "login", capturedAt: "2026-10-10T08:00:00.000Z", code, message },
    ]);
    expect(snapshot.pending).toBe(0);
    // Still counted, so the Session tab badge keeps pointing at it.
    expect(snapshot.queueLength).toBe(1);
    expect(snapshot.retryMessage).toBeNull();
    expect(snapshot.lastSyncAt).toBe(new Date(NOW).toISOString());
  });

  it.each([
    ["a network error", new Error("Network request failed"), "Network request failed"],
    ["500", errorResponse(500, "INTERNAL", "Internal server error"), "INTERNAL: Internal server error"],
    ["503 with no body", new Response("", { status: 503 }), "UNKNOWN: Login event failed (503)"],
    ["429", errorResponse(429, "RATE_LIMITED", "Too many requests"), "RATE_LIMITED: Too many requests"],
    ["another 409", errorResponse(409, "DUPLICATE_RESOURCE", "Unique constraint"), "DUPLICATE_RESOURCE: Unique constraint"],
  ])("keeps retrying after %s and holds back later events", async (_label, response, lastError) => {
    const { queue } = queueWith(ids(FIRST, SECOND));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    const { api, fetchImpl } = liveApi([response]);

    const report = await run(queue, api);

    expect(report).toEqual({ attempted: 1, synced: 0, conflicts: 0, parked: 0, stopped: "backoff" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [first, second] = await queue.list();
    expect(first).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError,
      nextAttemptAt: NOW + syncBackoffMs(1),
    });
    expect(first?.parked ?? null).toBeNull();
    expect(second).toMatchObject({ status: "pending", attempts: 0 });
    expect((await queue.snapshot()).parked).toEqual([]);
  });

  it("stops on 401 for a new sign-in and leaves the event pending and untouched", async () => {
    const { queue } = queueWith(ids(FIRST, SECOND));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    const { api, fetchImpl } = liveApi([errorResponse(401, "UNAUTHORIZED", "Missing or invalid access token")]);

    const report = await run(queue, api);

    expect(report).toEqual({ attempted: 1, synced: 0, conflicts: 0, parked: 0, stopped: "unauthorized" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const events = await queue.list();
    expect(events.map((event) => [event.status, event.attempts, event.nextAttemptAt, event.lastError])).toEqual([
      ["pending", 0, null, null],
      ["pending", 0, null, null],
    ]);
  });

  it("keeps 409 CONFLICT_IDEMPOTENT as a conflict, not a parked event", async () => {
    const { queue } = queueWith(ids(FIRST, SECOND));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    const { api } = liveApi([errorResponse(409, "CONFLICT_IDEMPOTENT", "payload mismatch"), okResponse()]);

    const report = await run(queue, api);

    expect(report).toEqual({ attempted: 2, synced: 1, conflicts: 1, parked: 0, stopped: "done" });
    const [first] = await queue.list();
    expect(first).toMatchObject({
      status: "conflict",
      conflict: { code: "CONFLICT_IDEMPOTENT", message: "payload mismatch" },
    });
    const snapshot = await queue.snapshot();
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.parked).toEqual([]);
  });
});

describe("the queue after a parked event", () => {
  it("never sends a parked event again and keeps syncing what comes later", async () => {
    const { queue } = queueWith(ids(FIRST, SECOND, THIRD));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    const posted: string[] = [];
    const results: LoginEventPostResult[] = [
      { kind: "rejected", status: 403, code: "FORBIDDEN", message: "Role or row scope denied" },
      success,
      success,
    ];
    const api: LoginEventApi = {
      async post(event) {
        posted.push(event.clientEventId);
        const next = results.shift();
        if (!next) throw new Error("unexpected login-event post");
        return next;
      },
    };

    expect(await run(queue, api)).toMatchObject({ attempted: 2, synced: 1, parked: 1, stopped: "done" });

    // A later pass, with a new event behind the parked one.
    await queue.enqueue(newEvent({ capturedAt: "2026-10-11T08:00:00.000Z" }));
    expect(await run(queue, api, undefined, NOW + 120_000)).toEqual({
      attempted: 1,
      synced: 1,
      conflicts: 0,
      parked: 0,
      stopped: "done",
    });

    expect(posted).toEqual([FIRST, SECOND, THIRD]);
    expect((await queue.list()).map((event) => event.status)).toEqual(["parked", "synced", "synced"]);
  });

  it("parks two rejected events in a row and still reaches the third", async () => {
    const { queue } = queueWith(ids(FIRST, SECOND, THIRD));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    await queue.enqueue(newEvent());
    const { api } = liveApi([
      errorResponse(400, "VALIDATION_ERROR", "capturedAt is outside the assessment window"),
      errorResponse(409, "INVALID_TRANSITION", "Illegal status change"),
      okResponse(),
    ]);

    expect(await run(queue, api)).toEqual({ attempted: 3, synced: 1, conflicts: 0, parked: 2, stopped: "done" });
    const snapshot = await queue.snapshot();
    expect(snapshot.parked.map((item) => item.code)).toEqual(["VALIDATION_ERROR", "INVALID_TRANSITION"]);
  });

  it("parks rejected attendance and checklist writes and sends the login event behind them", async () => {
    const { queue } = queueWith(ids(FIRST, SECOND, THIRD));
    await queue.enqueue({
      type: "attendance",
      userId: "user-1",
      batchId: "batch-1",
      capturedAt: "2026-11-20T05:00:00.000Z",
      records: [{ candidateId: "cand-1", present: true }],
    });
    await queue.enqueue({
      type: "checklist",
      userId: "user-1",
      batchId: "batch-1",
      capturedAt: "2026-11-20T06:00:00.000Z",
      items: [{ key: "multimeter", available: true }],
      completeAssessment: true,
    });
    await queue.enqueue(newEvent({ type: "logout" }));

    const fetchImpl: FetchMock = jest.fn();
    fetchImpl
      .mockResolvedValueOnce(errorResponse(403, "FORBIDDEN", "Role or row scope denied"))
      .mockResolvedValueOnce(errorResponse(409, "INVALID_TRANSITION", "Illegal status change"));
    const batchApi = createLiveBatchApi({ baseUrl: "http://127.0.0.1:3000/api/v1", fetchImpl });
    const loginApi: LoginEventApi = { post: async () => success };

    const report = await run(queue, loginApi, batchApi);

    expect(report).toEqual({ attempted: 3, synced: 1, conflicts: 0, parked: 2, stopped: "done" });
    const events = await queue.list<QueuedItem>();
    expect(events.map((event) => [event.type, event.status, event.parked?.code ?? null])).toEqual([
      ["attendance", "parked", "FORBIDDEN"],
      ["checklist", "parked", "INVALID_TRANSITION"],
      ["logout", "synced", null],
    ]);
    // The attendance rows are still on the device.
    expect(events[0]).toMatchObject({ records: [{ candidateId: "cand-1", present: true }] });
  });

  it("shows a parked tracking event with the server's reason", async () => {
    const { queue } = queueWith(ids(FIRST));
    await queue.enqueue(newEvent({ batchId: "batch-1" }));
    const { api } = liveApi([errorResponse(403, "FORBIDDEN", "Role or row scope denied")]);
    await run(queue, api);

    const [row] = trackingHistory(await queue.list<QueuedItem>(), "user-1", "batch-1");
    expect(row).toMatchObject({
      state: "parked",
      detail: "Rejected by the server, not sent again: FORBIDDEN: Role or row scope denied",
    });
  });
});

describe("deleting a parked event", () => {
  it("removes it from the device and from the snapshot, and survives a reload of the store", async () => {
    const { storage, queue } = queueWith(ids(FIRST, SECOND));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    const { api } = liveApi([errorResponse(404, "NOT_FOUND", "Unknown id"), new Error("Network request failed")]);
    await run(queue, api);
    expect((await queue.snapshot()).parked).toHaveLength(1);

    await queue.removeParked(FIRST);

    const sameStore = createEventQueue(storage);
    expect((await sameStore.list()).map((event) => event.clientEventId)).toEqual([SECOND]);
    const snapshot = await sameStore.snapshot();
    expect(snapshot.parked).toEqual([]);
    expect(snapshot.queueLength).toBe(1);
  });

  it("refuses to delete an event that is pending, synced, in conflict, or unknown", async () => {
    const { queue } = queueWith(ids(FIRST, SECOND, THIRD));
    await queue.enqueue(newEvent());
    await queue.enqueue(newEvent({ type: "logout" }));
    await queue.enqueue(newEvent());
    const { api } = liveApi([
      okResponse(),
      errorResponse(409, "CONFLICT_IDEMPOTENT", "payload mismatch"),
      new Error("Network request failed"),
    ]);
    await run(queue, api);
    expect((await queue.list()).map((event) => event.status)).toEqual(["synced", "conflict", "pending"]);

    for (const id of [FIRST, SECOND, THIRD]) {
      await expect(queue.removeParked(id)).rejects.toThrow("Only a parked event can be deleted");
    }
    await expect(queue.removeParked("missing")).rejects.toThrow("Unknown clientEventId missing");
    expect(await queue.list()).toHaveLength(3);
  });
});
