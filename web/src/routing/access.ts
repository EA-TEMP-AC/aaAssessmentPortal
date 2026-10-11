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

/** SCHEMA §5 users CRUD. */
export const USER_ADMIN_ROLES: readonly Role[] = ["aa_admin", "mis"];

/** SCHEMA §5 learners / master data. AB reviewer and NCVET viewer are read-only. */
export const MASTER_DATA_ROLES: readonly Role[] = ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"];

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
