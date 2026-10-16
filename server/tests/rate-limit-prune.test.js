import { describe, expect, it } from "vitest";
import { compliance } from "../src/config/compliance.js";
import { consumeLoginAttempt, resetLoginRateLimit } from "../src/modules/auth/login-rate-limit.js";
import {
  consumePublicRequest,
  publicRateLimitKeyCount,
  resetPublicRateLimit,
} from "../src/modules/public-site/public-site.rate-limit.js";

describe("rate limit maps", () => {
  it("drops idle public-site keys after the window", () => {
    resetPublicRateLimit();
    const t0 = 1_000_000;
    consumePublicRequest("1.1.1.1", t0);
    consumePublicRequest("2.2.2.2", t0);
    expect(publicRateLimitKeyCount()).toBe(2);
    const later = t0 + compliance.PUBLIC_RATE_LIMIT_WINDOW_MS + 61_000;
    consumePublicRequest("3.3.3.3", later);
    expect(publicRateLimitKeyCount()).toBe(1);
    resetPublicRateLimit();
  });

  it("still limits inside the window after pruning", () => {
    resetLoginRateLimit();
    const t0 = 5_000_000;
    let last;
    for (let i = 0; i <= compliance.LOGIN_RATE_LIMIT_MAX; i += 1) {
      last = consumeLoginAttempt("9.9.9.9", "a@b.co", t0 + i);
    }
    expect(last.allowed).toBe(false);
    resetLoginRateLimit();
  });
});
