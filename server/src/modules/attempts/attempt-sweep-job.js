import { safeErrorCode } from "../../lib/safe-error.js";
import { closeExpiredAttempts } from "./attempt.service.js";

/** Every five minutes. Operational schedule, not a compliance constant. */
export const ATTEMPT_SWEEP_JOB_INTERVAL_MS = 300_000;

/**
 * Process-local timer. Tests call closeExpiredAttempts directly.
 * Overlapping ticks in this process are skipped. A second process is safe: closing is a
 * compare-and-set, so an attempt is closed once.
 * With runOnStart the sweep also runs once right away.
 * @param {{ intervalMs?: number, run?: typeof closeExpiredAttempts, runOnStart?: boolean }} [options]
 * @returns {() => void} stop
 */
export function startAttemptSweepScheduler({
  intervalMs = ATTEMPT_SWEEP_JOB_INTERVAL_MS,
  run = closeExpiredAttempts,
  runOnStart = false,
} = {}) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => run())
      .catch((err) => {
        console.error("attempt sweep job failed", safeErrorCode(err, "ATTEMPT_SWEEP_FAILED"));
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  if (runOnStart) tick();
  if (typeof timer.unref === "function") timer.unref();

  return function stopAttemptSweepScheduler() {
    clearInterval(timer);
  };
}
