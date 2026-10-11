/**
 * Session and sync limits mirrored from docs/SCHEMA.md §2.
 * Prefer `offlineSessionMaxMs` from POST /auth/login and POST /auth/refresh
 * when the server sends it. These numbers are project constants (TR s29).
 * NCVET:TR s9, s26 — offline geo login/logout; the duration itself is not a guideline figure.
 */

/** SCHEMA §2. Offline session cap (72 hours). */
export const OFFLINE_SESSION_MAX_MS = 259_200_000;

/** SCHEMA §2. Access JWT lifetime (15 minutes). Fallback if the server omits expiresInMs. */
export const ACCESS_TOKEN_TTL_MS = 900_000;

/** SCHEMA §2. Flag-only clock skew. The mock login-event API uses this; it does not reject the event. */
export const MAX_CLOCK_SKEW_MS = 300_000;

/** Refresh the access token this long before it expires, while online and inside the offline window. */
export const ACCESS_REFRESH_SKEW_MS = 60_000;

/** First sync retry delay. Doubles each failure up to SYNC_BACKOFF_MAX_MS. */
export const SYNC_BACKOFF_BASE_MS = 1_000;

/** Cap for sync retry delay. */
export const SYNC_BACKOFF_MAX_MS = 60_000;

export const APP_VERSION = "0.0.1";
