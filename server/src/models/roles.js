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

/** GET /audit/access-log. S-01: who read whose personal data. aa_admin only. */
export const ACCESS_LOG_READ_ROLES = Object.freeze(["aa_admin"]);

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
 * Assessor registry reads. SCHEMA §5 master-data R plus the assessor
 * viewing their own record (linkedProfileId). Writes stay MASTER_DATA_WRITE_ROLES.
 */
export const ASSESSOR_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "assessor",
  "ab_reviewer",
  "ncvet_viewer",
]);

/**
 * Proctor registry reads. SCHEMA §5 master-data R plus the proctor
 * viewing their own record (linkedProfileId).
 */
export const PROCTOR_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "proctor",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** GET /assessors/available. Assigners and monitoring readers. */
export const ASSESSOR_AVAILABLE_ROLES = Object.freeze(["aa_admin", "mis", "ncvet_viewer"]);

/**
 * Batch create. docs/SCHEMA.md §5.
 * ab_reviewer may create only when abId equals user.abId (enforced in the service).
 */
export const BATCH_CREATE_ROLES = Object.freeze(["aa_admin", "ab_reviewer"]);

/**
 * POST /batches/:id/reassessments. Open Q22, decided 2026-10-13: aa_admin, or
 * the ab_reviewer of the batch's awarding body (enforced in the service).
 */
export const REASSESSMENT_CREATE_ROLES = Object.freeze(["aa_admin", "ab_reviewer"]);

/**
 * Batch list, get, and the compliance dashboard stub. docs/SCHEMA.md §5.
 * sme is denied. candidate matches batches whose roster contains their learner.
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

/**
 * Candidate roster writes and CSV import. docs/SCHEMA.md §5.
 * Reads are scoped to the caller's batch row (candidate sees only their row).
 */
export const CANDIDATE_WRITE_ROLES = Object.freeze(["aa_admin", "mis"]);

/** Candidate roster GET. Proctor and sme are denied on this collection. */
export const CANDIDATE_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "assessor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** Attendance and checklist writes. docs/SCHEMA.md §5: the assigned assessor only. */
export const ATTENDANCE_WRITE_ROLES = Object.freeze(["assessor"]);

/** Results PUT. docs/SCHEMA.md §5. Submit, validate, and publish use the transition table. */
export const RESULT_WRITE_ROLES = Object.freeze(["aa_admin"]);

/** Results read. docs/SCHEMA.md §5: proctor and sme are denied. Rows follow batch scope. */
export const RESULT_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "assessor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** These roles read a result only after it is published. */
export const RESULT_PUBLISHED_ONLY_ROLES = Object.freeze(["candidate", "tp"]);

/** GET /results/:id/change-log. API_CONTRACT.md. */
export const RESULT_CHANGE_LOG_ROLES = Object.freeze(["aa_admin", "ab_reviewer", "mis"]);

/** PUT /batches/:id/learner-feedback. docs/SCHEMA.md §3.8. */
export const LEARNER_FEEDBACK_WRITE_ROLES = Object.freeze(["aa_admin", "mis"]);

/**
 * GET /batches/:id/learner-feedback. Rows follow batch scope. candidate, tp,
 * and sme get nothing.
 */
export const LEARNER_FEEDBACK_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "assessor",
  "proctor",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** PUT /batches/:id/assessor-payment. docs/SCHEMA.md §3.18 and §5. */
export const ASSESSOR_PAYMENT_WRITE_ROLES = Object.freeze(["aa_admin", "mis"]);

/**
 * Assessor payment lists. ncvet_viewer reads; an assessor reads only rows with
 * their own assessor id (enforced in the service). ab_reviewer passes this gate but is then
 * denied unless the `abReviewerCanReadAssessorPayments` setting is on (decision 174), and
 * sees only its own awarding body's batches. Everyone else is denied.
 */
export const ASSESSOR_PAYMENT_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "ncvet_viewer",
  "assessor",
  "ab_reviewer",
]);

/** GET /settings/access. B-15 (Q161, Q171): the clients read the flags to show or hide screens. */
export const ACCESS_SETTINGS_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "ncvet_viewer",
  "ab_reviewer",
]);

/** PUT /settings/access. aa_admin only. */
export const ACCESS_SETTINGS_WRITE_ROLES = Object.freeze(["aa_admin"]);

/**
 * GET /analytics/*. N-01. ab_reviewer is limited to their own awarding body in the service;
 * a reviewer with no abId is refused. Everyone else is denied.
 */
export const ANALYTICS_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "ncvet_viewer",
  "ab_reviewer",
]);
/** /admin/public-site/*. W-01. aa_admin writes the public website content, mis reads it. */
export const PUBLIC_SITE_WRITE_ROLES = Object.freeze(["aa_admin"]);
export const PUBLIC_SITE_READ_ROLES = Object.freeze(["aa_admin", "mis"]);
/** Question bank writes and imports. Q-01: aa_admin and sme only. */
export const QUESTION_WRITE_ROLES = Object.freeze(["aa_admin", "sme"]);

/** Question bank approvals. Q-01: ab_reviewer may approve, aa_admin has admin rights. */
export const QUESTION_APPROVE_ROLES = Object.freeze(["aa_admin", "ab_reviewer"]);

/** Question bank reads and coverage. Q-01: aa_admin, sme, and ab_reviewer only. */
export const QUESTION_READ_ROLES = Object.freeze(["aa_admin", "sme", "ab_reviewer"]);

/** POST /tests/generate. E-01: aa_admin and sme build draft test papers. */
export const TEST_GENERATE_ROLES = Object.freeze(["aa_admin", "sme"]);

/** POST /tests/:id/approve. E-01 (AB approval step, task A-04): ab_reviewer or aa_admin. */
export const TEST_APPROVE_ROLES = Object.freeze(["aa_admin", "ab_reviewer"]);

/** GET /tests, GET /tests/:id, regenerate-check. E-01: candidate, tp and the rest get nothing. */
export const TEST_READ_ROLES = Object.freeze(["aa_admin", "sme", "ab_reviewer"]);
