import { ApiError } from "../api/client";
import { joinErrorParts } from "../api/ruleErrors";
import { isCalendarDate, isWeekday, type HolidayWrite, type Weekday } from "../api/workingDays";

/** B-02 createHolidaySchema. */
export const HOLIDAY_NAME_MAX = 200;
export const HOLIDAY_REGION_MAX = 64;

export type HolidayDraft = {
  date: string;
  name: string;
  region: string;
};

export type FieldFailure = {
  message: string;
  fields: string[];
};

const FIELD_LABELS: Record<string, string> = {
  weekendDays: "Weekend days",
  date: "Date",
  name: "Name",
  region: "Region",
  from: "From date",
  to: "To date",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildWeekendDays(days: readonly number[]): { ok: true; weekendDays: Weekday[] } | ({ ok: false } & FieldFailure) {
  const weekendDays: Weekday[] = [];
  const seen = new Set<number>();
  for (const day of days) {
    if (!isWeekday(day) || seen.has(day)) {
      return {
        ok: false,
        message: "Weekend days must be unique days from 0 (Sunday) through 6 (Saturday).",
        fields: ["weekendDays"],
      };
    }
    seen.add(day);
    weekendDays.push(day);
  }
  if (weekendDays.length > 6) {
    return {
      ok: false,
      message: "Leave at least one working day.",
      fields: ["weekendDays"],
    };
  }
  return { ok: true, weekendDays: weekendDays.sort((left, right) => left - right) };
}

export function buildHoliday(draft: HolidayDraft): { ok: true; body: HolidayWrite } | ({ ok: false } & FieldFailure) {
  const fields: string[] = [];
  const messages: string[] = [];
  const date = draft.date.trim();
  const name = draft.name.trim();
  const region = draft.region.trim();

  if (!date) {
    fields.push("date");
    messages.push("Enter a holiday date.");
  } else if (!isCalendarDate(date)) {
    fields.push("date");
    messages.push("Enter a valid holiday date.");
  }

  if (!name) {
    fields.push("name");
    messages.push("Enter a holiday name.");
  } else if (name.length > HOLIDAY_NAME_MAX) {
    fields.push("name");
    messages.push(`Holiday name must be ${HOLIDAY_NAME_MAX} characters or fewer.`);
  }

  if (region.length > HOLIDAY_REGION_MAX) {
    fields.push("region");
    messages.push(`Region must be ${HOLIDAY_REGION_MAX} characters or fewer.`);
  }

  if (fields.length > 0) return { ok: false, message: messages.join(" "), fields };
  return { ok: true, body: { date, name, region: region.length > 0 ? region : null } };
}

export function holidayFilterError(from: string, to: string): FieldFailure | null {
  const fields: string[] = [];
  const messages: string[] = [];
  if (from && !isCalendarDate(from)) {
    fields.push("from");
    messages.push("Enter a valid From date.");
  }
  if (to && !isCalendarDate(to)) {
    fields.push("to");
    messages.push("Enter a valid To date.");
  }
  if (fields.length === 0 && from && to && from > to) {
    fields.push("from", "to");
    messages.push("The From date must be on or before the To date.");
  }
  if (messages.length === 0) return null;
  return { message: messages.join(" "), fields };
}

/** Includes the server code so DUPLICATE_RESOURCE and VALIDATION_ERROR stay visible. */
export function formatWorkingDayError(error: unknown): FieldFailure {
  if (!(error instanceof ApiError)) {
    return { message: "Could not reach the server. Try again.", fields: [] };
  }
  const fields: string[] = [];
  const extras: string[] = [];
  if (isRecord(error.details)) {
    for (const [key, value] of Object.entries(error.details)) {
      if (!Array.isArray(value)) continue;
      const messages = value.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (messages.length === 0) continue;
      if (key in FIELD_LABELS) fields.push(key);
      extras.push(`${FIELD_LABELS[key] ?? key}: ${messages.join(" ")}`);
    }
  }
  return {
    message: joinErrorParts([error.code, error.message, extras.join(" ")]),
    fields,
  };
}
