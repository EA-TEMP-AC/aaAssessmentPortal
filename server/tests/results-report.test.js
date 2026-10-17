import ExcelJS from "exceljs";
import { buildCandidateSummaryWorkbook, dateText } from "../src/modules/reports/results-report.js";

const summary = {
  batchId: "b1",
  header: {
    qualification: "Field Technician (QP1)",
    assessor: "Ravi",
    centre: "Centre A, OFFLINE",
    partner: "TP One",
    date: "01-Sep-2026",
  },
  counts: { total: 2, assessed: 1, pass: 1, fail: 0, absent: 1 },
  components: ["theory", "practical"],
  nos: [{ nosId: "n1", code: "NOS1", max: { theory: 20, practical: 30 } }],
  maxTotal: 50,
  rows: [
    {
      sNo: 1,
      reference: "C1",
      name: "=cmd()",
      marks: [{ theory: 15, practical: 25 }],
      totals: { theory: 15, practical: 25 },
      total: 40,
      percentage: 80,
      status: "Pass",
    },
    {
      sNo: 2,
      reference: "C2",
      name: "Meena",
      marks: [{ theory: null, practical: null }],
      totals: { theory: 0, practical: 0 },
      total: 0,
      percentage: 0,
      status: "Absent",
    },
  ],
};

describe("candidate summary report", () => {
  it("formats the date like the reference sheet", () => {
    expect(dateText("2026-09-01")).toBe("01-Sep-2026");
  });

  it("builds the sheet with counts, marks, status and the footer, and neutralises formulas", async () => {
    const buf = await buildCandidateSummaryWorkbook(summary);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    const text = [];
    ws.eachRow((row) => text.push(row.values.slice(1).join("|")));
    const all = text.join("\n");
    expect(all).toContain("CANDIDATE SUMMARY REPORT");
    expect(all).toContain("Pass|1");
    expect(all).toContain("Absent");
    expect(all).toContain("80");
    expect(all).toContain("confidential");
    expect(all).not.toMatch(/\|=cmd/);
  });
});
