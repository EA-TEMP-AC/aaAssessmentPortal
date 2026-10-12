import { USER_ROLES } from "../src/models/roles.js";
import {
  BATCH_STATUSES,
  BATCH_TRANSITIONS,
  isLegalTransition,
  resolveTransition,
  rolesForAction,
} from "../src/modules/batches/batch-transitions.js";

/** docs/SCHEMA.md §1.2, in table order. */
const EXPECTED = [
  ["accept", "allocated", "accepted", ["aa_admin"]],
  ["reject", "allocated", "rejected", ["aa_admin"]],
  ["cancel", "allocated", "cancelled", ["aa_admin"]],
  ["assign", "accepted", "assessor_assigned", ["aa_admin"]],
  ["cancel", "accepted", "cancelled", ["aa_admin"]],
  ["login-event", "assessor_assigned", "in_progress", ["assessor"]],
  ["reassign", "assessor_assigned", "assessor_assigned", ["aa_admin"]],
  ["cancel", "assessor_assigned", "cancelled", ["aa_admin"]],
  ["complete", "in_progress", "assessment_completed", ["aa_admin"]],
  ["checklist", "in_progress", "assessment_completed", ["assessor"]],
  ["cancel", "in_progress", "cancelled", ["aa_admin"]],
  ["submit-result", "assessment_completed", "result_submitted", ["aa_admin"]],
  ["cancel", "assessment_completed", "cancelled", ["aa_admin"]],
  ["validate", "result_submitted", "ab_validated", ["ab_reviewer"]],
  ["publish", "ab_validated", "published", ["ab_reviewer"]],
  ["dispute", "result_submitted", "disputed", ["aa_admin", "ab_reviewer"]],
  ["dispute", "ab_validated", "disputed", ["aa_admin", "ab_reviewer"]],
  ["resolve-dispute", "disputed", "result_submitted", ["aa_admin", "ab_reviewer"]],
  ["resolve-dispute", "disputed", "ab_validated", ["aa_admin", "ab_reviewer"]],
];

describe("batch transition table", () => {
  it("matches SCHEMA §1.2 and no other edges", () => {
    expect(BATCH_TRANSITIONS.map((row) => [row.action, row.from, row.to, [...row.roles]])).toEqual(
      EXPECTED,
    );
    expect(
      new Set(
        BATCH_TRANSITIONS.map((row) => row.from).concat(BATCH_TRANSITIONS.map((row) => row.to)),
      ),
    ).toEqual(new Set(BATCH_STATUSES));
  });

  it("allows each role only the schema rows, including same-status reassign", () => {
    for (const role of USER_ROLES) {
      for (const from of BATCH_STATUSES) {
        for (const to of BATCH_STATUSES) {
          const allowed = EXPECTED.some(
            ([, rowFrom, rowTo, roles]) => rowFrom === from && rowTo === to && roles.includes(role),
          );
          expect(isLegalTransition({ role, from, to }), `${role} ${from} -> ${to}`).toBe(allowed);
        }
      }
    }
  });

  it("resolves one target per mounted action and leaves resolve-dispute for the caller to choose", () => {
    expect(rolesForAction("accept")).toEqual(["aa_admin"]);
    expect(rolesForAction("reject")).toEqual(["aa_admin"]);
    expect(rolesForAction("cancel")).toEqual(["aa_admin"]);
    expect(rolesForAction("complete")).toEqual(["aa_admin"]);
    expect(rolesForAction("assign")).toEqual(["aa_admin"]);
    expect(rolesForAction("reassign")).toEqual(["aa_admin"]);
    expect(rolesForAction("login-event")).toEqual(["assessor"]);
    expect(rolesForAction("checklist")).toEqual(["assessor"]);
    expect(rolesForAction("validate")).toEqual(["ab_reviewer"]);
    expect(rolesForAction("publish")).toEqual(["ab_reviewer"]);
    expect(rolesForAction("dispute")).toEqual(["aa_admin", "ab_reviewer"]);
    expect(rolesForAction("resolve-dispute")).toEqual(["aa_admin", "ab_reviewer"]);
    expect(rolesForAction("not-an-action")).toEqual([]);

    for (const [action, from, to, roles] of EXPECTED) {
      const sameMove = EXPECTED.filter((row) => row[0] === action && row[1] === from);
      for (const role of USER_ROLES) {
        const allowed = roles.includes(role);
        expect(isLegalTransition({ role, from, to, action }), `${role} ${action}`).toBe(allowed);
        if (!allowed || sameMove.length !== 1) {
          expect(resolveTransition(role, from, action)).toBeNull();
        } else {
          expect(resolveTransition(role, from, action)?.to).toBe(to);
        }
      }
    }

    expect(resolveTransition("aa_admin", "disputed", "resolve-dispute")).toBeNull();
    expect(
      isLegalTransition({
        role: "aa_admin",
        from: "disputed",
        to: "result_submitted",
        action: "resolve-dispute",
      }),
    ).toBe(true);
    expect(
      isLegalTransition({
        role: "ab_reviewer",
        from: "disputed",
        to: "ab_validated",
        action: "resolve-dispute",
      }),
    ).toBe(true);
    expect(resolveTransition("aa_admin", "accepted", "accept")).toBeNull();
    expect(resolveTransition("tp", "allocated", "cancel")).toBeNull();
  });
});
