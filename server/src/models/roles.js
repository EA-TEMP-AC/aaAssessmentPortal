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

/** Holidays and working-day config. docs/SCHEMA.md §5. */
export const WORKING_DAY_ROLES = Object.freeze(["aa_admin", "mis"]);

/** Recognition write. docs/SCHEMA.md §5. */
export const RECOGNITION_WRITE_ROLES = Object.freeze(["aa_admin", "mis"]);

/** Recognition read. docs/SCHEMA.md §5. ncvet_viewer is read-only. */
export const RECOGNITION_READ_ROLES = Object.freeze(["aa_admin", "mis", "ncvet_viewer"]);

/**
 * Users CRUD and password reset. docs/SCHEMA.md §5.
 * mis may not escalate to aa_admin (enforced in the users service).
 */
export const USER_ADMIN_ROLES = Object.freeze(["aa_admin", "mis"]);

/** Master-data writes. docs/SCHEMA.md §5: aa_admin and mis only. */
export const MASTER_DATA_WRITE_ROLES = Object.freeze(["aa_admin", "mis"]);

/**
 * Master-data reads. docs/SCHEMA.md §5 gives ab_reviewer and ncvet_viewer R,
 * and the B-07a task scopes tp, ab_reviewer, and candidate to their own rows.
 * Field lists that are not in SCHEMA are proposed in DECISIONS.md.
 */
export const AWARDING_BODY_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "ab_reviewer",
  "ncvet_viewer",
]);

export const TRAINING_PARTNER_READ_ROLES = Object.freeze(["aa_admin", "mis", "tp", "ncvet_viewer"]);

export const CENTRE_READ_ROLES = TRAINING_PARTNER_READ_ROLES;

export const QUALIFICATION_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "ab_reviewer",
  "ncvet_viewer",
]);

export const LEARNER_READ_ROLES = Object.freeze(["aa_admin", "mis", "candidate", "ncvet_viewer"]);

/**
 * Batch create. docs/SCHEMA.md §5.
 * ab_reviewer may create only when abId equals user.abId (enforced in the service).
 */
export const BATCH_CREATE_ROLES = Object.freeze(["aa_admin", "ab_reviewer"]);

/**
 * Batch list, get, and the compliance dashboard stub. docs/SCHEMA.md §5.
 * sme is denied. candidate is allowed at the route and matches no rows (open question 70).
 */
export const BATCH_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "assessor",
  "proctor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
]);
