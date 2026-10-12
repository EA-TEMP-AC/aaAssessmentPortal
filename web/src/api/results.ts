import { ApiError, apiRequest } from "./client";
import type { BatchStatus } from "./batches";

/**
 * Results (B-05). API_CONTRACT.md "Results".
 * The server computes every outcome; the client never sends one.
 */
export const MARK_COMPONENTS = ["theory", "practical", "viva"] as const;
export type MarkComponent = (typeof MARK_COMPONENTS)[number];

export const RESULT_STATUSES = ["draft", "submitted", "validated", "published"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export type CandidateOutcome = "Pass" | "Fail" | "Absent";

export type ResultNosMarks = { nosId: string } & Record<MarkComponent, number | null>;

export type ResultRow = {
  candidateId: string;
  absent: boolean;
  /** null while a draft row still lacks a mark. */
  outcome: CandidateOutcome | null;
  nos: ResultNosMarks[];
};

export type ResultRecord = {
  id: string;
  batchId: string;
  status: ResultStatus;
  rows: ResultRow[];
  submittedAt: string | null;
  submittedBy: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Submit, validate, and publish return the result plus the new batch status. */
export type ResultMoveRecord = ResultRecord & {
  batchStatus: BatchStatus;
  batchStatusVersion: number;
};

export type ResultRowInput = {
  candidateId: string;
  absent?: boolean;
  nos: Array<{ nosId: string } & Record<MarkComponent, number | null>>;
};

export type SaveResultsInput = {
  rows: ResultRowInput[];
  changeReason?: string;
};

export type AttendanceRecord = {
  id: string;
  batchId: string;
  candidateId: string;
  present: boolean;
  idVerified: boolean | null;
  note: string | null;
  capturedAt: string;
};

function responseError(): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", "Result response was not recognised.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableMark(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRow(value: unknown): ResultRow {
  if (!isRecord(value) || typeof value.candidateId !== "string") throw responseError();
  const outcome =
    value.outcome === "Pass" || value.outcome === "Fail" || value.outcome === "Absent" ? value.outcome : null;
  const nos = Array.isArray(value.nos) ? value.nos : [];
  return {
    candidateId: value.candidateId,
    absent: value.absent === true,
    outcome,
    nos: nos.map((entry) => {
      if (!isRecord(entry) || typeof entry.nosId !== "string") throw responseError();
      return {
        nosId: entry.nosId,
        theory: nullableMark(entry.theory),
        practical: nullableMark(entry.practical),
        viva: nullableMark(entry.viva),
      };
    }),
  };
}

export function parseResult(value: unknown): ResultRecord {
  if (!isRecord(value)) throw responseError();
  const status = RESULT_STATUSES.find((item) => item === value.status);
  if (typeof value.id !== "string" || typeof value.batchId !== "string" || !status || !Array.isArray(value.rows)) {
    throw responseError();
  }
  return {
    id: value.id,
    batchId: value.batchId,
    status,
    rows: value.rows.map(parseRow),
    submittedAt: nullableString(value.submittedAt),
    submittedBy: nullableString(value.submittedBy),
    validatedAt: nullableString(value.validatedAt),
    validatedBy: nullableString(value.validatedBy),
    publishedAt: nullableString(value.publishedAt),
    publishedBy: nullableString(value.publishedBy),
    createdAt: nullableString(value.createdAt) ?? "",
    updatedAt: nullableString(value.updatedAt) ?? "",
  };
}

function parseMove(value: unknown): ResultMoveRecord {
  const result = parseResult(value);
  if (!isRecord(value) || typeof value.batchStatus !== "string" || typeof value.batchStatusVersion !== "number") {
    throw responseError();
  }
  return {
    ...result,
    batchStatus: value.batchStatus as BatchStatus,
    batchStatusVersion: value.batchStatusVersion,
  };
}

function resultsPath(batchId: string): string {
  return `/batches/${encodeURIComponent(batchId)}/results`;
}

/**
 * `null` when the server answers 404: no result yet, or (candidate and
 * training partner) the result is not published.
 */
export async function getResults(batchId: string, signal?: AbortSignal): Promise<ResultRecord | null> {
  try {
    return parseResult(await apiRequest<unknown>(resultsPath(batchId), { signal }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function saveResults(batchId: string, input: SaveResultsInput): Promise<ResultRecord> {
  return parseResult(await apiRequest<unknown>(resultsPath(batchId), { method: "PUT", body: input }));
}

async function postMove(batchId: string, action: string, body: Record<string, string>): Promise<ResultMoveRecord> {
  return parseMove(
    await apiRequest<unknown>(`/batches/${encodeURIComponent(batchId)}/${action}`, { method: "POST", body }),
  );
}

export async function submitResult(batchId: string, input: { lateReason?: string } = {}): Promise<ResultMoveRecord> {
  return postMove(batchId, "submit-result", input.lateReason ? { lateReason: input.lateReason } : {});
}

export async function validateResult(batchId: string, input: { reason?: string } = {}): Promise<ResultMoveRecord> {
  return postMove(batchId, "validate", input.reason ? { reason: input.reason } : {});
}

export async function publishResult(batchId: string, input: { reason?: string } = {}): Promise<ResultMoveRecord> {
  return postMove(batchId, "publish", input.reason ? { reason: input.reason } : {});
}

/** GET /batches/:id/attendance (B-06c). `present: false` is the result outcome Absent. */
export async function listAttendance(batchId: string, signal?: AbortSignal): Promise<AttendanceRecord[]> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(batchId)}/attendance`, { signal });
  if (!isRecord(body) || !Array.isArray(body.items)) throw responseError();
  return body.items.map((item) => {
    if (!isRecord(item) || typeof item.candidateId !== "string" || typeof item.present !== "boolean") {
      throw responseError();
    }
    return {
      id: nullableString(item.id) ?? "",
      batchId: nullableString(item.batchId) ?? batchId,
      candidateId: item.candidateId,
      present: item.present,
      idVerified: typeof item.idVerified === "boolean" ? item.idVerified : null,
      note: nullableString(item.note),
      capturedAt: nullableString(item.capturedAt) ?? "",
    };
  });
}
