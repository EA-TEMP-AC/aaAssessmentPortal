/**
 * Named compliance constants. Sources: docs/SCHEMA.md §2.
 * Each tag is the schema tag. Untagged schema rows are project choices.
 * Do not describe project choices as NCVET-mandated (docs/TRACEABILITY.md, TR s29).
 * No magic SLA numbers in feature code — read them from this object.
 */
export const compliance = Object.freeze({
  /** project. SCHEMA §2. IST calendar for assessment dates and SLA due instants. */
  TIMEZONE: "Asia/Kolkata",
  /** project. SCHEMA §2. Saturday and Sunday (`Date` day index). */
  WEEKEND_DAYS: Object.freeze([6, 0]),
  /** NCVET:FR §F. SCHEMA §2. Accept or reject within this many working days. */
  ACCEPT_REJECT_WORKING_DAYS: 2,
  /** NCVET:FR §F. SCHEMA §2. Assign this many working days before a short-term exam. */
  ASSIGN_BEFORE_EXAM_WD_STT: 7,
  /** NCVET:FR §F. SCHEMA §2. Assign this many working days before a long-term exam. */
  ASSIGN_BEFORE_EXAM_WD_LTT: 30,
  /** project. SCHEMA §2. Alternate assign window from acceptance (open Q12). */
  ASSIGN_FROM_ACCEPTANCE_WD_STT: 7,
  /** project. SCHEMA §2. Alternate assign window from acceptance (open Q12). */
  ASSIGN_FROM_ACCEPTANCE_WD_LTT: 30,
  /** project. SCHEMA §2. `before_exam` (default) or `from_acceptance`. */
  ASSIGN_SLA_MODE: "before_exam",
  /** NCVET:FR §F. SCHEMA §2. Result submission window for short-term batches. */
  RESULT_SUBMIT_WD_STT: 3,
  /** NCVET:FR §F. SCHEMA §2. Result submission window for long-term batches. */
  RESULT_SUBMIT_WD_LTT: 5,
  /** project. SCHEMA §2. Default result anchor (open Q16). */
  RESULT_SLA_ANCHOR: "assessment_end_date",
  /** project. SCHEMA §2. Allocation lead for short-term batches. */
  BATCH_ALLOCATE_LEAD_DAYS_STT: 15,
  /** NCVET:FR §D. SCHEMA §2. ToA certificate validity. */
  TOA_VALIDITY_YEARS: 3,
  /** NCVET:FR §D. SCHEMA §2. Assessor may work with at most this many AAs. */
  MAX_AAS_PER_ASSESSOR: 4,
  /** project. SCHEMA §2. Candidate cap for manufacturing when the ratio rule applies. */
  RATIO_MAX_MANUFACTURING: 25,
  /** project. SCHEMA §2. Candidate cap for services when the ratio rule applies. */
  RATIO_MAX_SERVICES: 35,
  /** project. SCHEMA §2. Candidate cap for school education when the ratio rule applies. */
  RATIO_MAX_SCHOOL_EDUCATION: 60,
  /** project. SCHEMA §2. Ratio rule is not applied. */
  RATIO_MAX_OTHER: null,
  /** NCVET:FR §F. SCHEMA §2. Reassessment window from the first assessment end. */
  REASSESS_WINDOW_YEARS: 1,
  /** project. SCHEMA §2. Evidence vault is not required for Phase 1 results. */
  EVIDENCE_REQUIRED_FOR_RESULT: false,
  /** project. SCHEMA §2. Soft reachability window. */
  ASSESSOR_REACHABLE_HOURS: 24,
  /** project. SCHEMA §2. Clock skew is flagged, not rejected. */
  MAX_CLOCK_SKEW_MS: 300_000,
  /** project. SCHEMA §2. Offline session cap returned to clients (72 hours). */
  OFFLINE_SESSION_MAX_MS: 259_200_000,
  /** project. SCHEMA §2. Access JWT lifetime (15 minutes). */
  ACCESS_TOKEN_TTL_MS: 900_000,
  /** project. SCHEMA §2. Refresh token lifetime (30 days). */
  REFRESH_TOKEN_TTL_MS: 2_592_000_000,
  /** project. SCHEMA §2. Login rate-limit window per IP + email. */
  LOGIN_RATE_LIMIT_WINDOW_MS: 900_000,
  /** project. SCHEMA §2. Max login attempts in the window per IP + email. */
  LOGIN_RATE_LIMIT_MAX: 20,
  /** project. SCHEMA §2. Qualification pass-mark unit unless overridden. */
  DEFAULT_PASS_MARK_UNIT: "percent",
});
