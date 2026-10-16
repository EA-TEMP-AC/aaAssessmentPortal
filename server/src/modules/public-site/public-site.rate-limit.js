import { compliance } from "../../config/compliance.js";
import { AppError } from "../../lib/errors.js";

/** @type {Map<string, number[]>} */
const hits = new Map();

const PRUNE_EVERY_MS = 60_000;
let lastPrune = 0;

/** Drops keys whose newest hit is outside the window, at most once a minute. */
function pruneHits(now, windowMs) {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  for (const [key, times] of hits) {
    if (times.length === 0 || now - times[times.length - 1] >= windowMs) hits.delete(key);
  }
}

/**
 * Sliding window per client IP for /public/*. PUBLIC_RATE_LIMIT_* in compliance.js.
 * In memory, so the limit is per server process (DECISIONS.md).
 */
export function consumePublicRequest(ip, now = Date.now()) {
  const key = ip || "unknown";
  const windowMs = compliance.PUBLIC_RATE_LIMIT_WINDOW_MS;
  pruneHits(now, windowMs);
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= compliance.PUBLIC_RATE_LIMIT_MAX) {
    hits.set(key, recent);
    return { allowed: false, retryAfterSeconds: Math.ceil((recent[0] + windowMs - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function publicRateLimit(req, res, next) {
  const result = consumePublicRequest(req.ip || req.socket?.remoteAddress);
  if (!result.allowed) {
    res.set("Retry-After", String(Math.max(1, result.retryAfterSeconds)));
    next(new AppError(429, "RATE_LIMITED", "Too many requests"));
    return;
  }
  next();
}

/** For tests. */
export function publicRateLimitKeyCount() {
  return hits.size;
}

export function resetPublicRateLimit() {
  hits.clear();
  lastPrune = 0;
}
