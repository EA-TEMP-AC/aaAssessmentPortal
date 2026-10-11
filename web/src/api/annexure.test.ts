import { expect, it } from "vitest";
import { SECTOR_NAMES, STATE_NAMES } from "./annexure";

it("keeps the 59 Annexure II sector names, including the printed abbreviations", () => {
  expect(SECTOR_NAMES).toHaveLength(59);
  expect(new Set(SECTOR_NAMES).size).toBe(59);
  expect(SECTOR_NAMES).toContain("Electronics");
  expect(SECTOR_NAMES).toContain("Gems/Jewel");
  expect(SECTOR_NAMES).toContain("Musical Inst.");
  expect(SECTOR_NAMES).toContain("Org. Retail");
  expect(SECTOR_NAMES).toContain("Religious Prof.");
  expect(SECTOR_NAMES).toContain("Unorg. Sector");
  expect(SECTOR_NAMES).toContain("Wood & Carp.");
  expect(SECTOR_NAMES).not.toContain("manufacturing");
});

it("keeps the 36 Annexure IV state names, including the printed spellings", () => {
  expect(STATE_NAMES).toHaveLength(36);
  expect(new Set(STATE_NAMES).size).toBe(36);
  expect(STATE_NAMES).toContain("Maharashtra");
  expect(STATE_NAMES).toContain("Himachal");
  expect(STATE_NAMES).toContain("J and K");
  expect(STATE_NAMES).toContain("Chattisgarh");
  expect(STATE_NAMES).toContain("Orissa");
  expect(STATE_NAMES).toContain("Dadra & Nagar Haveli and Daman & Diu");
});
