/**
 * Named compliance constants. Sources: docs/SCHEMA.md §2.
 * Values here are project choices unless a constant is tagged in SCHEMA.
 * Do not describe them as NCVET-mandated (docs/TRACEABILITY.md, TR s29).
 *
 * B-01 uses the auth/session keys. B-02 adds the remaining SLA constants
 * to this object; do not remove the auth keys.
 */
export const compliance = Object.freeze({
  /** SCHEMA §2. Access JWT lifetime (15 minutes). */
  ACCESS_TOKEN_TTL_MS: 900_000,
  /** SCHEMA §2. Refresh token lifetime (30 days). */
  REFRESH_TOKEN_TTL_MS: 2_592_000_000,
  /** SCHEMA §2. Offline session cap returned to clients (72 hours). */
  OFFLINE_SESSION_MAX_MS: 259_200_000,
  /** SCHEMA §2. Login rate-limit window per IP + email. */
  LOGIN_RATE_LIMIT_WINDOW_MS: 900_000,
  /** SCHEMA §2. Max login attempts in the window per IP + email. */
  LOGIN_RATE_LIMIT_MAX: 20,
});
