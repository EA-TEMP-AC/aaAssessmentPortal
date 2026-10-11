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

/** SCHEMA §5 holidays / working-day config. */
export const WORKING_DAY_ROLES: readonly Role[] = ["aa_admin", "mis"];

/** SCHEMA §5 Recognition GET/PUT. ncvet_viewer is read-only. */
export const RECOGNITION_ROLES: readonly Role[] = ["aa_admin", "mis", "ncvet_viewer"];

export function canWriteRecognition(role: Role): boolean {
  return role === "aa_admin" || role === "mis";
}
