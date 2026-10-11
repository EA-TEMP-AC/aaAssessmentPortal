import { EMAIL_WORKER_BATCH_LIMIT, EMAIL_WORKER_INTERVAL_MS } from "../../config/email.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { createDefaultTransport } from "./email-transport.js";
import { processNextEmail } from "./email-queue.service.js";

/**
 * Drain due jobs. A second call in parallel is safe: each job is claimed atomically.
 * Send failures are recorded on the job and do not reject this promise.
 */
export async function processDueEmails(
  transport,
  now = new Date(),
  limit = EMAIL_WORKER_BATCH_LIMIT,
) {
  const results = [];
  for (let i = 0; i < limit; i += 1) {
    const result = await processNextEmail(transport, now);
    if (!result.claimed) break;
    results.push(result);
  }
  return results;
}

/**
 * Process-local timer. Overlapping ticks in this process are skipped.
 * Another process may run the same loop; claims stay exclusive.
 */
export function startEmailWorker({
  intervalMs = EMAIL_WORKER_INTERVAL_MS,
  transport = createDefaultTransport(),
} = {}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processDueEmails(transport)
      .catch((err) => {
        console.error("email worker tick failed", safeErrorCode(err, "WORKER_TICK_FAILED"));
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return function stopEmailWorker() {
    clearInterval(timer);
  };
}
