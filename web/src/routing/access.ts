export const ROLES = [
  "aa_admin",
  "mis",
  "sme",
  "assessor",
  "proctor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
] as const;

export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  aa_admin: "AA admin",
  mis: "MIS",
  sme: "SME",
  assessor: "Assessor",
  proctor: "Proctor",
  candidate: "Candidate",
  tp: "Training partner",
  ab_reviewer: "AB reviewer",
  ncvet_viewer: "NCVET viewer",
};

/** SCHEMA §5: every Phase 1 role may sign in. */
export const ALL_ROLES: readonly Role[] = ROLES;

/** SCHEMA §5 batch list/get. SME is denied. */
export const BATCH_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "assessor",
  "proctor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
];

/** SCHEMA §5 batch create. ab_reviewer is limited to their own abId on the server. */
export const BATCH_CREATE_ROLES: readonly Role[] = ["aa_admin", "ab_reviewer"];

/** SCHEMA §1.2 accept/reject/assign/reassign/cancel/complete. */
export const BATCH_ACTION_ROLES: readonly Role[] = ["aa_admin"];

/** SCHEMA §5 users CRUD. */
export const USER_ADMIN_ROLES: readonly Role[] = ["aa_admin", "mis"];

/**
 * SCHEMA §5: aa_admin and mis write master data; ab_reviewer and ncvet_viewer read.
 * B-07a also lets tp and candidate read the rows the server scopes to them.
 * See DECISIONS.md open question 63.
 */
export const MASTER_DATA_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "ab_reviewer",
  "ncvet_viewer",
  "tp",
  "candidate",
];

/** H-01 schemes, projects and signatories: aa_admin and mis write; ab_reviewer and ncvet_viewer read (Q380). */
export const SCHEME_READ_ROLES: readonly Role[] = ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"];

export function canWriteSchemes(role: Role): boolean {
  return role === "aa_admin" || role === "mis";
}

/** SCHEMA §5 results read. Proctor and SME are denied. */
export const RESULTS_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "assessor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
];

/** SCHEMA §5 audit read. */
export const AUDIT_ROLES: readonly Role[] = ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"];

/** API_CONTRACT Evidence vault: roles that get the browser. Assessor and proctor only upload (V-01). */
export const EVIDENCE_ROLES: readonly Role[] = ["aa_admin", "ab_reviewer", "mis", "ncvet_viewer"];

/** API_CONTRACT Analytics: read-only for these roles. */
export const ANALYTICS_ROLES: readonly Role[] = ["aa_admin", "mis", "ncvet_viewer", "ab_reviewer"];

/** SCHEMA §5 holidays / working-day config. */
export const WORKING_DAY_ROLES: readonly Role[] = ["aa_admin", "mis"];

/** SCHEMA §5 Recognition GET/PUT. ncvet_viewer is read-only. */
export const RECOGNITION_ROLES: readonly Role[] = ["aa_admin", "mis", "ncvet_viewer"];

export function canWriteRecognition(role: Role): boolean {
  return role === "aa_admin" || role === "mis";
}

/**
 * Assessor and proctor registry access.
 * Server ASSESSOR_READ_ROLES: aa_admin, mis, assessor, ab_reviewer, ncvet_viewer
 * Server PROCTOR_READ_ROLES: aa_admin, mis, proctor, ab_reviewer, ncvet_viewer
 * Server MASTER_DATA_WRITE_ROLES: aa_admin, mis
 */
export const ASSESSOR_READ_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "assessor",
  "ab_reviewer",
  "ncvet_viewer",
];

export const PROCTOR_READ_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "proctor",
  "ab_reviewer",
  "ncvet_viewer",
];

export const REGISTRY_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "assessor",
  "proctor",
  "ab_reviewer",
  "ncvet_viewer",
];

export function canWriteRegistry(role: Role): boolean {
  return role === "aa_admin" || role === "mis";
}

export function canReadAssessors(role: Role): boolean {
  return ASSESSOR_READ_ROLES.includes(role);
}

export function canReadProctors(role: Role): boolean {
  return PROCTOR_READ_ROLES.includes(role);
}

/** SCHEMA §5 and B-07b candidate roster roles. */
export const CANDIDATE_READ_ROLES: readonly Role[] = [
  "aa_admin",
  "mis",
  "assessor",
  "candidate",
  "tp",
  "ab_reviewer",
  "ncvet_viewer",
];

export const CANDIDATE_WRITE_ROLES: readonly Role[] = ["aa_admin", "mis"];

export function canReadCandidates(role: Role): boolean {
  return CANDIDATE_READ_ROLES.includes(role);
}

export function canWriteCandidates(role: Role): boolean {
  return CANDIDATE_WRITE_ROLES.includes(role);
}

export const CANDIDATE_ROSTER_OPEN_STATUSES = [
  "allocated",
  "accepted",
  "assessor_assigned",
] as const;

export function isBatchRosterWritable(status: string): boolean {
  return (CANDIDATE_ROSTER_OPEN_STATUSES as readonly string[]).includes(status);
}


