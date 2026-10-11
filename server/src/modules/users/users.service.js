import { AppError, duplicateResource, forbidden, notFound } from "../../lib/errors.js";
import { generateTemporaryPassword, hashPassword } from "../../lib/password.js";
import { safeErrorCode } from "../../lib/safe-error.js";
import { User } from "../../models/user.model.js";
import { revokeAllRefreshTokens } from "../auth/auth.service.js";
import { enqueueEmailSafely } from "../email/email-queue.service.js";

/**
 * Public user. Never includes passwordHash, reset tokens, or refresh tokens.
 * Missing profile ids are null so the shape stays stable. See DECISIONS.md.
 */
export function presentUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    mustChangePassword: Boolean(user.mustChangePassword),
    linkedProfileId: user.linkedProfileId ? user.linkedProfileId.toString() : null,
    abId: user.abId ? user.abId.toString() : null,
    tpId: user.tpId ? user.tpId.toString() : null,
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: new Date(user.updatedAt).toISOString(),
  };
}

/** docs/SCHEMA.md §5: mis has users access except escalate to aa_admin. */
function assertCanAssign(actor, role) {
  if (actor.role === "mis" && role === "aa_admin") {
    throw forbidden("Cannot assign or modify the aa_admin role");
  }
}

function normalizeWriteError(err) {
  if (err?.code === 11000) {
    return duplicateResource("A user with this email already exists");
  }
  console.error("user write failed", safeErrorCode(err, "USER_WRITE_FAILED"));
  return new AppError(500, "INTERNAL", "Internal server error");
}

export async function createUser(actor, body) {
  assertCanAssign(actor, body.role);
  const passwordHash = await hashPassword(body.password);
  try {
    const doc = await User.create({
      email: body.email.trim().toLowerCase(),
      name: body.name.trim(),
      role: body.role,
      passwordHash,
      active: body.active ?? true,
      mustChangePassword: true,
      linkedProfileId: body.linkedProfileId,
      abId: body.abId,
      tpId: body.tpId,
    });
    return presentUser(doc);
  } catch (err) {
    throw normalizeWriteError(err);
  }
}

export async function listUsers(query) {
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.active !== undefined) filter.active = query.active;

  const skip = (query.page - 1) * query.pageSize;
  const [total, docs] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    items: docs.map((doc) => presentUser(doc)),
  };
}

export async function getUser(id) {
  const doc = await User.findById(id).lean();
  if (!doc) throw notFound();
  return presentUser(doc);
}

export async function updateUser(actor, id, body) {
  const existing = await User.findById(id).lean();
  if (!existing) throw notFound();
  assertCanAssign(actor, existing.role);
  if (body.role) assertCanAssign(actor, body.role);

  const $set = {};
  const $unset = {};
  if (body.email !== undefined) $set.email = body.email.trim().toLowerCase();
  if (body.name !== undefined) $set.name = body.name.trim();
  if (body.role !== undefined) $set.role = body.role;
  if (body.active !== undefined) $set.active = body.active;
  for (const key of ["linkedProfileId", "abId", "tpId"]) {
    if (body[key] === undefined) continue;
    if (body[key] === null) $unset[key] = "";
    else $set[key] = body[key];
  }

  const update = {};
  if (Object.keys($set).length > 0) update.$set = $set;
  if (Object.keys($unset).length > 0) update.$unset = $unset;

  try {
    const updated = await User.findOneAndUpdate({ _id: existing._id }, update, {
      new: true,
    }).lean();
    if (!updated) throw notFound();
    return { before: presentUser(existing), user: presentUser(updated) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw normalizeWriteError(err);
  }
}

function passwordResetText(temporaryPassword) {
  return [
    "An administrator reset your assessment portal password.",
    `Temporary password: ${temporaryPassword}`,
    "Sign in with this password. You will be asked to change it.",
  ].join("\n");
}

async function applyPassword(userId, passwordHash) {
  try {
    await User.updateOne(
      { _id: userId },
      {
        $set: { passwordHash, mustChangePassword: true },
        $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" },
      },
    );
  } catch (err) {
    console.error("user password update failed", safeErrorCode(err, "USER_WRITE_FAILED"));
    throw new AppError(500, "INTERNAL", "Internal server error");
  }
  await revokeAllRefreshTokens(userId);
}

/**
 * Admin password reset. `newPassword` is stored hashed. `sendEmail` generates a
 * temporary password, stores the hash, and queues the plaintext. The temporary
 * password is not returned. Refresh tokens for the user are revoked.
 * A queue failure does not throw.
 */
export async function resetUserPassword(actor, id, body) {
  const existing = await User.findById(id).lean();
  if (!existing) throw notFound();
  assertCanAssign(actor, existing.role);

  if (body.newPassword) {
    const passwordHash = await hashPassword(body.newPassword);
    await applyPassword(existing._id, passwordHash);
    const after = await User.findById(existing._id).lean();
    return {
      httpStatus: 204,
      body: null,
      before: presentUser(existing),
      after: presentUser(after),
      meta: { mode: "set_password" },
    };
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await applyPassword(existing._id, passwordHash);

  const queued = await enqueueEmailSafely({
    to: [existing.email],
    subject: "Your assessment portal password was reset",
    text: passwordResetText(temporaryPassword),
    kind: "password_reset",
    meta: { userId: existing._id.toString() },
  });

  const after = await User.findById(existing._id).lean();
  return {
    httpStatus: 202,
    body: { emailQueued: queued.queued },
    before: presentUser(existing),
    after: presentUser(after),
    meta: { mode: "email", emailQueued: queued.queued },
  };
}
