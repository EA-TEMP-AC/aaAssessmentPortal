import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExamClock } from "./useExamClock";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const SERVER = "2026-10-16T10:00:00.000Z";

it("counts down from the server deadline", () => {
  const { result } = renderHook(() =>
    useExamClock("2026-10-16T10:01:00.000Z", SERVER),
  );
  expect(result.current).toBe(60);
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(result.current).toBe(50);
});

it("stands still while the clock is held, and carries on from the new deadline (X-12)", () => {
  const { result, rerender } = renderHook(
    ({ deadline, held }) => useExamClock(deadline, SERVER, held),
    { initialProps: { deadline: "2026-10-16T10:01:00.000Z", held: false } },
  );
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(result.current).toBe(50);

  rerender({ deadline: "2026-10-16T10:01:00.000Z", held: true });
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(result.current).toBe(50);

  // The unlock moved the deadline out by the 30 seconds that were paused.
  rerender({ deadline: "2026-10-16T10:01:30.000Z", held: false });
  expect(result.current).toBe(50);
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(result.current).toBe(45);
});
