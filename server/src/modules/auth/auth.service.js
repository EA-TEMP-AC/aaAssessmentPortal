import { compliance } from "../../config/compliance.js";
import { AppError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "../../lib/tokens.js";
import { RefreshToken } from "../../models/refresh-token.model.js";
import { User } from "../../models/user.model.js";
import { assertLoginAllowed } from "./login-rate-limit.js";

let dummyPasswordHash;

async function burnMissingUserTime(password) {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await hashPassword("dummy-not-a-user-password");
  }
  await verifyPassword(password, dummyPasswordHash);
}

export function publicUser(user) {
  return {
    id: user._id.toString(),
    role: user.role,
    name: user.name,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

function sessionBody(user, accessToken, refreshToken) {
  return {
    accessToken,
    refreshToken,
    expiresInMs: compliance.ACCESS_TOKEN_TTL_MS,
    offlineSessionMaxMs: compliance.OFFLINE_SESSION_MAX_MS,
    user: publicUser(user),
  };
}

function refreshError(auditAction, existing, user) {
  const actorId = user?._id ?? existing?.userId ?? null;
  const err = new AppError(401, "UNAUTHORIZED", "Invalid refresh token");
  err.auditAction = auditAction;
  err.auditActorId = actorId;
  err.auditActorRole = user?.role ?? null;
  err.auditEntityId = actorId ? String(actorId) : undefined;
  return err;
}

async function revokeActiveRefreshTokens(userId, deviceId, now) {
  await RefreshToken.updateMany(
    { userId, deviceId, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
  );
}

async function issueRefreshToken(user, device) {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + compliance.REFRESH_TOKEN_TTL_MS);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    deviceId: device.deviceId,
    device: {
      platform: device.platform,
      appVersion: device.appVersion,
    },
    expiresAt,
  });
  return refreshToken;
}

export async function login({ email, password, device }, ip) {
  const normalizedEmail = email.trim().toLowerCase();
  assertLoginAllowed(ip, normalizedEmail);

  const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");
  if (!user) {
    await burnMissingUserTime(password);
    throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");
  }

  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches || !user.active) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");
  }

  const refreshToken = await issueRefreshToken(user, device);
  return sessionBody(user, signAccessToken(user), refreshToken);
}

export async function refresh({ refreshToken, device }) {
  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await RefreshToken.findOne({ tokenHash });
  const now = new Date();

  if (!existing) {
    throw refreshError("auth.refresh_failed");
  }

  // Expired and never revoked: plain 401. Do not revoke the rest of the device family.
  if (!existing.revokedAt && existing.expiresAt <= now) {
    throw refreshError("auth.refresh_failed", existing);
  }

  if (existing.revokedAt) {
    await revokeActiveRefreshTokens(existing.userId, existing.deviceId, now);
    const user = await User.findById(existing.userId);
    throw refreshError("auth.refresh_reuse_detected", existing, user);
  }

  if (existing.deviceId !== device.deviceId) {
    throw refreshError("auth.refresh_failed", existing);
  }

  const user = await User.findById(existing.userId);
  if (!user || !user.active) {
    throw refreshError("auth.refresh_failed", existing, user);
  }

  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: existing._id, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, lastUsedAt: now } },
  );
  if (!claimed) {
    const current = await RefreshToken.findById(existing._id);
    if (current?.revokedAt) {
      await revokeActiveRefreshTokens(current.userId, current.deviceId, now);
      throw refreshError("auth.refresh_reuse_detected", current, user);
    }
    throw refreshError("auth.refresh_failed", current ?? existing, user);
  }

  const nextRefreshToken = await issueRefreshToken(user, device);
  return sessionBody(user, signAccessToken(user), nextRefreshToken);
}

/**
 * Revoke the presented refresh token when it exists. Always succeeds so
 * logout stays idempotent (API contract: 204).
 */
export async function logout({ refreshToken } = {}) {
  if (!refreshToken) {
    return { result: "no_token" };
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing) {
    return { result: "not_found" };
  }

  if (!existing.revokedAt) {
    existing.revokedAt = new Date();
    existing.lastUsedAt = new Date();
    await existing.save();
  }

  const user = await User.findById(existing.userId);
  return {
    result: "revoked",
    actorId: user?._id ?? existing.userId,
    actorRole: user?.role,
    entityId: existing._id.toString(),
  };
}
