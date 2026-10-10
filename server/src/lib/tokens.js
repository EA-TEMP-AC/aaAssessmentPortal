import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { compliance } from "../config/compliance.js";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

function accessSecret() {
  const secret = env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new AppError(500, "INTERNAL", "JWT access secret is not configured");
  }
  return secret;
}

export function signAccessToken(user) {
  const ttlSeconds = Math.floor(compliance.ACCESS_TOKEN_TTL_MS / 1000);
  return jwt.sign(
    { sub: user._id.toString(), jti: randomBytes(16).toString("hex") },
    accessSecret(),
    {
      algorithm: "HS256",
      expiresIn: ttlSeconds,
    },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, accessSecret(), { algorithms: ["HS256"] });
  } catch {
    return null;
  }
}

/** Opaque refresh token. Only the sha256 hash is stored. */
export function generateRefreshToken() {
  return `rt_${randomBytes(32).toString("base64url")}`;
}

export function hashRefreshToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}
