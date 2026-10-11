import { compliance } from "../../config/compliance.js";
import { AppError } from "../../lib/errors.js";

/**
 * Password reset is rate-limited (API contract). SCHEMA §2 has no separate window,
 * so this reuses LOGIN_RATE_LIMIT_* and keys by the acting user id.
 * See DECISIONS.md.
 * @type {Map<string, number[]>}
 */
const attempts = new Map();

export function consumePasswordResetAttempt(actorId, now = Date.now()) {
  const key = String(actorId);
  const windowMs = compliance.LOGIN_RATE_LIMIT_WINDOW_MS;
  const max = compliance.LOGIN_RATE_LIMIT_MAX;
  const recent = (attempts.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= max) {
    attempts.set(key, recent);
    return { allowed: false };
  }

  recent.push(now);
  attempts.set(key, recent);
  return { allowed: true };
}

export function assertPasswordResetAllowed(actorId, now = Date.now()) {
  const result = consumePasswordResetAttempt(actorId, now);
  if (!result.allowed) {
    throw new AppError(429, "RATE_LIMITED", "Too many password reset attempts");
  }
}

export function resetPasswordResetRateLimit() {
  attempts.clear();
}
