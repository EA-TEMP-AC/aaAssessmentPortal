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
 * mis is limited to MIS_MANAGED_USER_ROLES (enforced in the users service).
 */
export const USER_ADMIN_ROLES = Object.freeze(["aa_admin", "mis"]);

/** Decision D1 (2026-10-16): the only roles `mis` may create or change users for. */
export const MIS_MANAGED_USER_ROLES = Object.freeze(["tp", "assessor", "proctor", "candidate"]);

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
/** /admin/public-site/*. W-01/B-16. aa_admin publishes; mis creates and edits drafts. */
export const PUBLIC_SITE_WRITE_ROLES = Object.freeze(["aa_admin", "mis"]);
export const PUBLIC_SITE_READ_ROLES = Object.freeze(["aa_admin", "mis"]);
/**
 * Scheme, project and authorised signatory master data. H-01.
 * Writes follow the master-data pattern (aa_admin and mis). Reads add ab_reviewer and
 * ncvet_viewer; everyone else is denied. Open question 380.
 */
export const SCHEME_WRITE_ROLES = MASTER_DATA_WRITE_ROLES;
export const SCHEME_READ_ROLES = Object.freeze(["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"]);

/** Question bank writes and imports. Q-01: aa_admin and sme only. */
export const QUESTION_WRITE_ROLES = Object.freeze(["aa_admin", "sme"]);

/** Question bank approvals. Q-01: ab_reviewer may approve, aa_admin has admin rights. */
export const QUESTION_APPROVE_ROLES = Object.freeze(["aa_admin", "ab_reviewer"]);

/** Question bank reads and coverage. Q-01: aa_admin, sme, and ab_reviewer only. */
export const QUESTION_READ_ROLES = Object.freeze(["aa_admin", "sme", "ab_reviewer"]);

/**
 * POST /batches/:id/evidence. V-01: aa_admin, or the assessor or proctor of that batch.
 * P-01: a candidate may upload only `proctor_snapshot` for their own proctoring session
 * (enforced in the service).
 */
export const EVIDENCE_UPLOAD_ROLES = Object.freeze([
  "aa_admin",
  "assessor",
  "proctor",
  "candidate",
]);

/**
 * Evidence reads. V-01: aa_admin, mis and ncvet_viewer see all; ab_reviewer sees its own awarding
 * body's batches; assessor and proctor see only their own uploads (enforced in the service).
 * candidate and tp never.
 */
export const EVIDENCE_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "ncvet_viewer",
  "ab_reviewer",
  "assessor",
  "proctor",
]);

/** POST /evidence/:id/verify. aa_admin only. */
export const EVIDENCE_VERIFY_ROLES = Object.freeze(["aa_admin"]);
/** POST /tests/generate. E-01: aa_admin and sme build draft test papers. */
export const TEST_GENERATE_ROLES = Object.freeze(["aa_admin", "sme"]);

/** POST /tests/:id/submit. B-18a (D4): the people who build drafts send them for approval. */
export const TEST_SUBMIT_ROLES = TEST_GENERATE_ROLES;

/** POST /tests/:id/approve. B-18a (D4, Guidelines 4.2d): the awarding body reviewer only. */
export const TEST_APPROVE_ROLES = Object.freeze(["ab_reviewer"]);

/** PUT /batches/:id/test-paper. B-18a (D5): aa_admin picks the one paper of a batch. */
export const BATCH_TEST_PAPER_ROLES = Object.freeze(["aa_admin"]);

/** GET /tests, GET /tests/:id, regenerate-check. E-01: candidate, tp and the rest get nothing. */
export const TEST_READ_ROLES = Object.freeze(["aa_admin", "sme", "ab_reviewer"]);
/** Sector coverage reads. Q-05: same readers as the question bank. */
export const SECTOR_COVERAGE_READ_ROLES = QUESTION_READ_ROLES;

/** Sector config and NQR qualification import. Q-05: aa_admin only. */
export const SECTOR_COVERAGE_WRITE_ROLES = Object.freeze(["aa_admin"]);

/** POST/PATCH /weight-profiles. E-02: aa_admin and sme write drafts; every edit is a new version. */
export const WEIGHT_PROFILE_WRITE_ROLES = Object.freeze(["aa_admin", "sme"]);

/** POST /weight-profiles/:id/approve. E-02: set together with the awarding body, so ab_reviewer only. */
export const WEIGHT_PROFILE_APPROVE_ROLES = Object.freeze(["ab_reviewer"]);

/** GET /weight-profiles. E-02: the writers and the approver. */
export const WEIGHT_PROFILE_READ_ROLES = Object.freeze(["aa_admin", "sme", "ab_reviewer"]);
/** POST /attempts/start, PUT answers, POST submit. E-03: the candidate on the roster only. */
export const ATTEMPT_CANDIDATE_ROLES = Object.freeze(["candidate"]);

/** GET /attempts/:id. E-03: the candidate sees their own attempt, staff follow batch scope. */
export const ATTEMPT_READ_ROLES = Object.freeze([
  "aa_admin",
  "assessor",
  "ab_reviewer",
  "candidate",
]);

/** GET /attempts. E-03: aa_admin, assessor (own batches), ab_reviewer (own awarding body). */
export const ATTEMPT_LIST_ROLES = Object.freeze(["aa_admin", "assessor", "ab_reviewer"]);

/** PUT /attempts/:id/manual-marks. E-03: aa_admin, or the assessor of the batch. */
export const ATTEMPT_MARK_ROLES = Object.freeze(["aa_admin", "assessor"]);

/** GET /attempts/:id/summary. E-03: aa_admin copies it into a result draft. */
export const ATTEMPT_SUMMARY_ROLES = Object.freeze(["aa_admin"]);
/**
 * Review cycles, review interval settings and GET /question-bank/review-due. Q-04.
 * aa_admin and sme create, list, read and close cycles and set intervals.
 */
export const REVIEW_CYCLE_MANAGE_ROLES = Object.freeze(["aa_admin", "sme"]);

/** Q-04. ab_reviewer reads and decides cycles of their own awarding body only (service). */
export const REVIEW_CYCLE_READ_ROLES = Object.freeze(["aa_admin", "sme", "ab_reviewer"]);

/** POST /review-cycles/:id/decisions. Q-04: ab_reviewer of the cycle's awarding body only. */
export const REVIEW_CYCLE_DECIDE_ROLES = Object.freeze(["ab_reviewer"]);
/** Security audit tracker writes. S-02: aa_admin only. */
export const SECURITY_AUDIT_WRITE_ROLES = Object.freeze(["aa_admin"]);

/** Security audit tracker reads and the summary. S-02. */
export const SECURITY_AUDIT_READ_ROLES = Object.freeze(["aa_admin", "mis", "ncvet_viewer"]);

/** GET /security/content-anomalies. S-02: aa_admin only. */
export const CONTENT_ANOMALY_READ_ROLES = Object.freeze(["aa_admin"]);

/** POST /proctoring/sessions, heartbeat, flags, GET warnings. P-01: the candidate, own attempt. */
export const PROCTORING_CANDIDATE_ROLES = Object.freeze(["candidate"]);

/**
 * GET /proctoring/sessions, /:id and /:id/report. P-01/P-04. aa_admin and ncvet_viewer see all;
 * proctor and assessor their assigned batches; ab_reviewer its own awarding body (service).
 */
export const PROCTORING_READ_ROLES = Object.freeze([
  "aa_admin",
  "proctor",
  "assessor",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** PATCH /proctoring/flags/:id/review. P-08: dismiss or warn; proctor only on their batches. */
export const PROCTORING_REVIEW_ROLES = Object.freeze(["aa_admin", "proctor"]);

/** P-08: only aa_admin may record `invalidate_recommended`. */
export const PROCTORING_INVALIDATE_ROLES = Object.freeze(["aa_admin"]);

/** PATCH /batches/:id/settings. B-20: aa_admin only. */
export const BATCH_SETTINGS_WRITE_ROLES = Object.freeze(["aa_admin"]);

/** GET /batches/:id/settings. B-20: staff with batch scope; the candidate gets them in the attempt. */
export const BATCH_SETTINGS_READ_ROLES = Object.freeze([
  "aa_admin",
  "mis",
  "assessor",
  "proctor",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
]);

/** PUT /batches/:id/candidate-info. B-20: the candidate fills in their own details. */
export const CANDIDATE_INFO_WRITE_ROLES = Object.freeze(["candidate"]);

/** GET /batches/:id/candidate-info. B-20: personal data, so aa_admin and the batch's tp only. */
export const CANDIDATE_INFO_READ_ROLES = Object.freeze(["aa_admin", "tp"]);

/** POST /proctoring/sessions/:id/unlock. B-20: aa_admin, or the proctor of that batch. */
export const PROCTORING_UNLOCK_ROLES = Object.freeze(["aa_admin", "proctor"]);
