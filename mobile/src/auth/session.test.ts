import { describe, expect, it } from "@jest/globals";
import { createSessionStore, decideSession, sessionFromAuthResponse, type StoredSession } from "./session";
import { ACCESS_TOKEN_TTL_MS, OFFLINE_SESSION_MAX_MS } from "../config/compliance";
import { MemoryStorage } from "../storage/memoryStorage";

function response(tokens: { accessToken: string; refreshToken: string }, offlineSessionMaxMs = OFFLINE_SESSION_MAX_MS) {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInMs: ACCESS_TOKEN_TTL_MS,
    offlineSessionMaxMs,
    user: { id: "user-1", role: "assessor", name: "Asha", mustChangePassword: false },
  };
}

function at(now: number, offlineSessionMaxMs = OFFLINE_SESSION_MAX_MS): StoredSession {
  return sessionFromAuthResponse(response({ accessToken: "access-1", refreshToken: "refresh-1" }, offlineSessionMaxMs), now);
}

describe("offline session limit", () => {
  it("allows an offline session only inside OFFLINE_SESSION_MAX_MS", () => {
    const session = at(0);
    const inside = decideSession(session, OFFLINE_SESSION_MAX_MS - 1, false);
    expect(inside.state).toBe("ready");
    if (inside.state === "ready") expect(inside.needsRefresh).toBe(false);

    expect(decideSession(session, OFFLINE_SESSION_MAX_MS, false).state).toBe("offline_expired");
  });

  it("forces password login after the limit even when the network is back", () => {
    const session = at(0);
    expect(decideSession(session, OFFLINE_SESSION_MAX_MS, true).state).toBe("offline_expired");
    const stillInside = decideSession(session, OFFLINE_SESSION_MAX_MS - 1, true);
    expect(stillInside.state).toBe("ready");
  });

  it("uses the server offlineSessionMaxMs when it is shorter than the default", () => {
    const session = at(0, 1_000);
    expect(decideSession(session, 999, false).state).toBe("ready");
    expect(decideSession(session, 1_000, false).state).toBe("offline_expired");
  });

  it("refreshes online inside the window and does not refresh while offline", () => {
    const session = at(0);
    const due = ACCESS_TOKEN_TTL_MS - 60_000;
    const online = decideSession(session, due, true);
    const offline = decideSession(session, due, false);
    expect(online.state).toBe("ready");
    expect(offline.state).toBe("ready");
    if (online.state === "ready") expect(online.needsRefresh).toBe(true);
    if (offline.state === "ready") expect(offline.needsRefresh).toBe(false);
    const early = decideSession(session, due - 1, true);
    if (early.state === "ready") expect(early.needsRefresh).toBe(false);
  });

  it("rotates both tokens and resets the offline window on refresh", async () => {
    const storage = new MemoryStorage();
    const sessions = createSessionStore(storage);
    await sessions.save(at(0));
    const rotated = sessionFromAuthResponse(response({ accessToken: "access-2", refreshToken: "refresh-2" }), 5_000);
    await sessions.save(rotated);

    const loaded = await createSessionStore(storage).load();
    expect(loaded?.accessToken).toBe("access-2");
    expect(loaded?.refreshToken).toBe("refresh-2");
    expect(loaded?.lastOnlineAuthAt).toBe(5_000);
    expect(decideSession(loaded, 5_000 + OFFLINE_SESSION_MAX_MS - 1, false).state).toBe("ready");
    expect(decideSession(loaded, 5_000 + OFFLINE_SESSION_MAX_MS, true).state).toBe("offline_expired");
  });
});
