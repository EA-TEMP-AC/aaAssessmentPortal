import { describe, expect, it } from "@jest/globals";
import { createSessionStore, sessionFromAuthResponse } from "../auth/session";
import { OFFLINE_SESSION_MAX_MS } from "../config/compliance";
import { createEventQueue } from "./eventQueue";
import { newEvent, queueWith } from "../testing/fixtures";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("event queue persistence", () => {
  it("reloads clientEventId and capturedAt from the same store", async () => {
    const capturedAt = "2026-10-10T08:15:30.000Z";
    const { storage, queue } = queueWith();
    const saved = await queue.enqueue(
      newEvent({
        capturedAt,
        gps: { status: "unavailable", reason: "permission_denied" },
      }),
    );

    const events = await createEventQueue(storage).list();
    expect(events).toHaveLength(1);
    expect(events[0]?.clientEventId).toBe(saved.clientEventId);
    expect(events[0]?.capturedAt).toBe(capturedAt);
    expect(events[0]?.gps).toEqual({ status: "unavailable", reason: "permission_denied" });
    expect(events[0]?.status).toBe("pending");
  });

  it("assigns a UUID v4 per event and does not mint a new id on reload", async () => {
    const { storage, queue } = queueWith();
    const first = await queue.enqueue(newEvent({ type: "login" }));
    const second = await queue.enqueue(newEvent({ type: "logout" }));
    expect(first.clientEventId).toMatch(UUID_V4);
    expect(second.clientEventId).toMatch(UUID_V4);
    expect(second.clientEventId).not.toBe(first.clientEventId);

    const ids = (await createEventQueue(storage).list()).map((event) => event.clientEventId);
    expect(ids).toEqual([first.clientEventId, second.clientEventId]);
  });

  it("keeps queued events when the session store is cleared", async () => {
    const { storage, queue } = queueWith();
    await queue.enqueue(newEvent());
    const sessions = createSessionStore(storage);
    await sessions.save(
      sessionFromAuthResponse(
        {
          accessToken: "access",
          refreshToken: "refresh",
          expiresInMs: 900_000,
          offlineSessionMaxMs: OFFLINE_SESSION_MAX_MS,
          user: { id: "user-1", role: "assessor", name: "Asha", mustChangePassword: false },
        },
        0,
      ),
    );
    await sessions.clear();
    expect(await sessions.load()).toBeNull();
    expect((await createEventQueue(storage).snapshot()).queueLength).toBe(1);
  });
});
