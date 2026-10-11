/**
 * The only batch status machine. docs/SCHEMA.md §1.1 and §1.2.
 * Every status change looks up a row here (actor role × from → to).
 * B-03 mounts accept, reject, cancel, and complete.
 * B-04 mounts assign and reassign.
 * login-event and the checklist path (B-06), and submit-result / validate /
 * publish / dispute (B-05) stay in the table so later tasks do not add a
 * second one. Those routes are not registered.
 */

export const BATCH_STATUSES = Object.freeze([
  "allocated",
  "accepted",
  "rejected",
  "assessor_assigned",
  "in_progress",
  "assessment_completed",
  "result_submitted",
  "ab_validated",
  "published",
  "cancelled",
  "disputed",
]);

export const BATCH_TYPES = Object.freeze(["STT", "LTT"]);

export const BATCH_MODES = Object.freeze(["online", "offline", "blended"]);

/** SlaBreachKey. docs/SCHEMA.md §1.4. */
export const SLA_BREACH_KEYS = Object.freeze(["accept", "assign", "result"]);

function transition(action, from, to, roles) {
  return Object.freeze({
    action,
    from,
    to,
    roles: Object.freeze(roles),
  });
}

export const BATCH_TRANSITIONS = Object.freeze([
  transition("accept", "allocated", "accepted", ["aa_admin"]),
  transition("reject", "allocated", "rejected", ["aa_admin"]),
  transition("cancel", "allocated", "cancelled", ["aa_admin"]),
  transition("assign", "accepted", "assessor_assigned", ["aa_admin"]),
  transition("cancel", "accepted", "cancelled", ["aa_admin"]),
  transition("login-event", "assessor_assigned", "in_progress", ["assessor"]),
  transition("reassign", "assessor_assigned", "assessor_assigned", ["aa_admin"]),
  transition("cancel", "assessor_assigned", "cancelled", ["aa_admin"]),
  transition("complete", "in_progress", "assessment_completed", ["aa_admin"]),
  transition("cancel", "in_progress", "cancelled", ["aa_admin"]),
  transition("submit-result", "assessment_completed", "result_submitted", ["aa_admin"]),
  transition("cancel", "assessment_completed", "cancelled", ["aa_admin"]),
  transition("validate", "result_submitted", "ab_validated", ["ab_reviewer"]),
  transition("publish", "ab_validated", "published", ["ab_reviewer"]),
  transition("dispute", "result_submitted", "disputed", ["aa_admin", "ab_reviewer"]),
  transition("dispute", "ab_validated", "disputed", ["aa_admin", "ab_reviewer"]),
  transition("resolve-dispute", "disputed", "result_submitted", ["aa_admin", "ab_reviewer"]),
  transition("resolve-dispute", "disputed", "ab_validated", ["aa_admin", "ab_reviewer"]),
]);

/**
 * Roles that appear on any row for `action`, in first-seen order.
 * @param {string} action
 * @returns {string[]}
 */
export function rolesForAction(action) {
  const roles = [];
  for (const row of BATCH_TRANSITIONS) {
    if (row.action !== action) continue;
    for (const role of row.roles) {
      if (!roles.includes(role)) roles.push(role);
    }
  }
  return roles;
}

/**
 * The single from→to for this role and action.
 * Null when that move is illegal, or when more than one target exists
 * (resolve-dispute). Callers that already chose `to` use isLegalTransition.
 * @param {string} role
 * @param {string} from
 * @param {string} action
 */
export function resolveTransition(role, from, action) {
  const matches = BATCH_TRANSITIONS.filter(
    (row) => row.action === action && row.from === from && row.roles.includes(role),
  );
  if (matches.length !== 1) return null;
  return matches[0];
}

/**
 * @param {{ role: string, from: string, to: string, action?: string }} move
 */
export function isLegalTransition(move) {
  return BATCH_TRANSITIONS.some((row) => {
    if (row.from !== move.from || row.to !== move.to) return false;
    if (!row.roles.includes(move.role)) return false;
    if (move.action != null && row.action !== move.action) return false;
    return true;
  });
}
