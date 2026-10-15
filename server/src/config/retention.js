/**
 * Retention periods per data class. S-01. NCVET:TR s18 (data maintenance) and s20; DPDP Act 2023.
 *
 * Every period here is a PROPOSED default. Neither the Guidelines nor the TR give a number, and
 * the DPDP Act asks only that data is not kept once its purpose is served. The AA's legal adviser
 * must confirm each value (DECISIONS.md Q262) before anything acts on them. Nothing deletes
 * records yet: the dry-run job (modules/retention) only counts what is past its period.
 *
 * Fields:
 *   dataClass       stable name used in reports
 *   collection      MongoDB collection
 *   dateField       the date the period runs from
 *   retentionDays   keep for this many days after dateField
 *   filter          optional extra condition (only these rows are in the class)
 *   containsPii     true when rows carry personal data
 *   basis           why the class exists, in a few words
 * Edit this file to change a period. There is no environment override.
 */
export const RETENTION_POLICY = Object.freeze([
  {
    dataClass: "auditLogs",
    collection: "auditLogs",
    dateField: "createdAt",
    retentionDays: 2555,
    containsPii: true,
    basis: "Accountability record of changes (about 7 years)",
  },
  {
    dataClass: "accessLogs",
    collection: "accessLogs",
    dateField: "createdAt",
    retentionDays: 730,
    containsPii: false,
    basis: "Who read personal data. Ids and field names only",
  },
  {
    dataClass: "loginEvents",
    collection: "loginEvents",
    dateField: "capturedAt",
    retentionDays: 730,
    containsPii: true,
    basis: "Geo-tagged assessor, proctor and student logins (TR s9)",
  },
  {
    dataClass: "emailQueueDelivered",
    collection: "emailQueue",
    dateField: "updatedAt",
    retentionDays: 90,
    filter: { status: { $in: ["sent", "failed"] } },
    containsPii: true,
    basis: "Finished mail jobs hold recipient addresses and may hold temporary passwords",
  },
  {
    dataClass: "refreshTokens",
    collection: "refreshTokens",
    dateField: "expiresAt",
    retentionDays: 30,
    containsPii: false,
    basis: "Expired session tokens",
  },
  {
    dataClass: "inactiveUsers",
    collection: "users",
    dateField: "updatedAt",
    retentionDays: 1095,
    filter: { active: false },
    containsPii: true,
    basis: "Disabled accounts",
  },
  {
    dataClass: "inactiveLearners",
    collection: "learners",
    dateField: "updatedAt",
    retentionDays: 1095,
    filter: { active: false },
    containsPii: true,
    basis: "Deactivated learner records",
  },
  {
    dataClass: "inactiveCandidates",
    collection: "candidates",
    dateField: "updatedAt",
    retentionDays: 1095,
    filter: { active: false },
    containsPii: true,
    basis: "Roster rows removed from a batch",
  },
  {
    dataClass: "inactiveAssessors",
    collection: "assessors",
    dateField: "updatedAt",
    retentionDays: 1095,
    filter: { active: false },
    containsPii: true,
    basis: "Deactivated assessors",
  },
  {
    dataClass: "inactiveProctors",
    collection: "proctors",
    dateField: "updatedAt",
    retentionDays: 1095,
    filter: { active: false },
    containsPii: true,
    basis: "Deactivated proctors",
  },
  {
    dataClass: "publishedResults",
    collection: "results",
    dateField: "publishedAt",
    retentionDays: 3650,
    filter: { status: "published" },
    containsPii: true,
    basis: "Learner results (about 10 years). Likely to be set by the awarding body, not the AA",
  },
]);
