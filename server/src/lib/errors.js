export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function unauthorized(message = "Missing or invalid access token") {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Role or row scope denied") {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Unknown id") {
  return new AppError(404, "NOT_FOUND", message);
}

export function duplicateResource(message = "Unique constraint") {
  return new AppError(409, "DUPLICATE_RESOURCE", message);
}

export function passMarkInvalid(message, details) {
  return new AppError(400, "RESULT_PASS_MARK_INVALID", message, details);
}

export function validationError(message = "Request validation failed", details) {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

export function invalidTransition(message = "Illegal status change") {
  return new AppError(409, "INVALID_TRANSITION", message);
}

export function conflictIdempotent(message = "Same clientEventId with a different payload") {
  return new AppError(409, "CONFLICT_IDEMPOTENT", message);
}

export function slaAcceptExpired(message = "lateReason is required after acceptDueAt") {
  return new AppError(409, "SLA_ACCEPT_EXPIRED", message);
}

export function slaAssignExpired(message = "lateReason is required after assignDueAt") {
  return new AppError(409, "SLA_ASSIGN_EXPIRED", message);
}

export function slaResultExpired(message = "lateReason is required after resultDueAt") {
  return new AppError(409, "SLA_RESULT_EXPIRED", message);
}

export function resultOutcomeMismatch(details) {
  return new AppError(
    400,
    "RESULT_OUTCOME_MISMATCH",
    "outcome does not match the server-computed outcome",
    details,
  );
}

export function resultIncomplete(details) {
  return new AppError(
    409,
    "RESULT_INCOMPLETE",
    "Every active candidate needs a complete result row",
    details,
  );
}

export function ruleToaInvalid(message = "ToA is missing or expired on the assessment date") {
  return new AppError(409, "RULE_TOA_INVALID", message);
}

export function ruleMaxAas(message = "Assessor would exceed the maximum number of AAs") {
  return new AppError(409, "RULE_MAX_AAS", message);
}

export function ruleRatio(message = "Candidate count exceeds the assessor ratio", details) {
  return new AppError(409, "RULE_RATIO", message, details);
}

export function ruleAssessorClash(message = "Assessor is already booked at a different centre") {
  return new AppError(409, "RULE_ASSESSOR_CLASH", message);
}

export function ruleAssessorLanguage(
  message = "Assessor languages omit the batch assessment language",
) {
  return new AppError(409, "RULE_ASSESSOR_LANGUAGE", message);
}

export function outsideRecognition(checks) {
  return new AppError(409, "RULE_OUTSIDE_RECOGNITION", "Outside AA recognition", {
    checks,
  });
}

/**
 * @param {"not_published"|"window"|"outcome"|"type"} reason
 * @param {object} [details]
 */
export function reassessNotEligible(reason, details = {}) {
  return new AppError(409, "REASSESS_NOT_ELIGIBLE", "Reassessment rules failed", {
    reason,
    ...details,
  });
}

/**
 * A learner already has a live reassessment batch from the same parent. Q144.
 * @param {Array<{ learnerId: string, batchId: string }>} conflicts
 */
export function reassessAlreadyOpen(conflicts) {
  return new AppError(
    409,
    "REASSESS_ALREADY_OPEN",
    "A learner already has a live reassessment batch from this parent",
    { reason: "already_open", conflicts },
  );
}

/** A user is over the daily cap on reading question content. S-02. */
export function contentReadLimit(details) {
  return new AppError(
    429,
    "CONTENT_READ_LIMIT",
    "Daily limit on reading question content reached",
    details,
  );
}
