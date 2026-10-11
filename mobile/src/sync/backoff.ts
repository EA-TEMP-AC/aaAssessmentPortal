import { SYNC_BACKOFF_BASE_MS, SYNC_BACKOFF_MAX_MS } from "../config/compliance";

/** attempt is 1 on the first failure. */
export function syncBackoffMs(attempt: number): number {
  const step = attempt < 1 ? 1 : attempt;
  const delay = SYNC_BACKOFF_BASE_MS * 2 ** (step - 1);
  return Math.min(SYNC_BACKOFF_MAX_MS, delay);
}
