import { ApiError, apiRequest } from "./client";
import type { AttemptStatus } from "./attempts";

/**
 * GET /attempts/available (task B-19): the papers this candidate may take, per batch, with
 * their own attempt state. The server never sends question ids, text, keys or marks, and
 * this module keeps only the fields below.
 */

export type AvailableAttempt = {
  id: string;
  status: AttemptStatus;
  startedAt: string | null;
  deadline: string | null;
};

export type Startable = { ok: true } | { ok: false; reason: string };

export type AvailableAssessment = {
  batchId: string;
  batchName: string;
  paperId: string;
  paperName: string;
  language: string | null;
  questionCount: number;
  durationMinutes: number;
  attempt: AvailableAttempt | null;
  startable: Startable;
};

const STATUSES: readonly string[] = ["in_progress", "submitted", "timed_out"];

function bad(): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", "Available assessments response was not recognised.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseAttempt(value: unknown): AvailableAttempt | null {
  if (value == null) return null;
  if (!isRecord(value)) throw bad();
  const id = str(value.id);
  const status = str(value.status);
  if (!id || !status || !STATUSES.includes(status)) throw bad();
  return {
    id,
    status: status as AttemptStatus,
    startedAt: str(value.startedAt),
    deadline: str(value.deadline),
  };
}

function parseStartable(value: unknown): Startable {
  if (!isRecord(value) || typeof value.ok !== "boolean") throw bad();
  if (value.ok) return { ok: true };
  return { ok: false, reason: str(value.reason) ?? "UNKNOWN" };
}

export function parseAvailableAssessment(value: unknown): AvailableAssessment {
  if (!isRecord(value)) throw bad();
  const batchId = str(value.batchId);
  const paperId = str(value.paperId);
  const questionCount = count(value.questionCount);
  const durationMinutes = count(value.durationMinutes);
  if (!batchId || !paperId || questionCount === null || durationMinutes === null) throw bad();
  return {
    batchId,
    batchName: str(value.batchName) ?? `Batch ${batchId}`,
    paperId,
    paperName: str(value.paperName) ?? str(value.paperCode) ?? paperId,
    language: str(value.language),
    questionCount,
    durationMinutes,
    attempt: parseAttempt(value.attempt),
    startable: parseStartable(value.startable),
  };
}

export async function listAvailableAssessments(signal?: AbortSignal): Promise<AvailableAssessment[]> {
  const body = await apiRequest<unknown>("/attempts/available", { signal });
  if (!isRecord(body) || !Array.isArray(body.items)) throw bad();
  return body.items.map(parseAvailableAssessment);
}
