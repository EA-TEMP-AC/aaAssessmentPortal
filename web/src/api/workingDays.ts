import { ApiError, apiRequest, apiRequestResult } from "./client";

/**
 * GET|PUT /admin/working-day-config and GET|POST|DELETE /admin/holidays.
 * Shapes follow B-02. API_CONTRACT does not list the fields (DECISIONS.md open questions 25–30, 92–94).
 * SCHEMA §2.2: these writes do not recompute due dates already stored on batches.
 */

export const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["value"];

export type WorkingDayConfig = {
  id: string | null;
  weekendDays: Weekday[];
  timezone: string;
};

export type Holiday = {
  id: string;
  date: string;
  name: string;
  region: string | null;
};

export type HolidayList = {
  items: Holiday[];
};

export type HolidayQuery = {
  from?: string;
  to?: string;
};

export type HolidayWrite = {
  date: string;
  name: string;
  region: string | null;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_MAX = 200;
const REGION_MAX = 64;

export function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

function responseError(subject: string): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", `${subject} response was not recognised.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWeekendDays(value: unknown): Weekday[] | null {
  if (!Array.isArray(value) || value.length > 6) return null;
  const days: Weekday[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !isWeekday(item) || days.includes(item)) return null;
    days.push(item);
  }
  return days.sort((left, right) => left - right);
}

export function parseWorkingDayConfig(value: unknown): WorkingDayConfig {
  if (!isRecord(value)) throw responseError("Working-day");
  const weekendDays = parseWeekendDays(value.weekendDays);
  const timezone = typeof value.timezone === "string" && value.timezone.length > 0 ? value.timezone : null;
  if (!weekendDays || !timezone) throw responseError("Working-day");

  let id: string | null = null;
  if ("id" in value && value.id != null) {
    if (typeof value.id !== "string" || value.id.length === 0) throw responseError("Working-day");
    id = value.id;
  }

  return { id, weekendDays, timezone };
}

function parseHoliday(value: unknown): Holiday | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.date !== "string" || !isCalendarDate(value.date)) return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > NAME_MAX) return null;
  if (value.region === null) {
    return { id: value.id, date: value.date, name: value.name, region: null };
  }
  if (typeof value.region !== "string" || value.region.trim().length === 0 || value.region.length > REGION_MAX) {
    return null;
  }
  return { id: value.id, date: value.date, name: value.name, region: value.region };
}

export function parseHolidayList(value: unknown): HolidayList {
  if (!isRecord(value) || !Array.isArray(value.items)) throw responseError("Holiday");
  const items: Holiday[] = [];
  for (const item of value.items) {
    const holiday = parseHoliday(item);
    if (!holiday) throw responseError("Holiday");
    items.push(holiday);
  }
  return { items };
}

export async function getWorkingDayConfig(signal?: AbortSignal): Promise<WorkingDayConfig> {
  const body = await apiRequest<unknown>("/admin/working-day-config", { signal });
  return parseWorkingDayConfig(body);
}

export async function saveWorkingDayConfig(weekendDays: readonly Weekday[]): Promise<WorkingDayConfig> {
  const body = await apiRequest<unknown>("/admin/working-day-config", {
    method: "PUT",
    body: { weekendDays: [...weekendDays] },
  });
  return parseWorkingDayConfig(body);
}

export async function listHolidays(query: HolidayQuery, signal?: AbortSignal): Promise<HolidayList> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const search = params.toString();
  const body = await apiRequest<unknown>(`/admin/holidays${search ? `?${search}` : ""}`, { signal });
  return parseHolidayList(body);
}

export async function createHoliday(input: HolidayWrite): Promise<Holiday> {
  const body = await apiRequest<unknown>("/admin/holidays", { method: "POST", body: input });
  const holiday = parseHoliday(body);
  if (!holiday) throw responseError("Holiday");
  return holiday;
}

export async function deleteHoliday(id: string): Promise<void> {
  const result = await apiRequestResult<undefined>(`/admin/holidays/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (result.status !== 204) throw responseError("Holiday delete");
}
