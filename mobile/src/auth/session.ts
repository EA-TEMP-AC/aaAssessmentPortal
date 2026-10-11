import { ACCESS_REFRESH_SKEW_MS } from "../config/compliance";
import type { AuthSessionResponse, SessionUser } from "../api/authApi";
import type { KeyValueStore } from "../storage/types";

export type StoredSession = AuthSessionResponse & {
  /** Epoch ms when the access token should be treated as expired. */
  accessTokenExpiresAt: number;
  /** Epoch ms of the last successful online login or refresh. Offline use is measured from here. */
  lastOnlineAuthAt: number;
};

export type SessionDecision =
  | { state: "anonymous" }
  | { state: "offline_expired" }
  | { state: "password_change_required"; session: StoredSession }
  | { state: "ready"; session: StoredSession; needsRefresh: boolean };

const SESSION_KEY = "aa.session.v1";

export function sessionFromAuthResponse(response: AuthSessionResponse, now: number): StoredSession {
  return {
    ...response,
    user: { ...response.user },
    accessTokenExpiresAt: now + response.expiresInMs,
    lastOnlineAuthAt: now,
  };
}

/**
 * Offline use is allowed only while now - lastOnlineAuthAt is inside offlineSessionMaxMs.
 * At the limit, password login is required even if the network is back (do not refresh).
 * NCVET:TR s9, s26 — the app keeps working offline; the cap is SCHEMA OFFLINE_SESSION_MAX_MS.
 */
export function decideSession(session: StoredSession | null, now: number, online: boolean): SessionDecision {
  if (!session) return { state: "anonymous" };
  if (now - session.lastOnlineAuthAt >= session.offlineSessionMaxMs) {
    return { state: "offline_expired" };
  }
  if (session.user.mustChangePassword) {
    return { state: "password_change_required", session };
  }
  const needsRefresh = online && now >= session.accessTokenExpiresAt - ACCESS_REFRESH_SKEW_MS;
  return { state: "ready", session, needsRefresh };
}

export function offlineSessionEndsAt(session: StoredSession): number {
  return session.lastOnlineAuthAt + session.offlineSessionMaxMs;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.role === "string" &&
    typeof user.name === "string" &&
    typeof user.mustChangePassword === "boolean"
  );
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.accessToken === "string" &&
    session.accessToken.length > 0 &&
    typeof session.refreshToken === "string" &&
    session.refreshToken.length > 0 &&
    typeof session.expiresInMs === "number" &&
    typeof session.offlineSessionMaxMs === "number" &&
    typeof session.accessTokenExpiresAt === "number" &&
    typeof session.lastOnlineAuthAt === "number" &&
    isSessionUser(session.user)
  );
}

export type SessionStore = {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
};

export function createSessionStore(store: KeyValueStore): SessionStore {
  return {
    async load() {
      const raw = await store.getItem(SESSION_KEY);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isStoredSession(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async save(session) {
      await store.setItem(SESSION_KEY, JSON.stringify(session));
    },
    async clear() {
      await store.deleteItem(SESSION_KEY);
    },
  };
}
