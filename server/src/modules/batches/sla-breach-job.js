import { safeErrorCode } from "../../lib/safe-error.js";
import { Batch } from "../../models/batch.model.js";

/**
 * Open SLA steps. docs/SCHEMA.md §2.2 and §2.3.
 * Assign and result due instants are stored at create for both STT and LTT.
 * A missing due instant is not flagged. The nightly job and batch reads share this list.
 * Persisted late-action keys are never removed. The job does not write an audit row.
 */
export const OPEN_SLA_STEPS = Object.freeze([
  Object.freeze({
    key: "accept",
    statuses: Object.freeze(["allocated"]),
    dueField: "acceptDueAt",
  }),
  Object.freeze({
    key: "assign",
    statuses: Object.freeze(["allocated", "accepted"]),
    dueField: "assignDueAt",
  }),
  Object.freeze({
    key: "result",
    statuses: Object.freeze(["assessment_completed"]),
    dueField: "resultDueAt",
  }),
]);

/** Once a day. Operational schedule, not an SLA constant from SCHEMA §2. */
export const SLA_BREACH_JOB_INTERVAL_MS = 86_400_000;

function duePath(step) {
  return `sla.${step.dueField}`;
}

/**
 * Breach keys whose due instant has passed and whose step is still open.
 * Does not include persisted late-action keys.
 * @param {object} batch
 * @param {Date} now
 * @returns {string[]}
 */
export function openBreachKeys(batch, now) {
  const at = now.getTime();
  const keys = [];
  for (const step of OPEN_SLA_STEPS) {
    if (!step.statuses.includes(batch.status)) continue;
    const due = batch.sla?.[step.dueField];
    if (due == null) continue;
    const dueMs = new Date(due).getTime();
    if (Number.isNaN(dueMs) || at <= dueMs) continue;
    keys.push(step.key);
  }
  return keys;
}

/**
 * Persisted late-action keys plus open steps that are past due.
 * Read-only. The nightly job is what stores the open-step flags.
 * @param {object} batch
 * @param {Date} now
 * @returns {string[]}
 */
export function mergedBreachKeys(batch, now) {
  const merged = [...(batch.sla?.breached ?? [])];
  for (const key of openBreachKeys(batch, now)) {
    if (!merged.includes(key)) merged.push(key);
  }
  return merged;
}

/** Mongo filter for batches whose step is open and past due. */
export function overdueCondition(step, now) {
  return {
    status: { $in: [...step.statuses] },
    [duePath(step)]: { $type: "date", $lt: now },
  };
}

/**
 * Mark sla.breached for open steps that are past due.
 * Idempotent: a second run adds nothing and does not duplicate keys.
 * @param {Date} [now]
 * @returns {Promise<{ accept: number, assign: number, result: number }>}
 */
export async function markOverdueSlaBreaches(now = new Date()) {
  const counts = { accept: 0, assign: 0, result: 0 };
  for (const step of OPEN_SLA_STEPS) {
    const result = await Batch.updateMany(
      {
        ...overdueCondition(step, now),
        "sla.breached": { $nin: [step.key] },
      },
      { $addToSet: { "sla.breached": step.key } },
    );
    counts[step.key] = result.modifiedCount ?? 0;
  }
  return counts;
}

/**
 * Process-local timer. Tests call markOverdueSlaBreaches directly.
 * Overlapping ticks in this process are skipped. A second process may also run;
 * $addToSet keeps each breach key once.
 * @param {{ intervalMs?: number, run?: typeof markOverdueSlaBreaches }} [options]
 * @returns {() => void} stop
 */
export function startSlaBreachScheduler({
  intervalMs = SLA_BREACH_JOB_INTERVAL_MS,
  run = markOverdueSlaBreaches,
} = {}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => run())
      .catch((err) => {
        console.error("sla breach job failed", safeErrorCode(err, "SLA_JOB_FAILED"));
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return function stopSlaBreachScheduler() {
    clearInterval(timer);
  };
}
