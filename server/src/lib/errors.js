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

export function slaAcceptExpired(message = "lateReason is required after acceptDueAt") {
  return new AppError(409, "SLA_ACCEPT_EXPIRED", message);
}

export function slaAssignExpired(message = "lateReason is required after assignDueAt") {
  return new AppError(409, "SLA_ASSIGN_EXPIRED", message);
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
