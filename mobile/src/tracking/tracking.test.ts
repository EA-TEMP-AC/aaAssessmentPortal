import { describe, expect, it } from "@jest/globals";
import { createLiveLoginEventApi, createMockLoginEventApi } from "../api/loginEvents";
import type { CachedBatchData } from "../domain/batch";
import { createEventQueue } from "../queue/eventQueue";
import type { GpsCapture, QueuedItem, QueuedLoginEvent } from "../queue/types";
import { syncBackoffMs } from "../sync/backoff";
import { syncQueue } from "../sync/syncQueue";
import { device, queueWith } from "../testing/fixtures";
import {
  batchIdForAuthEvent,
  describeGps,
  isTrackingRole,
  recordTrackingEvent,
  trackingHistory,
  trackingWindow,
} from "./tracking";

const BATCH_ID = "66f0000000000000000000b1";
/** 2026-11-20 10:30 IST, inside the assessment dates. */
const IN_WINDOW = Date.parse("2026-11-20T05:00:00.000Z");

const cached: CachedBatchData = {
  batch: {
    id: BATCH_ID,
    type: "STT",
    mode: "offline",
    status: "in_progress",
    statusVersion: 3,
    assessmentStartDate: "2026-11-20",
    assessmentEndDate: "2026-11-21",
    assessmentLanguage: "Hindi",
    candidateCount: 2,
    abId: "66f0000000000000000000ab",
  },
  roster: [],
  downloadedAt: "2026-11-19T10:00:00.000Z",
  attendance: {},
  checklist: [],
  assessmentCompleted: false,
};

const fix: GpsCapture = {
  status: "captured",
  lat: 19.076,
  lng: 72.8777,
  capturedAt: "2026-11-20T05:00:01.000Z",
};

const noFix: GpsCapture = { status: "unavailable", reason: "permission_denied" };

function ids(...values: string[]) {
  const left = [...values];
  return () => {
    const next = left.shift();
    if (!next) throw new Error("no more ids");
    return next;
  };
}

function record(
  queue: ReturnType<typeof queueWith>["queue"],
  overrides: Partial<Parameters<typeof recordTrackingEvent>[0]> = {},
) {
  return recordTrackingEvent({
    queue,
    type: "login",
    role: "candidate",
    userId: "user-1",
    cached,
    device,
    capture: async () => fix,
    now: () => IN_WINDOW,
    ...overrides,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("recordTrackingEvent", () => {
  it("queues a student login on /student/login-event, tied to the downloaded batch", async () => {
    const { queue } = queueWith(ids("evt-1"));
    const result = await record(queue);
    expect(result.kind).toBe("queued");
    const [event] = await queue.list();
    expect(event).toMatchObject({
      clientEventId: "evt-1",
      type: "login",
      role: "candidate",
      path: "/student/login-event",
      batchId: BATCH_ID,
      capturedAt: "2026-11-20T05:00:01.000Z",
      gps: fix,
      status: "pending",
    });
  });

  it("queues a proctor login and logout on /proctor/login-event", async () => {
    const { queue } = queueWith(ids("evt-1", "evt-2"));
    await record(queue, { role: "proctor" });
    await record(queue, { role: "proctor", type: "logout" });
    const events = await queue.list();
    expect(events.map((event) => [event.type, event.path, event.batchId])).toEqual([
      ["login", "/proctor/login-event", BATCH_ID],
      ["logout", "/proctor/login-event", BATCH_ID],
    ]);
  });

  it("still queues the event when GPS is unavailable, with the reason and no coordinates", async () => {
    const { queue } = queueWith(ids("evt-1"));
    const result = await record(queue, { capture: async () => noFix });
    expect(result.kind).toBe("queued");
    const [event] = await queue.list();
    expect(event?.gps).toEqual({ status: "unavailable", reason: "permission_denied" });
    // With no fix the device clock at the tap is the capture time.
    expect(event?.capturedAt).toBe("2026-11-20T05:00:00.000Z");
  });

  it("refuses without a downloaded batch, outside the assessment dates, and for other roles", async () => {
    const { queue } = queueWith(ids("evt-1"));
    expect(await record(queue, { cached: null })).toMatchObject({ kind: "refused", reason: "no_batch" });
    expect(await record(queue, { now: () => Date.parse("2026-11-22T05:00:00.000Z") })).toMatchObject({
      kind: "refused",
      reason: "outside_window",
    });
    expect(await record(queue, { role: "assessor" })).toMatchObject({ kind: "refused", reason: "role" });
    expect(await record(queue, { role: "tp" })).toMatchObject({ kind: "refused", reason: "role" });
    expect(await queue.list()).toEqual([]);
  });
});

describe("tracking window", () => {
  it("uses the IST calendar date against the assessment dates", () => {
    // 18:29 UTC on the 19th is 23:59 IST on the 19th; one minute later is the 20th in IST.
    expect(trackingWindow(cached.batch, Date.parse("2026-11-19T18:29:00.000Z"))).toBe("before");
    expect(trackingWindow(cached.batch, Date.parse("2026-11-19T18:30:00.000Z"))).toBe("open");
    expect(trackingWindow(cached.batch, Date.parse("2026-11-21T18:29:59.000Z"))).toBe("open");
    expect(trackingWindow(cached.batch, Date.parse("2026-11-21T18:30:00.000Z"))).toBe("after");
  });

  it("gives sign-in and sign-out events the batch only on the assessment dates", () => {
    expect(batchIdForAuthEvent(cached, IN_WINDOW)).toBe(BATCH_ID);
    expect(batchIdForAuthEvent(cached, Date.parse("2026-11-25T05:00:00.000Z"))).toBeNull();
    expect(batchIdForAuthEvent(null, IN_WINDOW)).toBeNull();
  });

  it("knows which roles track", () => {
    expect(isTrackingRole("candidate")).toBe(true);
    expect(isTrackingRole("proctor")).toBe(true);
    expect(isTrackingRole("assessor")).toBe(false);
    expect(isTrackingRole("aa_admin")).toBe(false);
  });
});

describe("tracking events through the offline queue", () => {
  it("keeps events on the device while offline and sends the contract body later", async () => {
    const { storage, queue } = queueWith(ids("evt-1", "evt-2"));
    await record(queue);
    await record(queue, { type: "logout", capture: async () => noFix });

    const sent: { url: string; body: unknown; auth: string | null }[] = [];
    const api = createLiveLoginEventApi({
      baseUrl: "http://api.test/api/v1",
      fetchImpl: async (url, init) => {
        sent.push({
          url,
          body: JSON.parse(String(init?.body)),
          auth: new Headers(init?.headers).get("authorization"),
        });
        return jsonResponse(200, { replayed: false, lateSync: true, clockSkewFlag: true });
      },
    });
    const run = (online: boolean, now: number) =>
      syncQueue({ queue, api, accessToken: "token-1", userId: "user-1", online, now: () => now });

    expect(await run(false, IN_WINDOW)).toMatchObject({ attempted: 0, stopped: "offline" });
    expect(sent).toEqual([]);
    expect((await queue.snapshot()).pending).toBe(2);

    // A restart: a new queue over the same storage still has both events.
    const reopened = createEventQueue(storage);
    expect((await reopened.list()).map((event) => event.clientEventId)).toEqual(["evt-1", "evt-2"]);

    const later = Date.parse("2026-11-22T10:00:00.000Z");
    expect(await run(true, later)).toMatchObject({ attempted: 2, synced: 2, conflicts: 0, stopped: "done" });
    expect(sent).toEqual([
      {
        url: "http://api.test/api/v1/student/login-event",
        auth: "Bearer token-1",
        body: {
          clientEventId: "evt-1",
          batchId: BATCH_ID,
          type: "login",
          capturedAt: "2026-11-20T05:00:01.000Z",
          locationStatus: "captured",
          lat: 19.076,
          lng: 72.8777,
          device,
        },
      },
      {
        url: "http://api.test/api/v1/student/login-event",
        auth: "Bearer token-1",
        body: {
          clientEventId: "evt-2",
          batchId: BATCH_ID,
          type: "logout",
          capturedAt: "2026-11-20T05:00:00.000Z",
          locationStatus: "unavailable",
          locationUnavailableReason: "permission_denied",
          device,
        },
      },
    ]);
    const events = await queue.list();
    expect(events.every((event) => event.status === "synced")).toBe(true);
    expect(events[0]?.server).toMatchObject({ lateSync: true, clockSkewFlag: true });
    expect((await queue.snapshot()).queueLength).toBe(0);
  });

  it("retries with the same clientEventId after backoff and treats a replay as success", async () => {
    const { queue } = queueWith(ids("evt-1"));
    await record(queue, { role: "proctor" });
    const seen: string[] = [];
    let call = 0;
    const api = createLiveLoginEventApi({
      baseUrl: "http://api.test/api/v1",
      fetchImpl: async (url, init) => {
        seen.push(`${url} ${(JSON.parse(String(init?.body)) as { clientEventId: string }).clientEventId}`);
        call += 1;
        if (call === 1) throw new Error("Network request failed");
        return jsonResponse(200, { replayed: true, lateSync: false, clockSkewFlag: false });
      },
    });
    const run = (now: number) =>
      syncQueue({ queue, api, accessToken: "token-1", userId: "user-1", online: true, now: () => now });

    expect(await run(IN_WINDOW)).toMatchObject({ attempted: 1, synced: 0, stopped: "backoff" });
    const [waiting] = await queue.list();
    expect(waiting).toMatchObject({ status: "pending", attempts: 1, lastError: "Network request failed" });
    expect(waiting?.nextAttemptAt).toBe(IN_WINDOW + syncBackoffMs(1));

    // Still inside the delay: nothing is sent.
    expect(await run(IN_WINDOW + syncBackoffMs(1) - 1)).toMatchObject({ attempted: 0, stopped: "backoff" });
    expect(await run(IN_WINDOW + syncBackoffMs(1))).toMatchObject({ attempted: 1, synced: 1, stopped: "done" });
    expect(seen).toEqual([
      "http://api.test/api/v1/proctor/login-event evt-1",
      "http://api.test/api/v1/proctor/login-event evt-1",
    ]);
    expect((await queue.list())[0]).toMatchObject({ status: "synced", server: { replayed: true } });
  });

  it("keeps a 409 CONFLICT_IDEMPOTENT on the device, shows it, and still syncs later events", async () => {
    const { queue } = queueWith(ids("evt-1", "evt-2"));
    await record(queue, { role: "proctor" });
    await record(queue, { role: "proctor", type: "logout" });
    const api = createLiveLoginEventApi({
      baseUrl: "http://api.test/api/v1",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { clientEventId: string };
        if (body.clientEventId === "evt-1") {
          return jsonResponse(409, {
            error: { code: "CONFLICT_IDEMPOTENT", message: "Same clientEventId with a different payload" },
          });
        }
        return jsonResponse(200, { replayed: false, lateSync: false, clockSkewFlag: false });
      },
    });
    const run = () =>
      syncQueue({ queue, api, accessToken: "token-1", userId: "user-1", online: true, now: () => IN_WINDOW });

    expect(await run()).toMatchObject({ attempted: 2, synced: 1, conflicts: 1, stopped: "done" });
    // The conflict is not retried and is not dropped.
    expect(await run()).toMatchObject({ attempted: 0, synced: 0, conflicts: 0 });

    const snapshot = await queue.snapshot();
    expect(snapshot.queueLength).toBe(1);
    expect(snapshot.conflicts).toEqual([
      { clientEventId: "evt-1", type: "login", message: "Same clientEventId with a different payload" },
    ]);
    const history = trackingHistory(await queue.list<QueuedItem>(), "user-1", BATCH_ID);
    expect(history.map((row) => [row.type, row.state, row.detail])).toEqual([
      ["logout", "synced", "Synced"],
      ["login", "conflict", "Conflict kept on this device: Same clientEventId with a different payload"],
    ]);
  });

  it("is idempotent against the mock API: a changed payload under the same id is a conflict", async () => {
    const { queue } = queueWith(ids("evt-1"));
    await record(queue);
    const api = createMockLoginEventApi({ now: () => IN_WINDOW });
    const [event] = await queue.list();
    if (!event) throw new Error("event was not queued");
    expect(await api.post(event, "t")).toMatchObject({ kind: "success", replayed: false, abEmailQueuedAt: null });
    expect(await api.post(event, "t")).toMatchObject({ kind: "success", replayed: true });
    const changed: QueuedLoginEvent = { ...event, type: "logout" };
    expect(await api.post(changed, "t")).toMatchObject({ kind: "conflict", code: "CONFLICT_IDEMPOTENT" });
  });

  it("does not send one user's tracking events with another user's token", async () => {
    const { queue } = queueWith(ids("evt-1"));
    await record(queue);
    let posts = 0;
    const api = createLiveLoginEventApi({
      baseUrl: "http://api.test/api/v1",
      fetchImpl: async () => {
        posts += 1;
        return jsonResponse(200, {});
      },
    });
    const report = await syncQueue({
      queue,
      api,
      accessToken: "token-2",
      userId: "user-2",
      online: true,
      now: () => IN_WINDOW,
    });
    expect(report.attempted).toBe(0);
    expect(posts).toBe(0);
    expect((await queue.snapshot()).pending).toBe(1);
  });
});

describe("tracking history and location text", () => {
  it("states why a location is unavailable", () => {
    expect(describeGps(fix)).toBe("Location captured (19.07600, 72.87770)");
    expect(describeGps(noFix)).toBe("Location unavailable: location permission was denied");
    expect(describeGps({ status: "unavailable", reason: "timeout", detail: "GPS fix timed out" })).toBe(
      "Location unavailable: the location request timed out (GPS fix timed out)",
    );
  });

  it("lists only this user's login events for this batch, newest first, with the sync state", async () => {
    const { queue } = queueWith(ids("evt-1", "evt-2", "evt-3", "evt-4", "evt-5"));
    await record(queue);
    await record(queue, { type: "logout", capture: async () => noFix });
    await record(queue, { userId: "user-2" });
    await record(queue, { cached: { ...cached, batch: { ...cached.batch, id: "other-batch" } } });
    await queue.enqueue({
      type: "attendance",
      userId: "user-1",
      batchId: BATCH_ID,
      capturedAt: "2026-11-20T05:00:00.000Z",
      records: [{ candidateId: "k1", present: true }],
    });
    const [first, second] = await queue.list();
    if (!first || !second) throw new Error("events were not queued");
    await queue.update({
      ...first,
      status: "synced",
      server: { replayed: false, lateSync: true, clockSkewFlag: true, abEmailQueuedAt: null, abEmailSentAt: null },
    });
    await queue.update({ ...second, attempts: 1, lastError: "network down" });

    const rows = trackingHistory(await queue.list<QueuedItem>(), "user-1", BATCH_ID);
    expect(rows).toEqual([
      {
        clientEventId: "evt-2",
        type: "logout",
        capturedAt: "2026-11-20T05:00:00.000Z",
        location: "Location unavailable: location permission was denied",
        state: "pending",
        detail: "Waiting to retry: network down",
      },
      {
        clientEventId: "evt-1",
        type: "login",
        capturedAt: "2026-11-20T05:00:01.000Z",
        location: "Location captured (19.07600, 72.87770)",
        state: "synced",
        detail: "Synced (late sync, clock skew)",
      },
    ]);
  });
});
