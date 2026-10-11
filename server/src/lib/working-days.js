import { compliance } from "../config/compliance.js";
import { Holiday } from "../models/holiday.model.js";
import { WORKING_DAY_CONFIG_KEY, WorkingDayConfig } from "../models/working-day-config.model.js";

/**
 * Working-day counting. docs/SCHEMA.md §2.1.
 *
 * 1. Convert the anchor instant to an IST civil date D0.
 * 2. Counting starts on the next working day after D0 (the anchor date is not day 1).
 * 3. A working day is a weekday outside `weekendDays` and outside applicable holidays.
 *    `region: null` holidays are AA-wide. A regional holiday applies only for that region.
 * 4. After N working days the due instant is the end of that IST civil date, stored as UTC.
 * 5. "N working days before E" is the end of the working day N working days before E (E exclusive).
 *
 * Weekend days come from workingDayConfig (or WEEKEND_DAYS when no row is stored).
 * Holidays come from the holidays collection. Pass an explicit calendar to skip the read.
 * Search bound is a loop guard, not an SLA constant.
 */
const MAX_CALENDAR_SPAN_DAYS = 4000;

const istDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: compliance.TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD calendar date, rejecting impossible days such as 2026-02-31. */
export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

/**
 * Weekend days and holidays for SLA math.
 * When `region` is omitted, only AA-wide holidays (`region: null`) are included.
 * @param {{ region?: string|null }} [options]
 */
export async function loadWorkingCalendar({ region } = {}) {
  const config = await WorkingDayConfig.findOne({ key: WORKING_DAY_CONFIG_KEY }).lean();
  const scoped = region ? region : null;
  const rows = await Holiday.find(
    scoped ? { $or: [{ region: null }, { region: scoped }] } : { region: null },
  )
    .select({ date: 1, region: 1 })
    .lean();

  return {
    weekendDays: config ? [...config.weekendDays] : [...compliance.WEEKEND_DAYS],
    holidays: rows.map((row) => ({ date: row.date, region: row.region ?? null })),
    region: scoped,
  };
}

/**
 * @param {Date|string} date civil date or instant
 * @param {object} [calendar]
 */
export async function isWorkingDay(date, calendar) {
  const prepared = prepareCalendar(await resolveCalendar(calendar));
  return civilIsWorking(toCivilDate(date), prepared);
}

/**
 * End of the Nth working day after the anchor. SCHEMA §2.1 steps 1–4.
 * @param {Date|string} anchor
 * @param {number} workingDays
 * @param {object} [calendar]
 * @returns {Promise<Date>}
 */
export async function addWorkingDays(anchor, workingDays, calendar) {
  return moveWorkingDays(anchor, workingDays, await resolveCalendar(calendar), 1);
}

/**
 * End of the working day N working days before the anchor. SCHEMA §2.1 step 5.
 * The anchor date is exclusive.
 * @param {Date|string} anchor
 * @param {number} workingDays
 * @param {object} [calendar]
 * @returns {Promise<Date>}
 */
export async function subtractWorkingDays(anchor, workingDays, calendar) {
  return moveWorkingDays(anchor, workingDays, await resolveCalendar(calendar), -1);
}

/**
 * Accept/reject due instant. NCVET:FR §F. Anchor is the allocation instant.
 * @param {Date|string} allocatedAt
 * @param {object} [calendar]
 */
export async function acceptDueAt(allocatedAt, calendar) {
  return addWorkingDays(allocatedAt, compliance.ACCEPT_REJECT_WORKING_DAYS, calendar);
}

/**
 * Assign due instant. Guidelines Table 7; NCVET:FR §F. docs/SCHEMA.md §2.3.
 * STT counts forward from `allocatedAt`. LTT counts back from `assessmentStartDate`.
 * @param {{ type: "STT"|"LTT", allocatedAt?: Date|string, assessmentStartDate?: string, region?: string|null }} input
 * @param {object} [calendar] when omitted, loaded for `input.region` (AA-wide if unset)
 */
export async function assignDueAt(input, calendar) {
  const cal = await resolveCalendar(calendar, input?.region);
  if (input?.type === "STT") {
    if (!input.allocatedAt) throw new TypeError("allocatedAt is required for an STT assign due");
    return moveWorkingDays(input.allocatedAt, compliance.ASSIGN_AFTER_ALLOCATION_WD_STT, cal, 1);
  }
  if (input?.type === "LTT") {
    if (!input.assessmentStartDate) {
      throw new TypeError("assessmentStartDate is required for an LTT assign due");
    }
    return moveWorkingDays(
      input.assessmentStartDate,
      compliance.ASSIGN_BEFORE_EXAM_WD_LTT,
      cal,
      -1,
    );
  }
  throw new TypeError(`Unknown batch type: ${input?.type}`);
}

/**
 * Result submission due instant. Guidelines Table 7; NCVET:FR §F. docs/SCHEMA.md §2.3.
 * STT counts forward from `assessmentEndDate`. LTT counts forward from the exam date
 * (`assessmentStartDate`). There is no single anchor switch.
 * @param {{ type: "STT"|"LTT", assessmentEndDate?: string, assessmentStartDate?: string, region?: string|null }} input
 * @param {object} [calendar]
 */
export async function resultDueAt(input, calendar) {
  const cal = await resolveCalendar(calendar, input?.region);
  if (input?.type === "STT") {
    if (!input.assessmentEndDate) {
      throw new TypeError("assessmentEndDate is required for an STT result due");
    }
    return moveWorkingDays(input.assessmentEndDate, compliance.RESULT_SUBMIT_WD_STT, cal, 1);
  }
  if (input?.type === "LTT") {
    if (!input.assessmentStartDate) {
      throw new TypeError("assessmentStartDate is required for an LTT result due");
    }
    return moveWorkingDays(input.assessmentStartDate, compliance.RESULT_SUBMIT_WD_LTT, cal, 1);
  }
  throw new TypeError(`Unknown batch type: ${input?.type}`);
}

/** IST civil date (`YYYY-MM-DD`) of an instant. docs/SCHEMA.md §2.1 step 1. */
export function istCalendarDate(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid anchor instant");
  return istCivilDate(date);
}

async function resolveCalendar(calendar, region) {
  if (calendar) return calendar;
  return loadWorkingCalendar({ region: region ?? null });
}

function moveWorkingDays(anchor, workingDays, calendar, direction) {
  assertWorkingDayCount(workingDays);
  const prepared = prepareCalendar(calendar);
  let cursor = toCivilDate(anchor);
  let seen = 0;
  for (let span = 0; span < MAX_CALENDAR_SPAN_DAYS; span += 1) {
    cursor = shiftIsoDate(cursor, direction);
    if (!civilIsWorking(cursor, prepared)) continue;
    seen += 1;
    if (seen === workingDays) return endOfIstDay(cursor);
  }
  throw new Error("No working day within the search window");
}

function assertWorkingDayCount(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError("Working-day count must be a positive integer");
  }
}

function prepareCalendar(calendar) {
  const weekendDays = new Set(calendar?.weekendDays ?? compliance.WEEKEND_DAYS);
  const region = calendar?.region ?? null;
  const holidays = new Set();
  for (const holiday of calendar?.holidays ?? []) {
    const date = applicableHolidayDate(holiday, region);
    if (date) holidays.add(date);
  }
  return { weekendDays, holidays };
}

function applicableHolidayDate(holiday, region) {
  if (typeof holiday === "string") return holiday;
  if (!holiday?.date) return null;
  const holidayRegion = holiday.region ?? null;
  if (holidayRegion == null) return holiday.date;
  if (region != null && holidayRegion === region) return holiday.date;
  return null;
}

function civilIsWorking(isoDate, prepared) {
  if (prepared.weekendDays.has(weekdayIndex(isoDate))) return false;
  if (prepared.holidays.has(isoDate)) return false;
  return true;
}

function toCivilDate(anchor) {
  if (anchor instanceof Date) {
    if (Number.isNaN(anchor.getTime())) throw new TypeError("Invalid anchor instant");
    return istCivilDate(anchor);
  }
  if (typeof anchor === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
      if (!isCalendarDate(anchor)) throw new TypeError("Invalid anchor date");
      return anchor;
    }
    const parsed = new Date(anchor);
    if (Number.isNaN(parsed.getTime())) throw new TypeError("Invalid anchor instant");
    return istCivilDate(parsed);
  }
  throw new TypeError("Anchor must be a Date or an ISO string");
}

function istCivilDate(instant) {
  const bag = {};
  for (const part of istDateFormatter.formatToParts(instant)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      bag[part.type] = part.value;
    }
  }
  return `${bag.year}-${bag.month}-${bag.day}`;
}

function weekdayIndex(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function shiftIsoDate(isoDate, deltaDays) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function endOfIstDay(isoDate) {
  if (compliance.TIMEZONE !== "Asia/Kolkata") {
    throw new Error("Working-day end-of-day is implemented for Asia/Kolkata only");
  }
  return new Date(`${isoDate}T23:59:59.999+05:30`);
}
