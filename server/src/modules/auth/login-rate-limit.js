import { compliance } from "../../config/compliance.js";
import { AppError } from "../../lib/errors.js";

/** @type {Map<string, number[]>} */
const attempts = new Map();

export function loginRateKey(ip, email) {
  return `${ip || "unknown"}::${String(email).trim().toLowerCase()}`;
}

const PRUNE_EVERY_MS = 60_000;
let lastPrune = 0;

/** Drops keys whose newest attempt is outside the window, at most once a minute. */
function pruneAttempts(now, windowMs) {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  for (const [key, times] of attempts) {
    if (times.length === 0 || now - times[times.length - 1] >= windowMs) attempts.delete(key);
  }
}

/**
 * Sliding window per IP + email. Uses LOGIN_RATE_LIMIT_* from compliance.js.
 * @returns {{ allowed: boolean }}
 */
export function consumeLoginAttempt(ip, email, now = Date.now()) {
  const key = loginRateKey(ip, email);
  const windowMs = compliance.LOGIN_RATE_LIMIT_WINDOW_MS;
  const max = compliance.LOGIN_RATE_LIMIT_MAX;
  pruneAttempts(now, windowMs);
  const recent = (attempts.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= max) {
    attempts.set(key, recent);
    return { allowed: false };
  }

  recent.push(now);
  attempts.set(key, recent);
  return { allowed: true };
}

export function assertLoginAllowed(ip, email) {
  const result = consumeLoginAttempt(ip, email);
  if (!result.allowed) {
    throw new AppError(429, "RATE_LIMITED", "Too many login attempts");
  }
}

export function resetLoginRateLimit() {
  attempts.clear();
  lastPrune = 0;
}
