import { ApiError, apiRequest } from "./client";

export type AnalyticsDimension =
  "assessor" | "training-partner" | "job-role" | "state";

export type AnalyticsSummary = {
  from: string;
  to: string;
  batches: { total: number; byStatus: Record<string, number> };
  publishedResults: { total: number; onTime: number; late: number };
  learnersAssessed: number;
  passRate: number | null;
  slaBreaches: number;
};

export type AnalyticsRow = {
  id: string;
  name: string | null;
  code: string | null;
  batches: number;
  publishedBatches: number;
  learnersAssessed: number;
  passed: number;
  failed: number;
  absent: number;
  passRate: number | null;
  avgTurnaroundDays: number | null;
  slaBreaches: number;
};

export type AnalyticsPage = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  items: AnalyticsRow[];
};

export const DIMENSION_PATH: Record<AnalyticsDimension, string> = {
  assessor: "by-assessor",
  "training-partner": "by-training-partner",
  "job-role": "by-job-role",
  state: "by-state",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function rate(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function invalid(what: string): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    `Analytics ${what} response was not recognised.`,
  );
}

export function parseSummary(value: unknown): AnalyticsSummary {
  if (
    !isRecord(value) ||
    !isRecord(value.batches) ||
    !isRecord(value.publishedResults)
  )
    throw invalid("summary");
  const { batches, publishedResults } = value;
  const total = count(batches.total);
  const pubTotal = count(publishedResults.total);
  const onTime = count(publishedResults.onTime);
  const late = count(publishedResults.late);
  const learnersAssessed = count(value.learnersAssessed);
  const slaBreaches = count(value.slaBreaches);
  const passRate = rate(value.passRate);
  if (
    total === null ||
    pubTotal === null ||
    onTime === null ||
    late === null ||
    learnersAssessed === null ||
    slaBreaches === null ||
    passRate === undefined ||
    !isRecord(batches.byStatus) ||
    typeof value.from !== "string" ||
    typeof value.to !== "string"
  ) {
    throw invalid("summary");
  }
  const byStatus: Record<string, number> = {};
  for (const [key, entry] of Object.entries(batches.byStatus)) {
    const n = count(entry);
    if (n === null) throw invalid("summary");
    byStatus[key] = n;
  }
  return {
    from: value.from,
    to: value.to,
    batches: { total, byStatus },
    publishedResults: { total: pubTotal, onTime, late },
    learnersAssessed,
    passRate,
    slaBreaches,
  };
}

function parseRow(value: unknown): AnalyticsRow {
  if (!isRecord(value) || typeof value.id !== "string") throw invalid("list");
  const name =
    value.name === null || typeof value.name === "string"
      ? (value.name as string | null)
      : undefined;
  const code =
    value.code === null || typeof value.code === "string"
      ? (value.code as string | null)
      : undefined;
  const batches = count(value.batches);
  const publishedBatches = count(value.publishedBatches);
  const learnersAssessed = count(value.learnersAssessed);
  const passed = count(value.passed);
  const failed = count(value.failed);
  const absent = count(value.absent);
  const slaBreaches = count(value.slaBreaches);
  const passRate = rate(value.passRate);
  const avg = rate(value.avgTurnaroundDays);
  if (
    name === undefined ||
    code === undefined ||
    batches === null ||
    publishedBatches === null ||
    learnersAssessed === null ||
    passed === null ||
    failed === null ||
    absent === null ||
    slaBreaches === null ||
    passRate === undefined ||
    avg === undefined
  ) {
    throw invalid("list");
  }
  return {
    id: value.id,
    name,
    code,
    batches,
    publishedBatches,
    learnersAssessed,
    passed,
    failed,
    absent,
    passRate,
    avgTurnaroundDays: avg,
    slaBreaches,
  };
}

export function parseAnalyticsPage(value: unknown): AnalyticsPage {
  if (!isRecord(value) || !Array.isArray(value.items)) throw invalid("list");
  const page = count(value.page);
  const pageSize = count(value.pageSize);
  const total = count(value.total);
  if (
    page === null ||
    pageSize === null ||
    total === null ||
    typeof value.from !== "string" ||
    typeof value.to !== "string"
  ) {
    throw invalid("list");
  }
  return {
    from: value.from,
    to: value.to,
    page,
    pageSize,
    total,
    items: value.items.map(parseRow),
  };
}

export async function getAnalyticsSummary(
  range: { from: string; to: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  return parseSummary(
    await apiRequest<unknown>(`/analytics/summary?${params.toString()}`, {
      signal,
    }),
  );
}

export async function listAnalytics(
  dimension: AnalyticsDimension,
  query: { from: string; to: string; page: number; pageSize: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  return parseAnalyticsPage(
    await apiRequest<unknown>(
      `/analytics/${DIMENSION_PATH[dimension]}?${params.toString()}`,
      { signal },
    ),
  );
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The last 90 calendar days ending today (IST), both ends inclusive. */
export function defaultRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const to = istToday(now);
  const start = parseDate(to) as Date;
  start.setUTCDate(start.getUTCDate() - 89);
  return { from: start.toISOString().slice(0, 10), to };
}

/** Mirrors the server: both dates real, from <= to, and `to` before `from` plus 3 years. */
export function validateRange(from: string, to: string): string | null {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return "Enter both dates as real calendar dates.";
  if (start > end) return "The From date must be on or before the To date.";
  const limit = new Date(start);
  limit.setUTCFullYear(limit.getUTCFullYear() + 3);
  if (end >= limit) return "The range must be shorter than 3 years.";
  return null;
}
