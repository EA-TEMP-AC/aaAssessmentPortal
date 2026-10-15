import type { PublicEvent } from "./publicApi";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function currentMonthIst(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60_000);
  return ist.toISOString().slice(0, 7);
}

export function parseMonth(value: string | null, now?: Date): string {
  return value && MONTH_PATTERN.test(value) ? value : currentMonthIst(now);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (mon - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/** 0 = Sunday. */
export function firstWeekday(month: string): number {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
}

export function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function dayLabel(date: string): string {
  const [year, mon, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, mon - 1, day)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function eventDateRange(event: PublicEvent): string {
  const start = dateOnly(event.date);
  const end = event.endDate ? dateOnly(event.endDate) : start;
  return end > start ? `${dayLabel(start)} to ${dayLabel(end)}` : dayLabel(start);
}

/** Day numbers (1-based) of the month that an event covers. */
export function eventDaysInMonth(event: PublicEvent, month: string): number[] {
  const start = dateOnly(event.date);
  const end = event.endDate ? dateOnly(event.endDate) : start;
  const total = daysInMonth(month);
  const days: number[] = [];
  for (let day = 1; day <= total; day += 1) {
    const key = `${month}-${String(day).padStart(2, "0")}`;
    if (key >= start && key <= end) days.push(day);
  }
  return days;
}
