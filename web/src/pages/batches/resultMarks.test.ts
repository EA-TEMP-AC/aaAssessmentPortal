import { expect, it } from "vitest";
import type { Qualification } from "../../api/masterData";
import type { ResultRecord } from "../../api/results";
import {
  canEditMarks,
  checkRow,
  draftFromRow,
  incompleteDetails,
  isResultStage,
  markProblem,
  nosColumns,
  nosColumnsFromResult,
  reviewActionFor,
  rowInput,
  sameDraft,
} from "./resultMarks";

function qualification(overrides: Partial<Qualification> = {}): Qualification {
  return {
    id: "q1",
    code: "Q-1",
    name: "Qualification",
    sector: "Electronics",
    ratioClass: "manufacturing",
    defaultBatchType: null,
    passCriteriaMode: null,
    passMarkUnit: "percent",
    passMarks: { theory: 50, practical: 50, viva: 50 },
    maxMarks: null,
    nos: [
      { nosId: "NOS-01", code: "N01", name: "Safety", maxMarks: null, pcs: [] },
      { nosId: "NOS-02", code: "N02", name: "Wiring", maxMarks: { theory: 40, practical: null, viva: 0 }, pcs: [] },
    ],
    pcPassMarksRequired: false,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const draftResult = { status: "draft" } as ResultRecord;
const submitted = { status: "submitted" } as ResultRecord;

it("takes the ceiling from the NOS, then the qualification, then 100 for percent", () => {
  expect(nosColumns(qualification()).map((column) => column.ceilings)).toEqual([
    { theory: 100, practical: 100, viva: 100 },
    { theory: 40, practical: 100, viva: 0 },
  ]);
  const absolute = qualification({ passMarkUnit: "absolute", maxMarks: { theory: 80, practical: null, viva: 20 } });
  expect(nosColumns(absolute).map((column) => column.ceilings)).toEqual([
    { theory: 80, practical: null, viva: 20 },
    { theory: 40, practical: null, viva: 0 },
  ]);
  expect(nosColumns(qualification())[1].label).toBe("N02 Wiring");
});

it("falls back to the NOS ids on the result when the qualification cannot be read", () => {
  const result = {
    rows: [
      { nos: [{ nosId: "NOS-02" }, { nosId: "NOS-01" }] },
      { nos: [{ nosId: "NOS-01" }] },
    ],
  } as unknown as ResultRecord;
  expect(nosColumnsFromResult(result)).toEqual([
    { nosId: "NOS-02", label: "NOS-02", ceilings: null },
    { nosId: "NOS-01", label: "NOS-01", ceilings: null },
  ]);
  expect(nosColumnsFromResult(null)).toEqual([]);
});

it("counts missing and invalid marks, skipping components that are not assessed", () => {
  const columns = nosColumns(qualification());
  expect(checkRow({ absent: false, marks: {} }, columns)).toEqual({ missing: 5, total: 5, invalid: [] });
  const draft = {
    absent: false,
    marks: { "NOS-01:theory": "70", "NOS-01:practical": " ", "NOS-02:theory": "41", "NOS-02:viva": "9" },
  };
  expect(checkRow(draft, columns)).toEqual({ missing: 3, total: 5, invalid: ["NOS-02:theory"] });
});

it("checks one mark against its ceiling", () => {
  expect(markProblem("", 40)).toBeNull();
  expect(markProblem("40", 40)).toBeNull();
  expect(markProblem("40.5", 40)).toBe("above_ceiling");
  expect(markProblem("-1", 40)).toBe("negative");
  expect(markProblem("abc", 40)).toBe("not_a_number");
  expect(markProblem("500", null)).toBeNull();
});

it("builds PUT rows without an outcome, and lets attendance decide Absent", () => {
  const columns = nosColumns(qualification());
  const draft = { absent: false, marks: { "NOS-01:theory": "70", "NOS-02:viva": "5" } };
  expect(rowInput("k1", draft, columns, true)).toEqual({
    candidateId: "k1",
    nos: [
      { nosId: "NOS-01", theory: 70, practical: null, viva: null },
      // Viva is not assessed on NOS-02, so a typed value is not sent.
      { nosId: "NOS-02", theory: null, practical: null, viva: null },
    ],
  });
  expect(rowInput("k2", draft, columns, false)).toEqual({ candidateId: "k2", nos: [] });
  expect(rowInput("k3", { absent: true, marks: {} }, columns, undefined)).toEqual({
    candidateId: "k3",
    absent: true,
    nos: [],
  });
  // A stale absent flag is ignored once attendance says present.
  expect(rowInput("k4", { absent: true, marks: {} }, columns, true)).not.toHaveProperty("absent");
});

it("reads a saved row back into the grid and compares drafts by value", () => {
  const draft = draftFromRow({
    candidateId: "k1",
    absent: false,
    outcome: null,
    nos: [{ nosId: "NOS-01", theory: 70, practical: null, viva: 0 }],
  });
  expect(draft).toEqual({ absent: false, marks: { "NOS-01:theory": "70", "NOS-01:viva": "0" } });
  expect(draftFromRow(undefined)).toEqual({ absent: false, marks: {} });
  expect(sameDraft(draft, { absent: false, marks: { "NOS-01:theory": "70.0", "NOS-01:viva": "0", x: "" } })).toBe(true);
  expect(sameDraft(draft, { ...draft, absent: true })).toBe(false);
  expect(sameDraft(draft, { absent: false, marks: { "NOS-01:theory": "71", "NOS-01:viva": "0" } })).toBe(false);
});

it("opens marks only to aa_admin on an assessment_completed batch with a draft or no result", () => {
  expect(canEditMarks("aa_admin", "assessment_completed", null)).toBe(true);
  expect(canEditMarks("aa_admin", "assessment_completed", draftResult)).toBe(true);
  expect(canEditMarks("aa_admin", "assessment_completed", submitted)).toBe(false);
  expect(canEditMarks("aa_admin", "result_submitted", draftResult)).toBe(false);
  expect(canEditMarks("mis", "assessment_completed", null)).toBe(false);
  expect(canEditMarks("ab_reviewer", "assessment_completed", null)).toBe(false);
});

it("offers the reviewer validate then publish, and nothing to anyone else", () => {
  expect(reviewActionFor("ab_reviewer", "result_submitted")).toBe("validate");
  expect(reviewActionFor("ab_reviewer", "ab_validated")).toBe("publish");
  expect(reviewActionFor("ab_reviewer", "published")).toBeNull();
  expect(reviewActionFor("ab_reviewer", "assessment_completed")).toBeNull();
  expect(reviewActionFor("aa_admin", "result_submitted")).toBeNull();
  expect(isResultStage("in_progress")).toBe(false);
  expect(isResultStage("assessment_completed")).toBe(true);
  expect(isResultStage("cancelled")).toBe(false);
});

it("reads RESULT_INCOMPLETE details defensively", () => {
  expect(incompleteDetails({ missingCandidates: ["a", 1], incompleteMarks: ["b"] })).toEqual({
    missingCandidates: ["a"],
    incompleteMarks: ["b"],
  });
  expect(incompleteDetails(null)).toEqual({ missingCandidates: [], incompleteMarks: [] });
});
