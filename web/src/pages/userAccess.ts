import { ROLES, type Role } from "../routing/access";

/**
 * SCHEMA §5: mis may administer users except escalating anyone to aa_admin.
 * B-08 enforces the same rule on create, update, and password reset.
 */
export function rolesAssignableBy(actor: Role): readonly Role[] {
  if (actor === "aa_admin") return ROLES;
  if (actor === "mis") return ROLES.filter((role) => role !== "aa_admin");
  return [];
}

/** Activate and deactivate are updates, so they follow the same restriction. */
export function canManageUser(actor: Role, targetRole: Role): boolean {
  if (actor === "aa_admin") return true;
  if (actor === "mis") return targetRole !== "aa_admin";
  return false;
}
