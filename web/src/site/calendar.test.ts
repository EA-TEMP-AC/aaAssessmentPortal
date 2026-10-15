import { expect, it } from "vitest";
import { currentMonthIst, daysInMonth, eventDaysInMonth, parseMonth, shiftMonth } from "./calendar";

it("moves across year boundaries", () => {
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
});

it("uses the IST month near midnight", () => {
  expect(currentMonthIst(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11");
});

it("falls back to the current month for a bad value", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  expect(parseMonth("2026-13", now)).toBe("2026-10");
  expect(parseMonth(null, now)).toBe("2026-10");
  expect(parseMonth("2026-02", now)).toBe("2026-02");
});

it("handles leap February and multi-day events", () => {
  expect(daysInMonth("2028-02")).toBe(29);
  const days = eventDaysInMonth({ id: "1", title: "x", date: "2026-09-29", endDate: "2026-10-02" }, "2026-10");
  expect(days).toEqual([1, 2]);
});
