import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

/** bcrypt cost from BCRYPT_COST (default 10). Project choice, not an SLA figure. */
export const BCRYPT_ROUNDS = env.BCRYPT_COST;

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain, passwordHash) {
  return bcrypt.compare(plain, passwordHash);
}
