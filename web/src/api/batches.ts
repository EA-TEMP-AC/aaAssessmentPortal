import { ApiError, apiRequest } from "./client";
import type { RatioClass } from "./masterData";
import { BATCH_TYPES, isRatioClass, type BatchType } from "./masterData";

/**
 * Batches. Paths and bodies follow API_CONTRACT.md v0.5. Field lists follow
 * server/src/modules/batches presentBatch (B-03, B-04, B-12). See
 * DECISIONS.md open questions 100–102.
 */

export const BATCH_PAGE_SIZE_DEFAULT = 20;
export const BATCH_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export type BatchPageSize = (typeof BATCH_PAGE_SIZE_OPTIONS)[number];

export const BATCH_STATUSES = [
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
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const BATCH_MODES = ["online", "offline", "blended"] as const;
export type BatchMode = (typeof BATCH_MODES)[number];

export const SLA_KEYS = ["accept", "assign", "result"] as const;
export type SlaKey = (typeof SLA_KEYS)[number];

export type BatchSlaLateAction = {
  key: SlaKey;
  reason: string;
  byUserId: string | null;
  at: string;
};

export type BatchSla = {
  acceptDueAt: string | null;
  assignDueAt: string | null;
  resultDueAt: string | null;
  breached: SlaKey[];
  lateActions: BatchSlaLateAction[];
};

export type RecognitionOverride = {
  byUserId: string | null;
  reason: string;
  at: string;
  checks: string[];
};

export type RatioOverride = {
  byUserId: string | null;
  reason: string;
  at: string;
};

export type BatchWarning = {
  code: string;
  message: string;
  details?: unknown;
};

export type StatusHistoryEntry = {
  status?: string;
  at?: string;
  byUserId?: string | null;
  action?: string;
  note?: string;
};

export type BatchRecord = {
  id: string;
  abId: string;
  qualificationId: string;
  type: BatchType;
  mode: BatchMode;
  assessmentStartDate: string;
  assessmentEndDate: string;
  tpId: string;
  centreId: string;
  /** H-01: optional links. Null when the batch is not tagged. */
  schemeId: string | null;
  projectId: string | null;
  candidateCount: number;
  sector: string;
  ratioClass: RatioClass;
  assessmentLanguage: string;
  state: string;
  learnerFeedback: null;
  recognitionOverride: RecognitionOverride | null;
  status: BatchStatus;
  statusVersion: number;
  assessorId: string | null;
  proctorId: string | null;
  resultId: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  isReassessment: boolean;
  reassessmentOf: string | null;
  firstAssessmentBatchId: string | null;
  sla: BatchSla;
  ratioOverride: RatioOverride | null;
  accommodations: string[];
  allocatedAt: string | null;
  acceptedAt: string | null;
  assignedAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  warnings?: BatchWarning[];
  statusHistory?: StatusHistoryEntry[];
};

export type BatchListQuery = {
  status?: BatchStatus;
  from?: string;
  to?: string;
  tpId?: string;
  schemeId?: string;
  projectId?: string;
  page?: number;
  pageSize?: number;
};

export type BatchListPage = {
  page: number;
  pageSize: number;
  total: number;
  items: BatchRecord[];
};

export type CreateBatchInput = {
  abId: string;
  qualificationId: string;
  type: BatchType;
  mode: BatchMode;
  assessmentStartDate: string;
  assessmentEndDate: string;
  tpId: string;
  centreId: string;
  schemeId?: string;
  projectId?: string;
  candidateCount: number;
  assessmentLanguage: string;
  recognitionOverrideReason?: string;
};

export type AcceptBatchInput = {
  lateReason?: string;
};

export type RejectBatchInput = {
  reason: string;
  lateReason?: string;
};

export type ReasonBatchInput = {
  reason: string;
};

export type AssignBatchInput = {
  assessorId: string;
  proctorId?: string | null;
  ratioOverrideReason?: string;
  languageOverrideReason?: string;
  lateReason?: string;
};

function responseError(): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", "Batch response was not recognised.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) return null;
  return value;
}

function requiredString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function isBatchStatus(value: string): value is BatchStatus {
  return (BATCH_STATUSES as readonly string[]).includes(value);
}

function isBatchMode(value: string): value is BatchMode {
  return (BATCH_MODES as readonly string[]).includes(value);
}

function isSlaKey(value: string): value is SlaKey {
  return (SLA_KEYS as readonly string[]).includes(value);
}

export function isBatchPageSize(value: number): value is BatchPageSize {
  return (BATCH_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function isBatchStatusValue(value: string): value is BatchStatus {
  return isBatchStatus(value);
}

function parseSla(value: unknown): BatchSla {
  if (!isRecord(value)) throw responseError();
  const acceptDueAt = optionalNullableString(value.acceptDueAt);
  const assignDueAt = optionalNullableString(value.assignDueAt);
  const resultDueAt = optionalNullableString(value.resultDueAt);
  if (acceptDueAt === undefined || assignDueAt === undefined || resultDueAt === undefined) throw responseError();
  if (!Array.isArray(value.breached)) throw responseError();
  const breached = value.breached.filter((item): item is SlaKey => typeof item === "string" && isSlaKey(item));
  const lateSource = value.lateActions === undefined ? [] : value.lateActions;
  if (!Array.isArray(lateSource)) throw responseError();
  const lateActions = lateSource.map((row) => {
    if (!isRecord(row) || typeof row.key !== "string" || !isSlaKey(row.key)) throw responseError();
    if (typeof row.reason !== "string") throw responseError();
    const byUserId = optionalNullableString(row.byUserId);
    const at = requiredString(row.at);
    if (byUserId === undefined || !at) throw responseError();
    return { key: row.key, reason: row.reason, byUserId, at };
  });
  return { acceptDueAt, assignDueAt, resultDueAt, breached, lateActions };
}

function parseRecognitionOverride(value: unknown): RecognitionOverride | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.reason !== "string" || typeof value.at !== "string") throw responseError();
  const byUserId = optionalNullableString(value.byUserId);
  if (byUserId === undefined) throw responseError();
  const checks = Array.isArray(value.checks)
    ? value.checks.filter((item): item is string => typeof item === "string")
    : [];
  return { byUserId, reason: value.reason, at: value.at, checks };
}

function parseRatioOverride(value: unknown): RatioOverride | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.reason !== "string" || typeof value.at !== "string") throw responseError();
  const byUserId = optionalNullableString(value.byUserId);
  if (byUserId === undefined) throw responseError();
  return { byUserId, reason: value.reason, at: value.at };
}

function parseWarnings(value: unknown): BatchWarning[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw responseError();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.code !== "string" || typeof item.message !== "string") throw responseError();
    return { code: item.code, message: item.message, details: item.details };
  });
}

function parseStatusHistory(value: unknown): StatusHistoryEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw responseError();
  return value.map((item) => {
    if (!isRecord(item)) throw responseError();
    const entry: StatusHistoryEntry = {};
    if (typeof item.status === "string") entry.status = item.status;
    if (typeof item.at === "string") entry.at = item.at;
    if (item.byUserId === null || typeof item.byUserId === "string") entry.byUserId = item.byUserId;
    if (typeof item.action === "string") entry.action = item.action;
    if (typeof item.note === "string") entry.note = item.note;
    return entry;
  });
}

export function parseBatch(value: unknown): BatchRecord {
  if (!isRecord(value)) throw responseError();
  const id = requiredString(value.id);
  const abId = requiredString(value.abId);
  const qualificationId = requiredString(value.qualificationId);
  if (!id || !abId || !qualificationId) throw responseError();
  if (typeof value.type !== "string" || !(BATCH_TYPES as readonly string[]).includes(value.type)) throw responseError();
  if (typeof value.mode !== "string" || !isBatchMode(value.mode)) throw responseError();
  const assessmentStartDate = requiredString(value.assessmentStartDate);
  const assessmentEndDate = requiredString(value.assessmentEndDate);
  const tpId = requiredString(value.tpId);
  const centreId = requiredString(value.centreId);
  const candidateCount = wholeNumber(value.candidateCount, 1);
  const sector = requiredString(value.sector);
  if (typeof value.ratioClass !== "string" || !isRatioClass(value.ratioClass)) throw responseError();
  const assessmentLanguage = requiredString(value.assessmentLanguage);
  const state = requiredString(value.state);
  if (
    !assessmentStartDate ||
    !assessmentEndDate ||
    !tpId ||
    !centreId ||
    candidateCount === null ||
    !sector ||
    !assessmentLanguage ||
    !state
  ) {
    throw responseError();
  }
  if (value.learnerFeedback !== null) throw responseError();
  if (typeof value.status !== "string" || !isBatchStatus(value.status)) throw responseError();
  const statusVersion = wholeNumber(value.statusVersion, 1);
  if (statusVersion === null) throw responseError();
  const assessorId = nullableString(value.assessorId);
  const proctorId = nullableString(value.proctorId);
  const resultId = nullableString(value.resultId);
  if (assessorId === undefined || proctorId === undefined || resultId === undefined) throw responseError();
  const rejectReason = optionalNullableString(value.rejectReason);
  const cancelReason = optionalNullableString(value.cancelReason);
  if (rejectReason === undefined || cancelReason === undefined) throw responseError();
  if (typeof value.isReassessment !== "boolean") throw responseError();
  const reassessmentOf = nullableString(value.reassessmentOf ?? null);
  const firstAssessmentBatchId = nullableString(value.firstAssessmentBatchId ?? null);
  if (reassessmentOf === undefined || firstAssessmentBatchId === undefined) throw responseError();
  const schemeId = nullableString(value.schemeId ?? null);
  const projectId = nullableString(value.projectId ?? null);
  if (schemeId === undefined || projectId === undefined) throw responseError();
  const sla = parseSla(value.sla);
  const accommodations = Array.isArray(value.accommodations)
    ? value.accommodations.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id,
    abId,
    qualificationId,
    type: value.type as BatchType,
    mode: value.mode,
    assessmentStartDate,
    assessmentEndDate,
    tpId,
    centreId,
    schemeId,
    projectId,
    candidateCount,
    sector,
    ratioClass: value.ratioClass,
    assessmentLanguage,
    state,
    learnerFeedback: null,
    recognitionOverride: parseRecognitionOverride(value.recognitionOverride),
    status: value.status,
    statusVersion,
    assessorId,
    proctorId,
    resultId,
    rejectReason,
    cancelReason,
    isReassessment: value.isReassessment,
    reassessmentOf,
    firstAssessmentBatchId,
    sla,
    ratioOverride: parseRatioOverride(value.ratioOverride),
    accommodations,
    allocatedAt: optionalNullableString(value.allocatedAt) ?? null,
    acceptedAt: optionalNullableString(value.acceptedAt) ?? null,
    assignedAt: optionalNullableString(value.assignedAt) ?? null,
    cancelledAt: optionalNullableString(value.cancelledAt) ?? null,
    createdAt: optionalNullableString(value.createdAt) ?? null,
    updatedAt: optionalNullableString(value.updatedAt) ?? null,
    warnings: parseWarnings(value.warnings),
    statusHistory: parseStatusHistory(value.statusHistory),
  };
}

function parseBatchList(value: unknown): BatchListPage {
  if (!isRecord(value) || !Array.isArray(value.items)) throw responseError();
  const page = wholeNumber(value.page, 1);
  const pageSize = wholeNumber(value.pageSize, 1);
  const total = wholeNumber(value.total, 0);
  if (page === null || pageSize === null || total === null) throw responseError();
  return {
    page,
    pageSize,
    total,
    items: value.items.map((item) => parseBatch(item)),
  };
}

export async function listBatches(query: BatchListQuery, signal?: AbortSignal): Promise<BatchListPage> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.tpId) params.set("tpId", query.tpId);
  if (query.schemeId) params.set("schemeId", query.schemeId);
  if (query.projectId) params.set("projectId", query.projectId);
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  const pageSize = query.pageSize && isBatchPageSize(query.pageSize) ? query.pageSize : BATCH_PAGE_SIZE_DEFAULT;
  params.set("pageSize", String(pageSize));
  const body = await apiRequest<unknown>(`/batches?${params.toString()}`, { signal });
  return parseBatchList(body);
}

export async function getBatch(id: string, signal?: AbortSignal): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}`, { signal });
  return parseBatch(body);
}

export async function createBatch(input: CreateBatchInput): Promise<BatchRecord> {
  const body = await apiRequest<unknown>("/batches", { method: "POST", body: input });
  return parseBatch(body);
}

export async function acceptBatch(id: string, input: AcceptBatchInput = {}): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}/accept`, {
    method: "POST",
    body: input,
  });
  return parseBatch(body);
}

export async function rejectBatch(id: string, input: RejectBatchInput): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: input,
  });
  return parseBatch(body);
}

export async function cancelBatch(id: string, input: ReasonBatchInput): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: input,
  });
  return parseBatch(body);
}

export async function completeBatch(id: string, input: ReasonBatchInput): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: input,
  });
  return parseBatch(body);
}

export async function assignBatch(id: string, input: AssignBatchInput): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}/assign`, {
    method: "POST",
    body: input,
  });
  return parseBatch(body);
}

export async function reassignBatch(id: string, input: AssignBatchInput): Promise<BatchRecord> {
  const body = await apiRequest<unknown>(`/batches/${encodeURIComponent(id)}/reassign`, {
    method: "POST",
    body: input,
  });
  return parseBatch(body);
}
