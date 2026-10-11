import type { BatchStatus } from "../../api/batches";
import type { Role } from "../../routing/access";

/** SCHEMA §1.2 actions owned by F-02. */
export const BATCH_ACTIONS = ["accept", "reject", "assign", "reassign", "cancel", "complete"] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

const TRANSITIONS: ReadonlyArray<{ action: BatchAction; from: BatchStatus }> = [
  { action: "accept", from: "allocated" },
  { action: "reject", from: "allocated" },
  { action: "cancel", from: "allocated" },
  { action: "assign", from: "accepted" },
  { action: "cancel", from: "accepted" },
  { action: "reassign", from: "assessor_assigned" },
  { action: "cancel", from: "assessor_assigned" },
  { action: "complete", from: "in_progress" },
  { action: "cancel", from: "in_progress" },
  { action: "cancel", from: "assessment_completed" },
];

export function canCreateBatch(role: Role): boolean {
  return role === "aa_admin" || role === "ab_reviewer";
}

export function canPerformBatchAction(role: Role, status: BatchStatus, action: BatchAction): boolean {
  if (role !== "aa_admin") return false;
  return TRANSITIONS.some((row) => row.action === action && row.from === status);
}

export function visibleBatchActions(role: Role, status: BatchStatus): BatchAction[] {
  return BATCH_ACTIONS.filter((item) => canPerformBatchAction(role, status, item));
}

export function needsReason(action: BatchAction): boolean {
  return action === "reject" || action === "cancel" || action === "complete";
}

export function isAssignAction(action: BatchAction): boolean {
  return action === "assign" || action === "reassign";
}
