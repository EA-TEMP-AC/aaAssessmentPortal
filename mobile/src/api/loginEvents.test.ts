import { describe, expect, it, jest } from "@jest/globals";
import { readMobileEnv } from "../config/env";
import { createEventQueue } from "../queue/eventQueue";
import { newEvent, queueWith } from "../testing/fixtures";
import {
  createLoginEventApi,
  createMockLoginEventApi,
  isLateSyncByIstDate,
  toLoginEventBody,
} from "./loginEvents";

describe("login-event API", () => {
  it("flags lateSync when the IST date moved on, and replays an identical payload", async () => {
    expect(isLateSyncByIstDate("2026-10-10T18:00:00.000Z", Date.parse("2026-10-10T19:00:00.000Z"))).toBe(true);
    expect(isLateSyncByIstDate("2026-10-10T12:00:00.000Z", Date.parse("2026-10-10T16:00:00.000Z"))).toBe(false);

    const { queue } = queueWith(() => "33333333-3333-4333-8333-333333333333");
    const event = await queue.enqueue(newEvent({ capturedAt: "2026-10-10T18:00:00.000Z" }));
    const api = createMockLoginEventApi({ now: () => Date.parse("2026-10-10T19:00:00.000Z") });

    const first = await api.post(event, "access");
    const replay = await api.post(event, "access");
    const conflict = await api.post({ ...event, capturedAt: "2026-10-10T18:05:00.000Z" }, "access");

    expect(first).toMatchObject({
      kind: "success",
      replayed: false,
      lateSync: true,
      abEmailSentAt: null,
    });
    if (first.kind === "success") expect(first.abEmailQueuedAt).toBe("2026-10-10T19:00:00.000Z");
    expect(replay).toMatchObject({ kind: "success", replayed: true, lateSync: true });
    expect(conflict).toEqual({
      kind: "conflict",
      code: "CONFLICT_IDEMPOTENT",
      message: "Same clientEventId with a different payload",
    });
  });

  it("omits coordinates when GPS is unavailable", async () => {
    const event = await queueWith().queue.enqueue(
      newEvent({
        gps: { status: "unavailable", reason: "position_unavailable", detail: "no fix" },
      }),
    );
    const body = toLoginEventBody(event);
    expect(body.locationStatus).toBe("unavailable");
    expect(body.locationUnavailableReason).toBe("position_unavailable");
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/"lat"|"lng"/);
  });

  it("defaults to live endpoints unless the env flag is mock", async () => {
    expect(readMobileEnv({}).loginEventsMode).toBe("live");
    expect(readMobileEnv({ EXPO_PUBLIC_LOGIN_EVENTS_MODE: "live" }).loginEventsMode).toBe("live");
    expect(readMobileEnv({ EXPO_PUBLIC_LOGIN_EVENTS_MODE: "mock" }).loginEventsMode).toBe("mock");

    const fetchImpl = jest.fn(async () => new Response("{}", { status: 200 }));
    const event = await createEventQueue(queueWith().storage).enqueue(newEvent());
    const mock = createLoginEventApi({
      mode: "mock",
      baseUrl: "http://127.0.0.1:3000/api/v1",
      fetchImpl,
      now: () => Date.parse("2026-10-10T08:00:00.000Z"),
    });
    const result = await mock.post(event, "access");
    expect(result.kind).toBe("success");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a live login event and maps 200 replay and 409 CONFLICT_IDEMPOTENT", async () => {
    const event = await queueWith(() => "44444444-4444-4444-8444-444444444444").queue.enqueue(
      newEvent({ role: "proctor", type: "logout" }),
    );
    const fetchImpl = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchImpl
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            replayed: true,
            lateSync: false,
            clockSkewFlag: false,
            abEmailQueuedAt: null,
            abEmailSentAt: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "CONFLICT_IDEMPOTENT", message: "payload mismatch" },
          }),
          { status: 409 },
        ),
      );

    const api = createLoginEventApi({
      mode: "live",
      baseUrl: "http://127.0.0.1:3000/api/v1/",
      fetchImpl,
    });
    const replayed = await api.post(event, "access-token");
    const conflict = await api.post(event, "access-token");

    expect(replayed).toMatchObject({ kind: "success", replayed: true });
    expect(conflict).toEqual({
      kind: "conflict",
      code: "CONFLICT_IDEMPOTENT",
      message: "payload mismatch",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:3000/api/v1/proctor/login-event");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer access-token");
    const body = JSON.parse(String(init?.body)) as { clientEventId: string; lat: number };
    expect(body.clientEventId).toBe(event.clientEventId);
    expect(body.lat).toBe(12.9716);
  });
});
