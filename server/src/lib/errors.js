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
