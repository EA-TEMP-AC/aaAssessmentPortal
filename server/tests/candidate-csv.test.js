import { describe, expect, it } from "vitest";
import {
  assertLooksLikeCsv,
  parseCsv,
  rosterFromCsv,
  sanitizeCsvCell,
} from "../src/modules/candidates/candidate-csv.js";
import { CANDIDATE_CSV_MAX_ROWS } from "../src/modules/candidates/candidate-limits.js";

describe("candidate CSV helpers", () => {
  it("never evaluates cells and prefixes formula starters", () => {
    expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
    expect(sanitizeCsvCell("+cmd")).toBe("'+cmd");
    expect(sanitizeCsvCell("-2")).toBe("'-2");
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCsvCell("Asha Devi")).toBe("Asha Devi");
  });

  it("parses quoted commas and skips blank rows", () => {
    const rows = parseCsv('name,externalRef\n"Devi, Asha",TP-1\n\nRavi,TP-2\n');
    expect(rows[0]).toEqual(["name", "externalRef"]);
    expect(rows[1]).toEqual(["Devi, Asha", "TP-1"]);
    const roster = rosterFromCsv('name,externalRef\n"Devi, Asha",TP-1\n\nRavi,TP-2\n');
    expect(roster).toEqual([
      { rowNumber: 2, name: "Devi, Asha", externalRef: "TP-1" },
      { rowNumber: 4, name: "Ravi", externalRef: "TP-2" },
    ]);
  });

  it("rejects JSON-looking payloads and too many rows", () => {
    expect(() => assertLooksLikeCsv('{"name":"x"}')).toThrow(/CSV file required/);
    const header = "name,externalRef\n";
    const lines = Array.from(
      { length: CANDIDATE_CSV_MAX_ROWS + 1 },
      (_, i) => `Name ${i},REF-${i}`,
    );
    expect(() => rosterFromCsv(header + lines.join("\n"))).toThrow(/too many rows/);
  });
});
