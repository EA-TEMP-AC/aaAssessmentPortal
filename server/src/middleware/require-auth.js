import { unauthorized } from "../lib/errors.js";
import { toObjectIdOrNull } from "../lib/object-id.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { User } from "../models/user.model.js";

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
      next();
    })
    .catch(next);
}
