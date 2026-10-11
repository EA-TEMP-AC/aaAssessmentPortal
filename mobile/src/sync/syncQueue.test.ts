import { describe, expect, it } from "@jest/globals";
import { createMockLoginEventApi, type LoginEventPostResult } from "../api/loginEvents";
import { createEventQueue } from "../queue/eventQueue";
import type { LoginEventApi } from "../api/loginEvents";
import { newEvent, queueWith } from "../testing/fixtures";
import { syncBackoffMs } from "./backoff";
import { syncQueue } from "./syncQueue";

const success = (replayed = false): LoginEventPostResult => ({
  kind: "success",
  replayed,
  lateSync: false,
  clockSkewFlag: false,
  abEmailQueuedAt: null,
  abEmailSentAt: null,
});

function scripted(results: LoginEventPostResult[]) {
  const calls: { clientEventId: string; type: string }[] = [];
  const api: LoginEventApi = {
    async post(event) {
      calls.push({ clientEventId: event.clientEventId, type: event.type });
      const next = results.shift();
      if (!next) throw new Error("unexpected login-event post");
      return next;
    },
  };
  return { api, calls };
}

function clock(start: number) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("sync backoff", () => {
  it("doubles the delay and then caps it", () => {
    expect(syncBackoffMs(1)).toBe(1_000);
    expect(syncBackoffMs(2)).toBe(2_000);
    expect(syncBackoffMs(3)).toBe(4_000);
    expect(syncBackoffMs(20)).toBe(60_000);
  });

  it("retries the same clientEventId after backoff and does not drop the event", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const { storage, queue } = queueWith(() => id);
    await queue.enqueue(newEvent());
    const time = clock(1_000_000);
    const { api, calls } = scripted([
      { kind: "retryable", message: "network down" },
      { kind: "retryable", message: "network down" },
      success(),
    ]);

    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: time.now,
    });
    expect(calls.map((call) => call.clientEventId)).toEqual([id]);
    let [event] = await queue.list();
    expect(event?.status).toBe("pending");
    expect(event?.attempts).toBe(1);
    expect(event?.nextAttemptAt).toBe(1_000_000 + 1_000);
    expect(event?.capturedAt).toBe("2026-10-10T08:00:00.000Z");

    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: time.now,
    });
    expect(calls).toHaveLength(1);

    time.advance(1_000);
    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: time.now,
    });
    [event] = await queue.list();
    expect(event?.attempts).toBe(2);
    expect(event?.nextAttemptAt).toBe(time.now() + 2_000);
    expect(calls).toHaveLength(2);

    time.advance(2_000);
    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: time.now,
    });
    [event] = await createEventQueue(storage).list();
    expect(event?.status).toBe("synced");
    expect(calls.map((call) => call.clientEventId)).toEqual([id, id, id]);
  });
});

describe("ordered sync", () => {
  it("posts pending events in enqueue order", async () => {
    const { queue } = queueWith();
    await queue.enqueue(newEvent({ type: "login", capturedAt: "2026-10-10T08:00:00.000Z" }));
    await queue.enqueue(newEvent({ type: "logout", capturedAt: "2026-10-10T12:00:00.000Z" }));
    await queue.enqueue(newEvent({ type: "login", capturedAt: "2026-10-10T12:05:00.000Z" }));
    const { api, calls } = scripted([success(), success(), success()]);

    const report = await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => Date.parse("2026-10-10T12:10:00.000Z"),
    });

    expect(report.stopped).toBe("done");
    expect(calls.map((call) => call.type)).toEqual(["login", "logout", "login"]);
    expect((await queue.snapshot()).queueLength).toBe(0);
  });

  it("does not send a later event while an earlier one is waiting to retry", async () => {
    const { queue } = queueWith();
    await queue.enqueue(newEvent({ type: "login" }));
    await queue.enqueue(newEvent({ type: "logout" }));
    const { api, calls } = scripted([{ kind: "retryable", message: "timeout" }, success()]);

    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("login");
    const events = await queue.list();
    expect(events[1]?.status).toBe("pending");
    expect(events[1]?.attempts).toBe(0);
  });
});

describe("conflict handling", () => {
  it("surfaces CONFLICT_IDEMPOTENT and does not retry that event", async () => {
    const { queue } = queueWith();
    await queue.enqueue(newEvent({ type: "login" }));
    await queue.enqueue(newEvent({ type: "logout" }));
    await queue.enqueue(newEvent({ type: "login" }));
    const { api, calls } = scripted([
      success(),
      { kind: "conflict", code: "CONFLICT_IDEMPOTENT", message: "Same clientEventId with a different payload" },
      success(),
    ]);

    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => 5_000,
    });
    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => 6_000,
    });

    expect(calls).toHaveLength(3);
    const events = await queue.list();
    expect(events.map((event) => event.status)).toEqual(["synced", "conflict", "synced"]);
    expect(events[1]?.attempts).toBe(1);
    expect(events[1]?.conflict?.code).toBe("CONFLICT_IDEMPOTENT");
    const snapshot = await queue.snapshot();
    expect(snapshot.queueLength).toBe(1);
    expect(snapshot.conflicts).toHaveLength(1);
    expect(snapshot.conflicts[0]?.message).toBe("Same clientEventId with a different payload");
  });

  it("treats a duplicate replay as success", async () => {
    const { queue } = queueWith(() => "22222222-2222-4222-8222-222222222222");
    const event = await queue.enqueue(newEvent({ capturedAt: "2026-10-10T18:00:00.000Z" }));
    const mock = createMockLoginEventApi({ now: () => Date.parse("2026-10-11T02:00:00.000Z") });
    await mock.post(event, "access");
    let posts = 0;
    const api: LoginEventApi = {
      async post(item, token) {
        posts += 1;
        return mock.post(item, token);
      },
    };

    const report = await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => Date.parse("2026-10-11T02:00:00.000Z"),
    });
    await syncQueue({
      queue,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => Date.parse("2026-10-11T02:01:00.000Z"),
    });

    expect(report.synced).toBe(1);
    expect(posts).toBe(1);
    const [stored] = await queue.list();
    expect(stored?.status).toBe("synced");
    expect(stored?.server?.replayed).toBe(true);
    expect(stored?.capturedAt).toBe("2026-10-10T18:00:00.000Z");
  });
});

describe("per-user sync", () => {
  it("leaves another user's events queued and still sends this user's later event", async () => {
    const { queue } = queueWith();
    await queue.enqueue(newEvent({ userId: "user-a", type: "login" }));
    await queue.enqueue(newEvent({ userId: "user-b", type: "logout" }));
    const { api, calls } = scripted([success()]);

    await syncQueue({
      queue,
      api,
      accessToken: "access-b",
      userId: "user-b",
      online: true,
      now: () => 0,
    });

    expect(calls.map((call) => call.type)).toEqual(["logout"]);
    const events = await queue.list();
    expect(events[0]?.status).toBe("pending");
    expect(events[0]?.userId).toBe("user-a");
    expect(events[1]?.status).toBe("synced");
  });
});

describe("airplane mode", () => {
  it("grows the queue while offline and syncs in order after reconnect", async () => {
    const { storage, queue } = queueWith();
    const { api, calls } = scripted([success(), success(), success()]);
    const sync = (online: boolean) =>
      syncQueue({
        queue,
        api,
        accessToken: "access",
        userId: "user-1",
        online,
        now: () => Date.parse("2026-10-10T09:00:00.000Z"),
      });

    await queue.enqueue(newEvent({ type: "login", capturedAt: "2026-10-10T08:00:00.000Z" }));
    expect((await queue.snapshot()).queueLength).toBe(1);
    await queue.enqueue(newEvent({ type: "logout", capturedAt: "2026-10-10T08:30:00.000Z" }));
    expect((await queue.snapshot()).queueLength).toBe(2);

    const blocked = await sync(false);
    expect(blocked.stopped).toBe("offline");
    expect(calls).toHaveLength(0);

    const restored = createEventQueue(storage);
    await restored.enqueue(newEvent({ type: "login", capturedAt: "2026-10-10T08:40:00.000Z" }));
    expect((await restored.snapshot()).queueLength).toBe(3);

    const sent = await syncQueue({
      queue: restored,
      api,
      accessToken: "access",
      userId: "user-1",
      online: true,
      now: () => Date.parse("2026-10-10T09:00:00.000Z"),
    });

    expect(sent.synced).toBe(3);
    expect(calls.map((call) => call.type)).toEqual(["login", "logout", "login"]);
    const snapshot = await restored.snapshot();
    expect(snapshot.queueLength).toBe(0);
    expect(snapshot.lastSyncAt).toBe("2026-10-10T09:00:00.000Z");
    expect((await createEventQueue(storage).list()).every((event) => event.status === "synced")).toBe(true);
  });
});
