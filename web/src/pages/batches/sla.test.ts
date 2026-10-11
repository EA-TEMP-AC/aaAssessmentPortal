import { expect, it } from "vitest";
import { batchRecord } from "../../test/batchFixtures";
import { describeSlaStep, formatCountdown, openSlaKeys, slaTone } from "./sla";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

it("treats accept and assign as open while allocated", () => {
  expect(openSlaKeys("allocated")).toEqual(["accept", "assign"]);
  expect(openSlaKeys("accepted")).toEqual(["assign"]);
  expect(openSlaKeys("assessment_completed")).toEqual(["result"]);
  expect(openSlaKeys("published")).toEqual([]);
});

it("marks a step overdue only after the stored due instant", () => {
  expect(slaTone("2026-10-12T12:00:00.000Z", NOW, true)).toBe("ok");
  expect(slaTone("2026-10-12T11:59:59.999Z", NOW, true)).toBe("overdue");
  expect(slaTone("2026-10-13T11:00:00.000Z", NOW, true)).toBe("soon");
  expect(slaTone("2026-11-01T00:00:00.000Z", NOW, true)).toBe("ok");
  expect(slaTone("2026-10-12T11:59:59.999Z", NOW, false)).toBe("closed");
});

it("formats remaining and overdue countdowns", () => {
  expect(formatCountdown("2026-10-14T12:00:00.000Z", NOW)).toBe("2 days left");
  expect(formatCountdown("2026-10-12T11:00:00.000Z", NOW)).toBe("Overdue by 1 hour");
  expect(formatCountdown("2026-10-12T12:00:00.000Z", NOW)).toBe("Due now, on time");
  expect(formatCountdown(null, NOW)).toBe("No due time stored");
});

it("uses the stored per-type due instants on the batch", () => {
  const batch = batchRecord({
    status: "allocated",
    sla: {
      acceptDueAt: "2026-10-12T18:29:59.999Z",
      assignDueAt: "2026-10-19T18:29:59.999Z",
      resultDueAt: "2026-11-25T18:29:59.999Z",
      breached: ["accept"],
      lateActions: [],
    },
  });
  const accept = describeSlaStep(batch, "accept", NOW);
  const assign = describeSlaStep(batch, "assign", NOW);
  const result = describeSlaStep(batch, "result", NOW);
  expect(accept.tone).toBe("soon");
  expect(accept.breached).toBe(true);
  expect(assign.tone).toBe("ok");
  expect(assign.countdown).toContain("left");
  expect(result.tone).toBe("closed");
});
