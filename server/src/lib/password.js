import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

/**
 * bcrypt cost. Project choice (not an SLA figure).
 * Tests use a lower cost so the suite stays fast; production and dev use 10.
 */
export const BCRYPT_ROUNDS = env.NODE_ENV === "test" ? 4 : 10;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, passwordHash) {
  return bcrypt.compare(plain, passwordHash);
}
