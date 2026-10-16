import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { answerTimings } from "../src/modules/reports/answer-timing.js";
import { buildMarksWorkbook, safeCell } from "../src/modules/reports/marks-workbook.js";

describe("answerTimings (X-09)", () => {
  const startedAt = "2026-10-16T04:00:00.000Z";
  it("counts the first answer from the start and later ones from the answer before", () => {
    const map = answerTimings({
      startedAt,
      questions: [
        { questionId: "a", answeredAt: "2026-10-16T04:01:30.000Z" },
        { questionId: "b", answeredAt: "2026-10-16T04:00:40.000Z" },
        { questionId: "c", answeredAt: null },
      ],
    });
    expect(map.get("b")).toBe(40);
    expect(map.get("a")).toBe(50);
    expect(map.has("c")).toBe(false);
  });

  it("never returns a negative time", () => {
    const map = answerTimings({
      startedAt,
      questions: [{ questionId: "a", answeredAt: "2026-10-16T03:59:00.000Z" }],
    });
    expect(map.get("a")).toBe(0);
  });
});

describe("marks workbook (X-09)", () => {
  it("keeps cells from being read as formulas", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+91")).toBe("'+91");
    expect(safeCell("Asha")).toBe("Asha");
  });

  it("writes one row per candidate with totals and a column per NOS", async () => {
    const buffer = await buildMarksWorkbook({
      batchLabel: "batch ABC123",
      rows: [
        {
          name: "Asha Rai",
          status: "submitted",
          startedAt: new Date("2026-10-16T04:00:00Z"),
          closedAt: new Date("2026-10-16T05:00:00Z"),
          scores: {
            maxMarks: 10,
            obtainedMarks: 7.5,
            pendingMarks: 0,
            complete: true,
            byNos: [
              { key: "NOS-1", maxMarks: 4, obtainedMarks: 3 },
              { key: "NOS-2", maxMarks: 6, obtainedMarks: 4.5 },
            ],
          },
        },
        { name: "=cmd()", status: "not_started", startedAt: null, closedAt: null, scores: null },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet("Marks");
    const header = sheet.getRow(3).values.slice(1);
    expect(header).toContain("NOS-1 (obtained / max)");
    const first = sheet.getRow(4).values.slice(1);
    expect(first[1]).toBe("Asha Rai");
    expect(first[5]).toBe(7.5);
    expect(first[7]).toBe(75);
    expect(first[9]).toBe("3 / 4");
    const second = sheet.getRow(5).values.slice(1);
    expect(second[1]).toBe("'=cmd()");
    expect(second[2]).toBe("Not attempted");
    expect(sheet.rowCount).toBe(5);
  });
});
