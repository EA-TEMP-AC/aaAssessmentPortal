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
  /** Guidelines Table 7; NCVET:FR §F. SCHEMA §2. Working days after allocatedAt for an STT assign due. */
  ASSIGN_AFTER_ALLOCATION_WD_STT: 7,
  /** Guidelines Table 7; NCVET:FR §F. SCHEMA §2. Working days before assessmentStartDate for an LTT assign due. */
  ASSIGN_BEFORE_EXAM_WD_LTT: 30,
  /** Guidelines Table 7; NCVET:FR §F. SCHEMA §2. Result window for short-term batches, after assessmentEndDate. */
  RESULT_SUBMIT_WD_STT: 3,
  /** Guidelines Table 7; NCVET:FR §F. SCHEMA §2. Result window for long-term batches, after the exam date. */
  RESULT_SUBMIT_WD_LTT: 5,
  /** Guidelines Table 7; NCVET:FR §F. SCHEMA §2. STT result counts from assessmentEndDate. */
  RESULT_SLA_ANCHOR_STT: "assessment_end_date",
  /** Guidelines Table 7; NCVET:FR §F. SCHEMA §2. LTT result counts from the exam date (assessmentStartDate). */
  RESULT_SLA_ANCHOR_LTT: "exam_date",
  /** Guidelines Figure 2; NCVET:FR §F. SCHEMA §2. STT allocation lead in calendar days. Hard check is open Q15. */
  BATCH_ALLOCATE_LEAD_DAYS_STT: 15,
  /** NCVET:FR §D. SCHEMA §2. ToA certificate validity. */
  TOA_VALIDITY_YEARS: 3,
  /** NCVET:FR §D. SCHEMA §2. Assessor may work with at most this many AAs. */
  MAX_AAS_PER_ASSESSOR: 4,
  /**
   * Annexure IX(a) Assessment Delivery sub-parameter 9; docs/ERF.md row 09.
   * Same assessor, same centre, same day is allowed. Warn when either batch
   * has fewer than this many candidates. Different centres stay a hard clash.
   */
  SAME_CENTRE_LOW_CANDIDATE_THRESHOLD: 10,
  /** project. SCHEMA §2. Candidate cap for manufacturing when the ratio rule applies. */
  RATIO_MAX_MANUFACTURING: 25,
  /** project. SCHEMA §2. Candidate cap for services when the ratio rule applies. */
  RATIO_MAX_SERVICES: 35,
  /** project. SCHEMA §2. Candidate cap for school education when the ratio rule applies. */
  RATIO_MAX_SCHOOL_EDUCATION: 60,
  /** project. SCHEMA §2. Ratio rule is not applied. */
  RATIO_MAX_OTHER: null,
  /** Guidelines 4.7; NCVET:FR §F. SCHEMA §2. Reassessment window from the original result publishedAt. */
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
  /** project. W-01. Public website rate-limit window per client IP. */
  PUBLIC_RATE_LIMIT_WINDOW_MS: 60_000,
  /** project. W-01. Max /public/* requests in the window per client IP. */
  PUBLIC_RATE_LIMIT_MAX: 120,
  /** project. SCHEMA §2. Qualification pass-mark unit unless overridden. */
  DEFAULT_PASS_MARK_UNIT: "percent",
  /**
   * project. Lowest allowed pass mark or raw ceiling (theory, practical, viva, or PC).
   * A negative threshold cannot be scored.
   */
  PASS_MARK_MIN: 0,
  /**
   * project. Highest percent pass mark. Percent thresholds are not compared to raw maxMarks.
   */
  PASS_MARK_PERCENT_MAX: 100,
  /**
   * project. Q-05. A sector meets the question-bank coverage check when at least this
   * percent of its NQR qualifications have an approved question set. Open question 360.
   */
  SECTOR_MIN_COVERAGE_PERCENT: 5,
  /**
   * project. E-03. Attempt length in minutes when the test paper gives none. Open question 421.
   */
  ATTEMPT_DEFAULT_DURATION_MINUTES: 60,
  /**
   * project. E-03. Seconds after the deadline in which the server still takes a save or a
   * submit (network delay). Override with env ATTEMPT_GRACE_SECONDS. Open question 422.
   */
  ATTEMPT_GRACE_SECONDS: 30,
  /**
   * project. Q-04. Months between question bank reviews of a qualification unless the
   * qualification has its own interval. Open question 440.
   */
  QUESTION_REVIEW_INTERVAL_MONTHS: 12,
  /** project. Q-04. Lowest and highest interval a qualification may be given, in months. */
  QUESTION_REVIEW_INTERVAL_MIN_MONTHS: 1,
  QUESTION_REVIEW_INTERVAL_MAX_MONTHS: 60,
  /**
   * project. P-01. Proctoring client settings returned with each session. The browser takes a
   * snapshot every PROCTOR_SNAPSHOT_INTERVAL_SECONDS, runs detection every
   * PROCTOR_DETECTION_INTERVAL_MS, waits PROCTOR_FLAG_COOLDOWN_SECONDS between two flags of one
   * type, and raises face_not_present, camera_blocked and camera_frozen only after the condition
   * has lasted PROCTOR_SUSTAINED_SECONDS. Open question 620.
   */
  PROCTOR_SNAPSHOT_INTERVAL_SECONDS: 30,
  PROCTOR_DETECTION_INTERVAL_MS: 1000,
  PROCTOR_FLAG_COOLDOWN_SECONDS: 15,
  PROCTOR_SUSTAINED_SECONDS: Object.freeze({
    face_not_present: 5,
    camera_blocked: 5,
    camera_frozen: 8,
  }),
  /**
   * project. P-01. A session with no heartbeat for this many snapshot intervals shows as
   * `feed_lost` in lists (3 x 30 s = 90 s). Open question 621.
   */
  PROCTOR_FEED_LOST_INTERVALS: 3,
  /**
   * project. P-04. Severity of each flag type, set by the server. A flag never changes the
   * attempt or the result; a person reviews it (P-08).
   */
  PROCTOR_FLAG_SEVERITY: Object.freeze({
    tab_hidden: "low",
    fullscreen_exit: "low",
    window_blur: "low",
    permission_revoked: "low",
    object_detected: "low",
    face_not_present: "medium",
    multiple_faces: "high",
    person_detected: "high",
    phone_detected: "high",
    camera_blocked: "high",
    camera_frozen: "high",
  }),
});
