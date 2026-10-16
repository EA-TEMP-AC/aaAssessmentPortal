import { AppError, unauthorized } from "../lib/errors.js";
import { toObjectIdOrNull } from "../lib/object-id.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { User } from "../models/user.model.js";

/** Routes a user with a temporary password may still call. */
const MUST_CHANGE_ALLOWED = new Set([
  "POST /api/v1/auth/change-password",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/refresh",
  "GET /api/v1/auth/me",
]);

function allowedWhileMustChange(req) {
  const path = String(req.originalUrl || "")
    .split("?")[0]
    .replace(/\/+$/, "");
  return MUST_CHANGE_ALLOWED.has(`${req.method} ${path}`);
}

export function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    next(unauthorized());
    return;
  }

  const payload = verifyAccessToken(match[1]);
  const userId = toObjectIdOrNull(payload?.sub);
  if (!userId) {
    next(unauthorized());
    return;
  }

  User.findById(userId)
    .then((user) => {
      if (!user || !user.active) {
        throw unauthorized();
      }
      req.user = user;
      if (user.mustChangePassword && !allowedWhileMustChange(req)) {
        throw new AppError(403, "MUST_CHANGE_PASSWORD", "You must change your password first");
      }
      next();
    })
    .catch(next);
}
