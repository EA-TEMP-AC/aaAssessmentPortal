/** UserRole enum. docs/SCHEMA.md §1.4. */
export const USER_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "sme",
  "assessor",
  "proctor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** Audit read. docs/SCHEMA.md §5 permission matrix. */
export const AUDIT_READ_ROLES = Object.freeze(["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"]);
