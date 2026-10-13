import { compliance } from "../../config/compliance.js";
import { AppError } from "../../lib/errors.js";

/**
 * POST /auth/change-password is rate-limited like login: the same
 * LOGIN_RATE_LIMIT_* sliding window, keyed by the signed-in user id (the
 * caller is already known, so there is no email to key on). Every attempt
 * counts, right or wrong. Process-local, as the login limiter is (open Q24).
 * @type {Map<string, number[]>}
 */
const attempts = new Map();

export function consumeChangePasswordAttempt(userId, now = Date.now()) {
  const key = String(userId);
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

export function assertChangePasswordAllowed(userId, now = Date.now()) {
  const result = consumeChangePasswordAttempt(userId, now);
  if (!result.allowed) {
    throw new AppError(429, "RATE_LIMITED", "Too many password change attempts");
  }
}

export function resetChangePasswordRateLimit() {
  attempts.clear();
}
