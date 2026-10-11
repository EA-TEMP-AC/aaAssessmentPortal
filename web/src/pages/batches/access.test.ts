import { expect, it } from "vitest";
import { ROLES, type Role } from "../../routing/access";
import { canCreateBatch, canPerformBatchAction, visibleBatchActions, type BatchAction } from "./access";
import type { BatchStatus } from "../../api/batches";

const ALL_ACTIONS: BatchAction[] = ["accept", "reject", "assign", "reassign", "cancel", "complete"];

it("lets only aa_admin and ab_reviewer create a batch", () => {
  expect(canCreateBatch("aa_admin")).toBe(true);
  expect(canCreateBatch("ab_reviewer")).toBe(true);
  for (const role of ROLES) {
    if (role === "aa_admin" || role === "ab_reviewer") continue;
    expect(canCreateBatch(role)).toBe(false);
  }
});

it("shows each F-02 action only for aa_admin and a legal status", () => {
  const expected: Partial<Record<BatchStatus, BatchAction[]>> = {
    allocated: ["accept", "reject", "cancel"],
    accepted: ["assign", "cancel"],
    assessor_assigned: ["reassign", "cancel"],
    in_progress: ["cancel", "complete"],
    assessment_completed: ["cancel"],
  };
  const statuses: BatchStatus[] = [
    "allocated",
    "accepted",
    "rejected",
    "assessor_assigned",
    "in_progress",
    "assessment_completed",
    "result_submitted",
    "ab_validated",
    "published",
    "cancelled",
    "disputed",
  ];
  for (const role of ROLES as readonly Role[]) {
    for (const status of statuses) {
      const visible = visibleBatchActions(role, status);
      if (role !== "aa_admin") {
        expect(visible).toEqual([]);
        continue;
      }
      expect(visible).toEqual(expected[status] ?? []);
    }
  }
  expect(canPerformBatchAction("aa_admin", "accepted", "accept")).toBe(false);
  expect(ALL_ACTIONS).toHaveLength(6);
});
