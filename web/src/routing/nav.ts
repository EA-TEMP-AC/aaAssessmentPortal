import type { Role } from "./access";
import {
  ALL_ROLES,
  ANALYTICS_ROLES,
  AUDIT_ROLES,
  BATCH_ROLES,
  EVIDENCE_ROLES,
  MASTER_DATA_ROLES,
  PROCTORING_ROLES,
  PUBLIC_SITE_ROLES,
  RECOGNITION_ROLES,
  REGISTRY_ROLES,
  RESULTS_ROLES,
  SCHEME_READ_ROLES,
  USER_ADMIN_ROLES,
  WORKING_DAY_ROLES,
} from "./access";

export type NavItem = {
  id: string;
  label: string;
  to: string;
  description: string;
  /** Who sees the link in the navigation. */
  roles: readonly Role[];
  /** Who may open the page when it is wider than the navigation. Defaults to `roles`. */
  accessRoles?: readonly Role[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "home",
    label: "Home",
    to: "/home",
    description: "",
    roles: ALL_ROLES,
  },
  {
    id: "batches",
    label: "Batches",
    to: "/batches",
    description: "Filter batches, watch stored SLA due times, and take the actions your role and the current status allow.",
    roles: BATCH_ROLES,
  },
  {
    id: "ab-queue",
    label: "AB queue",
    to: "/ab-queue",
    description: "Batches with a result waiting for validation or publication.",
    roles: ["ab_reviewer"],
    accessRoles: ["ab_reviewer", "aa_admin", "mis", "ncvet_viewer"],
  },
  {
    id: "users",
    label: "Users",
    to: "/users",
    description: "Create and manage accounts, including password reset.",
    roles: USER_ADMIN_ROLES,
  },
  {
    id: "registry",
    label: "Registry",
    to: "/registry",
    description: "Assessor and proctor registry, including qualifications, languages, and ToA validity.",
    roles: REGISTRY_ROLES,
  },
  {
    id: "master-data",
    label: "Master data",
    to: "/master-data",
    description: "Awarding bodies, training partners, centres, qualifications, and learners your account is allowed to read.",
    roles: MASTER_DATA_ROLES,
  },
  {
    id: "schemes",
    label: "Schemes",
    to: "/schemes",
    description: "Funding schemes that batches can be linked to.",
    roles: SCHEME_READ_ROLES,
  },
  {
    id: "projects",
    label: "Projects",
    to: "/projects",
    description: "Projects under a scheme.",
    roles: SCHEME_READ_ROLES,
  },
  {
    id: "signatories",
    label: "Signatories",
    to: "/signatories",
    description: "People authorised to sign for a scheme, a project, or the whole agency.",
    roles: SCHEME_READ_ROLES,
  },
  {
    id: "recognition",
    label: "Recognition",
    to: "/recognition",
    description: "Recognised sectors, states or PAN India, and the recognition dates.",
    roles: RECOGNITION_ROLES,
  },
  {
    id: "results",
    label: "Results",
    to: "/results",
    description: "Result entry and review will be added in a later task.",
    roles: RESULTS_ROLES,
  },
  {
    id: "evidence",
    label: "Evidence",
    to: "/evidence",
    description: "Photos, videos and documents uploaded for batches, with checksum and location details.",
    roles: EVIDENCE_ROLES,
  },
  {
    id: "proctoring",
    label: "Proctoring",
    to: "/proctoring",
    description: "Proctored online attempts, their flags and snapshots, and the review decisions.",
    roles: PROCTORING_ROLES,
  },
  {
    id: "audit",
    label: "Audit log",
    to: "/audit-logs",
    description: "Audit entries your account is allowed to read.",
    roles: AUDIT_ROLES,
  },
  {
    id: "analytics",
    label: "Analytics",
    to: "/analytics",
    description: "Batch, result and SLA figures by assessor, training partner, job role and state.",
    roles: ANALYTICS_ROLES,
  },
  {
    id: "working-days",
    label: "Working days",
    to: "/working-days",
    description: "Choose weekend days and record holidays. Changes do not rewrite due dates already stored on batches.",
    roles: WORKING_DAY_ROLES,
  },
  {
    id: "public-site",
    label: "Public site",
    to: "/admin/public-site",
    description: "Content for the public website: team, people, sample papers, policies, documents and events.",
    roles: PUBLIC_SITE_ROLES,
  },
  {
    id: "settings",
    label: "Settings",
    to: "/settings/access",
    description: "Access and feature settings.",
    roles: ["aa_admin"],
  },
];

export function navItemsForRole(
  role: Role,
  options?: { ncvetViewerCanSeeAbQueue?: boolean },
): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.id === "ab-queue" && role === "ncvet_viewer") {
      return Boolean(options?.ncvetViewerCanSeeAbQueue);
    }
    return item.roles.includes(role);
  });
}
