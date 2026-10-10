import { forbidden, unauthorized } from "../lib/errors.js";
import { USER_ROLES } from "../models/roles.js";

/**
 * Role gate. Authorization uses the user loaded from the database, never a
 * client-supplied role claim.
 * @param {...string} allowed
 */
export function requireRoles(...allowed) {
  for (const role of allowed) {
    if (!USER_ROLES.includes(role)) {
      throw new Error(`Unknown role: ${role}`);
    }
  }

  return function roleGate(req, _res, next) {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}
