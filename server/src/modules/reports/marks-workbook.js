import ExcelJS from "exceljs";

/** A cell that starts with one of these is read as a formula by Excel. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function safeCell(value) {
  if (typeof value === "string" && FORMULA_START.test(value)) return `'${value}`;
  return value;
}

const STATUS_TEXT = {
  in_progress: "In progress",
  submitted: "Submitted",
  timed_out: "Time ran out",
  not_started: "Not attempted",
};

/**
 * X-09. One row per candidate: totals and the marks for each NOS. Only the names of the
 * candidates and the marks go in; no contact details, no ID numbers, no answers.
 * @param {{ batchLabel: string, rows: Array<{ name: string, status: string, startedAt: Date|null, closedAt: Date|null, scores: null | { maxMarks: number, obtainedMarks: number, pendingMarks: number, complete: boolean, byNos: Array<{ key: string, maxMarks: number, obtainedMarks: number }> } }> }} input
 */
export async function buildMarksWorkbook({ batchLabel, rows }) {
  const nosKeys = [
    ...new Set(rows.flatMap((r) => (r.scores?.byNos ?? []).map((g) => g.key))),
  ].sort();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Marks");
  sheet.addRow([safeCell(`Marks for ${batchLabel}`)]).font = { bold: true };
  sheet.addRow([]);
  const header = [
    "Sr. no.",
    "Candidate",
    "Status",
    "Started (IST)",
    "Finished (IST)",
    "Marks obtained",
    "Maximum marks",
    "Percentage",
    "Still to be marked",
    ...nosKeys.map((k) => `${k} (obtained / max)`),
  ];
  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  rows.forEach((r, index) => {
    const s = r.scores;
    const byKey = new Map((s?.byNos ?? []).map((g) => [g.key, g]));
    sheet.addRow([
      index + 1,
      safeCell(r.name),
      STATUS_TEXT[r.status] ?? r.status,
      istText(r.startedAt),
      istText(r.closedAt),
      s ? s.obtainedMarks : null,
      s ? s.maxMarks : null,
      s && s.maxMarks > 0 ? Math.round((s.obtainedMarks / s.maxMarks) * 10000) / 100 : null,
      s ? (s.complete ? "No" : "Yes") : null,
      ...nosKeys.map((k) => {
        const g = byKey.get(k);
        return g ? `${g.obtainedMarks} / ${g.maxMarks}` : "";
      }),
    ]);
  });
  sheet.columns.forEach((c) => {
    c.width = 18;
  });
  sheet.getColumn(2).width = 30;
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function istText(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
