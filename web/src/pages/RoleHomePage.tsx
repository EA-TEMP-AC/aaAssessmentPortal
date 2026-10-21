import { useSession } from "../api/session";
import { ROLE_LABELS, type Role } from "../routing/access";
import { DashboardPanel } from "./DashboardPanel";

const DASHBOARD_ROLES: readonly Role[] = ["aa_admin", "mis", "ncvet_viewer"];

const LANDING: Record<Role, string> = {
  aa_admin:
    "Batch allocation, assessor assignment, and compliance actions will be managed from here.",
  mis: "Users, master data, recognition, holidays, and the audit log will be managed from here.",
  sme: "No Phase 1 screens are assigned to this role. Question-bank tools are planned for a later phase.",
  assessor:
    "Assigned batches and results for your assessments will appear here.",
  proctor: "Assigned batches for your proctoring work will appear here.",
  candidate: "A summary of your own assessment batches will appear here.",
  tp: "Batches and results for your training partner will appear here.",
  ab_reviewer:
    "Batches, results, and audit records for your awarding body will appear here.",
  ncvet_viewer:
    "Read-only monitoring of batches, results, recognition, and audit records will appear here.",
};

export function RoleHomePage() {
  const session = useSession();
  if (!session) return null;
  const label = ROLE_LABELS[session.user.role];

  return (
    <>
      <h1>{label}</h1>
      {DASHBOARD_ROLES.includes(session.user.role) ? (
        <DashboardPanel />
      ) : (
        <p>{LANDING[session.user.role]}</p>
      )}
    </>
  );
}
