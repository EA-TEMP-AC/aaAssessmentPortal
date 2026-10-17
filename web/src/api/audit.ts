import { apiRequest, ApiError } from "./client";

export type AuditLogQuery = {
  entity?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
};

export type AuditLogItem = {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  abId: string | null;
  batchId: string | null;
  batchLabel: string | null;
  /** X-20: the batch label when the row is about a batch; staff are shown by id, not name. */
  entityLabel: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  createdAt: string;
};

export type AuditLogPage = {
  page: number;
  pageSize: number;
  total: number;
  items: AuditLogItem[];
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `GET /audit-logs` accepts `from` and `to` as instants. The contract does not
 * define a calendar-day boundary, so a date input becomes the viewer's local
 * day: start of `from`, end of `to`. See DECISIONS.md open question 38.
 */
export function localDayBound(
  date: string,
  bound: "start" | "end",
): string | null {
  const match = DATE_ONLY.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value =
    bound === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day
  ) {
    return null;
  }
  return value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function wholeNumber(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    return null;
  return value;
}

function parseItem(value: unknown): AuditLogItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.action !== "string" || value.action.length === 0)
    return null;
  if (typeof value.entity !== "string" || value.entity.length === 0)
    return null;
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0)
    return null;

  const actorId = nullableString(value.actorId);
  const actorRole = nullableString(value.actorRole);
  const entityId = nullableString(value.entityId);
  const abId = nullableString(value.abId);
  const batchId = nullableString(value.batchId);
  const ip = nullableString(value.ip);
  if (
    actorId === undefined ||
    actorRole === undefined ||
    entityId === undefined ||
    abId === undefined ||
    batchId === undefined ||
    ip === undefined
  ) {
    return null;
  }

  return {
    id: value.id,
    actorId,
    actorRole,
    action: value.action,
    entity: value.entity,
    entityId,
    abId,
    batchId,
    batchLabel: nonEmptyText(value.batchLabel),
    entityLabel: nonEmptyText(value.entityLabel),
    before: value.before ?? null,
    after: value.after ?? null,
    meta: value.meta ?? null,
    ip,
    createdAt: value.createdAt,
  };
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function parseAuditLogPage(value: unknown): AuditLogPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "Audit log response was not recognised.",
    );
  }
  const page = wholeNumber(value.page, 1);
  const pageSize = wholeNumber(value.pageSize, 1);
  const total = wholeNumber(value.total, 0);
  if (page === null || pageSize === null || total === null) {
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "Audit log response was not recognised.",
    );
  }
  const items: AuditLogItem[] = [];
  for (const item of value.items) {
    const parsed = parseItem(item);
    if (!parsed) {
      throw new ApiError(
        502,
        "INVALID_RESPONSE",
        "Audit log response was not recognised.",
      );
    }
    items.push(parsed);
  }
  return { page, pageSize, total, items };
}

/** Contract query: entity, entityId, from, to, page. pageSize is response-only. */
export async function listAuditLogs(
  query: AuditLogQuery,
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  const entity = query.entity?.trim();
  const entityId = query.entityId?.trim();
  if (entity) params.set("entity", entity);
  if (entityId) params.set("entityId", entityId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const page = query.page && query.page > 0 ? query.page : 1;
  params.set("page", String(page));

  const body = await apiRequest<unknown>(`/audit-logs?${params.toString()}`, {
    signal,
  });
  return parseAuditLogPage(body);
}
