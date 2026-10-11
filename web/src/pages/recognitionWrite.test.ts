import { expect, it } from "vitest";
import { buildRecognition, emptyRecognitionDraft } from "./recognitionWrite";

function draft(overrides: Partial<ReturnType<typeof emptyRecognitionDraft>> = {}) {
  return {
    ...emptyRecognitionDraft(),
    sectors: ["Electronics", "Construction"],
    states: ["Maharashtra"],
    startDate: "2026-04-01",
    endDate: "2029-03-31",
    ...overrides,
  };
}

it("sends selected states when the agency is not PAN India", () => {
  const result = buildRecognition(draft({ states: ["Gujarat", "Maharashtra", "not-a-state"] }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.body).toEqual({
    sectors: ["Construction", "Electronics"],
    panIndia: false,
    states: ["Gujarat", "Maharashtra"],
    startDate: "2026-04-01",
    endDate: "2029-03-31",
  });
});

it("sends an empty state list for PAN India", () => {
  const result = buildRecognition(draft({ panIndia: true, states: ["Maharashtra"] }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.body.panIndia).toBe(true);
  expect(result.body.states).toEqual([]);
});

it("requires a sector, a state unless PAN India, and an end date on or after the start", () => {
  const missing = buildRecognition(draft({ sectors: [], states: [], startDate: "", endDate: "2026-02-31" }));
  expect(missing.ok).toBe(false);
  if (!missing.ok) {
    expect(missing.message).toContain("Choose at least one recognised sector.");
    expect(missing.message).toContain("Choose at least one state, or choose PAN India.");
    expect(missing.message).toContain("Enter a start date.");
    expect(missing.message).toContain("Enter an end date.");
    expect(missing.fields).toEqual(["sectors", "states", "startDate", "endDate"]);
  }

  const order = buildRecognition(draft({ startDate: "2029-04-01", endDate: "2026-04-01" }));
  expect(order.ok).toBe(false);
  if (!order.ok) {
    expect(order.message).toContain("The end date must be on or after the start date.");
    expect(order.fields).toEqual(["endDate"]);
  }

  const panIndia = buildRecognition(draft({ panIndia: true, states: [], sectors: ["Electronics"] }));
  expect(panIndia.ok).toBe(true);
});
