import { SECTOR_NAMES, STATE_UTS } from "../src/config/annexure.js";
import { recognitionFailures } from "../src/modules/recognition/recognition.service.js";

const inside = {
  sectors: ["Electronics", "Construction"],
  panIndia: false,
  states: ["Maharashtra", "Gujarat"],
  startDate: "2026-04-01",
  endDate: "2026-04-01",
};

describe("recognition scope", () => {
  it("keeps the Annexure II and Annexure IV lists, including printed spellings", () => {
    expect(SECTOR_NAMES).toHaveLength(59);
    expect(new Set(SECTOR_NAMES).size).toBe(59);
    expect(SECTOR_NAMES).toEqual(
      expect.arrayContaining(["Electronics", "Gems/Jewel", "Wood & Carp."]),
    );
    expect(STATE_UTS).toHaveLength(36);
    expect(new Set(STATE_UTS).size).toBe(36);
    expect(STATE_UTS).toEqual(
      expect.arrayContaining(["Maharashtra", "Himachal", "J and K", "Chattisgarh", "Orissa"]),
    );
  });

  it("reports sector, state, and inclusive IST recognition dates", () => {
    const onStart = new Date("2026-03-31T18:30:00.000Z");
    const onEnd = new Date("2026-04-01T18:29:59.999Z");
    const before = new Date("2026-03-31T18:29:59.999Z");
    const after = new Date("2026-04-01T18:30:00.000Z");
    const batch = { sector: "Electronics", state: "Maharashtra" };

    expect(recognitionFailures(null, { ...batch, now: onStart })).toEqual(["unconfigured"]);
    expect(recognitionFailures(inside, { ...batch, now: onStart })).toEqual([]);
    expect(recognitionFailures(inside, { ...batch, now: onEnd })).toEqual([]);
    expect(recognitionFailures(inside, { ...batch, now: before })).toEqual(["not_started"]);
    expect(recognitionFailures(inside, { ...batch, now: after })).toEqual(["expired"]);
    expect(
      recognitionFailures(inside, {
        sector: "Food",
        state: "Kerala",
        now: onStart,
      }),
    ).toEqual(["sector", "state"]);
    expect(
      recognitionFailures(
        { ...inside, panIndia: true, states: [] },
        { sector: "Electronics", state: "Kerala", now: onStart },
      ),
    ).toEqual([]);
  });
});
