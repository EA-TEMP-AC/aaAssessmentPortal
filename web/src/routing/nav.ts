import type { Role } from "./access";
import {
  ALL_ROLES,
  AUDIT_ROLES,
  BATCH_ROLES,
  MASTER_DATA_ROLES,
  RECOGNITION_ROLES,
  RESULTS_ROLES,
  USER_ADMIN_ROLES,
  WORKING_DAY_ROLES,
} from "./access";

export type NavItem = {
  id: string;
  label: string;
  to: string;
  description: string;
  roles: readonly Role[];
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
    id: "users",
    label: "Users",
    to: "/users",
    description: "Create and manage accounts, including password reset.",
    roles: USER_ADMIN_ROLES,
  },
  {
    id: "master-data",
    label: "Master data",
    to: "/master-data",
    description: "Awarding bodies, training partners, centres, qualifications, and learners your account is allowed to read.",
    roles: MASTER_DATA_ROLES,
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
    id: "audit",
    label: "Audit log",
    to: "/audit-logs",
    description: "Audit entries your account is allowed to read.",
    roles: AUDIT_ROLES,
  },
  {
    id: "working-days",
    label: "Working days",
    to: "/working-days",
    description: "Choose weekend days and record holidays. Changes do not rewrite due dates already stored on batches.",
    roles: WORKING_DAY_ROLES,
  },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
