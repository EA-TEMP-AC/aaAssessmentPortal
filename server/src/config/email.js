/**
 * Email delivery settings. SCHEMA §3.12 names status, attempts, and nextAttemptAt
 * but not the cap or the backoff. These are project choices (see DECISIONS.md).
 * Not SLA figures, so they stay out of compliance.js.
 */

/** Stop retrying and set status `failed` after this many claims. */
export const EMAIL_MAX_ATTEMPTS = 5;

/** First retry waits this long. Later retries double it. */
export const EMAIL_RETRY_BASE_MS = 60_000;

/** Upper bound on a single backoff delay. */
export const EMAIL_RETRY_MAX_DELAY_MS = 3_600_000;

/** How often the process-local worker looks for due jobs. */
export const EMAIL_WORKER_INTERVAL_MS = 15_000;

/** Jobs claimed in one worker tick. A second process can claim at the same time. */
export const EMAIL_WORKER_BATCH_LIMIT = 20;

/**
 * A job still `sending` this long after its claim is treated as abandoned (the
 * worker died between claim and result) and goes back to `pending`. Open Q43.
 */
export const EMAIL_SENDING_STALE_MS = 600_000;

/**
 * A job may be returned to `pending` from `sending` by the stale reclaim at
 * most this many times. The next stale claim marks it `failed`. Q155.
 */
export const EMAIL_MAX_RECLAIMS = 2;

/**
 * Delay after a failed attempt. `attempts` is the count already recorded on the job.
 * Attempt 1 → base, attempt 2 → 2× base, then doubles until the cap.
 */
export function emailBackoffDelayMs(attempts) {
  const exponent = Math.max(0, Number(attempts) - 1);
  const raw = EMAIL_RETRY_BASE_MS * 2 ** exponent;
  if (!Number.isFinite(raw) || raw < 0) return EMAIL_RETRY_MAX_DELAY_MS;
  return Math.min(raw, EMAIL_RETRY_MAX_DELAY_MS);
}
