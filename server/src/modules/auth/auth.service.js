import { compliance } from "../../config/compliance.js";
import { AppError, validationError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "../../lib/tokens.js";
import { RefreshToken } from "../../models/refresh-token.model.js";
import { User } from "../../models/user.model.js";
import { assertChangePasswordAllowed } from "./change-password-rate-limit.js";
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

/** Revoke every active refresh token for a user (all devices). */
export async function revokeAllRefreshTokens(userId, now = new Date()) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } });
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
 * POST /auth/change-password. The signed-in user proves the current password
 * and sets a new one. Clears `mustChangePassword` and revokes the user's other
 * refresh tokens; the one sent in `refreshToken` (this session) stays valid.
 * Without it, every refresh token of the user is revoked.
 * A wrong current password is `400 VALIDATION_ERROR`, not 401, so a client
 * does not mistake it for an expired access token.
 * @param {object} actor the authenticated user
 * @param {{ currentPassword: string, newPassword: string, refreshToken?: string }} body
 * @param {Date} [now]
 */
export async function changePassword(actor, body, now = new Date()) {
  assertChangePasswordAllowed(actor._id, now.getTime());

  const user = await User.findById(actor._id).select("+passwordHash");
  if (!user || !user.active) throw new AppError(401, "UNAUTHORIZED", "Invalid session");

  const matches = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!matches) {
    const err = validationError("Current password is incorrect", {
      currentPassword: ["Current password is incorrect"],
    });
    err.auditAction = "auth.password_change_failed";
    throw err;
  }
  if (body.newPassword === body.currentPassword) {
    throw validationError("New password must differ from the current password", {
      newPassword: ["Must differ from the current password"],
    });
  }

  user.passwordHash = await hashPassword(body.newPassword);
  user.mustChangePassword = false;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();

  const keepHash = body.refreshToken ? hashRefreshToken(body.refreshToken) : null;
  const kept = keepHash
    ? await RefreshToken.exists({
        userId: user._id,
        tokenHash: keepHash,
        revokedAt: null,
        expiresAt: { $gt: now },
      })
    : null;
  const revoked = await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null, ...(kept ? { _id: { $ne: kept._id } } : {}) },
    { $set: { revokedAt: now } },
  );

  return {
    user: publicUser(user),
    meta: { revokedRefreshTokens: revoked.modifiedCount, keptCurrentSession: Boolean(kept) },
  };
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
