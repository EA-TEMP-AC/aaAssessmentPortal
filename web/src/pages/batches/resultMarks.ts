import type { BatchStatus } from "../../api/batches";
import type { Qualification } from "../../api/masterData";
import {
  MARK_COMPONENTS,
  type MarkComponent,
  type ResultRecord,
  type ResultRow,
  type ResultRowInput,
} from "../../api/results";
import type { Role } from "../../routing/access";

/** Batch statuses in which a result can exist. SCHEMA §1.2. */
const RESULT_STATUSES: readonly BatchStatus[] = [
  "assessment_completed",
  "result_submitted",
  "ab_validated",
  "published",
  "disputed",
];

export function isResultStage(status: BatchStatus): boolean {
  return RESULT_STATUSES.includes(status);
}

/** PUT results: aa_admin, batch assessment_completed, result draft or none yet. */
export function canEditMarks(role: Role, status: BatchStatus, result: ResultRecord | null): boolean {
  return role === "aa_admin" && status === "assessment_completed" && (!result || result.status === "draft");
}

export type ReviewAction = "validate" | "publish";

/** The awarding body reviewer's next move. The server checks the reviewer's abId. */
export function reviewActionFor(role: Role, status: BatchStatus): ReviewAction | null {
  if (role !== "ab_reviewer") return null;
  if (status === "result_submitted") return "validate";
  if (status === "ab_validated") return "publish";
  return null;
}

/**
 * Return for correction (B-05b): the awarding body reviewer, while the result
 * is submitted or validated. Never once it is published.
 */
export function canReturnForCorrection(role: Role, status: BatchStatus, result: ResultRecord | null): boolean {
  if (role !== "ab_reviewer" || !result) return false;
  if (status === "result_submitted") return result.status === "submitted";
  if (status === "ab_validated") return result.status === "validated";
  return false;
}

/** Q135: candidates do not see the Result section in the web app in Phase 1. */
export function canSeeResultSection(role: Role): boolean {
  return role !== "candidate";
}

/** A NOS column group. `ceilings` is null when the role cannot read the qualification. */
export type NosColumn = {
  nosId: string;
  label: string;
  ceilings: Record<MarkComponent, number | null> | null;
};

/**
 * Ceiling per NOS component, as B-05 scores it: the NOS maxMarks, else the
 * qualification maxMarks, else 100 for a percent qualification. 0 means the
 * component is not assessed on that NOS. null means no ceiling is known.
 */
export function nosColumns(qualification: Qualification): NosColumn[] {
  return qualification.nos.map((nos) => ({
    nosId: nos.nosId,
    label: `${nos.code} ${nos.name}`.trim(),
    ceilings: Object.fromEntries(
      MARK_COMPONENTS.map((component) => [
        component,
        nos.maxMarks?.[component] ??
          qualification.maxMarks?.[component] ??
          (qualification.passMarkUnit === "percent" ? 100 : null),
      ]),
    ) as Record<MarkComponent, number | null>,
  }));
}

/** Columns from the result itself, for roles that cannot read the qualification. */
export function nosColumnsFromResult(result: ResultRecord | null): NosColumn[] {
  const ids: string[] = [];
  for (const row of result?.rows ?? []) {
    for (const entry of row.nos) {
      if (!ids.includes(entry.nosId)) ids.push(entry.nosId);
    }
  }
  return ids.map((nosId) => ({ nosId, label: nosId, ceilings: null }));
}

export function isAssessed(column: NosColumn, component: MarkComponent): boolean {
  return column.ceilings?.[component] !== 0;
}

/** Grid state: text as typed, keyed by `${nosId}:${component}`. */
export type DraftRow = {
  absent: boolean;
  marks: Record<string, string>;
};

export function markKey(nosId: string, component: MarkComponent): string {
  return `${nosId}:${component}`;
}

export function draftFromRow(row: ResultRow | undefined): DraftRow {
  const marks: Record<string, string> = {};
  for (const entry of row?.nos ?? []) {
    for (const component of MARK_COMPONENTS) {
      const value = entry[component];
      if (value !== null) marks[markKey(entry.nosId, component)] = String(value);
    }
  }
  return { absent: row?.absent === true, marks };
}

export type MarkProblem = "not_a_number" | "negative" | "above_ceiling";

export function markProblem(text: string, ceiling: number | null): MarkProblem | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "not_a_number";
  if (value < 0) return "negative";
  if (ceiling !== null && value > ceiling) return "above_ceiling";
  return null;
}

export type RowCheck = {
  /** Assessed marks still blank. */
  missing: number;
  /** Assessed marks in total. */
  total: number;
  /** Cells that cannot be sent: not a number, negative, or above the ceiling. */
  invalid: string[];
};

export function checkRow(draft: DraftRow, columns: NosColumn[]): RowCheck {
  let missing = 0;
  let total = 0;
  const invalid: string[] = [];
  for (const column of columns) {
    for (const component of MARK_COMPONENTS) {
      if (!isAssessed(column, component)) continue;
      total += 1;
      const key = markKey(column.nosId, component);
      const text = draft.marks[key] ?? "";
      if (text.trim() === "") missing += 1;
      else if (markProblem(text, column.ceilings?.[component] ?? null)) invalid.push(key);
    }
  }
  return { missing, total, invalid };
}

/**
 * One PUT row. A candidate absent in attendance sends no marks and no `absent`
 * (attendance decides). A candidate with no attendance row may be declared
 * absent. Blank marks go as null, so the server leaves the outcome empty.
 */
export function rowInput(
  candidateId: string,
  draft: DraftRow,
  columns: NosColumn[],
  attendance: boolean | undefined,
): ResultRowInput {
  if (attendance === false) return { candidateId, nos: [] };
  if (attendance === undefined && draft.absent) return { candidateId, absent: true, nos: [] };
  return {
    candidateId,
    nos: columns.map((column) => {
      const entry = { nosId: column.nosId, theory: null, practical: null, viva: null } as ResultRowInput["nos"][number];
      for (const component of MARK_COMPONENTS) {
        const text = (draft.marks[markKey(column.nosId, component)] ?? "").trim();
        if (text !== "" && isAssessed(column, component)) entry[component] = Number(text);
      }
      return entry;
    }),
  };
}

export function sameDraft(a: DraftRow, b: DraftRow): boolean {
  if (a.absent !== b.absent) return false;
  const keys = new Set([...Object.keys(a.marks), ...Object.keys(b.marks)]);
  for (const key of keys) {
    const left = (a.marks[key] ?? "").trim();
    const right = (b.marks[key] ?? "").trim();
    if (left === right) continue;
    if (left === "" || right === "" || Number(left) !== Number(right)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** `409 RESULT_INCOMPLETE` details: candidates with no row, and rows with marks missing. */
export function incompleteDetails(details: unknown): { missingCandidates: string[]; incompleteMarks: string[] } {
  if (!isRecord(details)) return { missingCandidates: [], incompleteMarks: [] };
  return {
    missingCandidates: idList(details.missingCandidates),
    incompleteMarks: idList(details.incompleteMarks),
  };
}
