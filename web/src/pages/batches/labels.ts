import type { BatchStatus } from "../../api/batches";
import type { BatchAction } from "./access";

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  allocated: "Allocated",
  accepted: "Accepted",
  rejected: "Rejected",
  assessor_assigned: "Assessor assigned",
  in_progress: "In progress",
  assessment_completed: "Assessment completed",
  result_submitted: "Result submitted",
  ab_validated: "AB validated",
  published: "Published",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

export const BATCH_ACTION_LABELS: Record<BatchAction, string> = {
  accept: "Accept",
  reject: "Reject",
  assign: "Assign assessor",
  reassign: "Reassign assessor",
  cancel: "Cancel",
  complete: "Complete",
};

export const BATCH_ACTION_DONE: Record<BatchAction, string> = {
  accept: "Batch accepted.",
  reject: "Batch rejected.",
  assign: "Assessor assigned.",
  reassign: "Assessor reassigned.",
  cancel: "Batch cancelled.",
  complete: "Batch marked assessment completed.",
};
