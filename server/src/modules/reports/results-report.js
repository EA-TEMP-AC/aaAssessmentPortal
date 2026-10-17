import ExcelJS from "exceljs";
import { forbidden, notFound } from "../../lib/errors.js";
import { namesForBatches } from "../../lib/display-names.js";
import { batchQueryFilter, isInBatchScope } from "../../middleware/scope.js";
import { Batch } from "../../models/batch.model.js";
import { Candidate } from "../../models/candidate.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { Result } from "../../models/result.model.js";
import { componentCeiling } from "../results/result-scoring.js";
import { safeCell } from "./marks-workbook.js";

/**
 * X-44. The candidate summary report (the agency's result sheet for a batch) and the results list.
 * Laid out like the reference portal's report: batch header, result index (total, pass, fail,
 * absent), then one row per candidate with the marks of every NOS (theory, practical, viva where
 * the qualification has it), the totals, the outcome and the percentage.
 */
export const RESULT_BATCH_STATUSES = Object.freeze([
  "assessment_completed",
  "result_submitted",
  "ab_validated",
  "published",
]);

const COMPONENTS = ["theory", "practical", "viva"];
const COMPONENT_LABEL = { theory: "Theory", practical: "Practical", viva: "Viva" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-09-01 -> 01-Sep-2026. */
export function dateText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** The result of one batch as table data. Scope: the caller's batch rows. */
export async function candidateSummary(user, batchId) {
  const batch = await Batch.findById(batchId).lean();
  if (!batch) throw notFound();
  if (!isInBatchScope(user, batch)) throw forbidden();
  const [result, qualification, candidates] = await Promise.all([
    Result.findOne({ batchId: batch._id }).lean(),
    Qualification.findById(batch.qualificationId).lean(),
    Candidate.find({ batchId: batch._id }).select("name externalRef learnerId").lean(),
  ]);
  if (!result) throw notFound("No result for this batch");
  const [names] = await Promise.all([namesForBatches([batch])]);
  const labels = [...names.values()][0] ?? names;
  const nosList = (qualification?.nos ?? []).map((n) => ({
    nosId: n.nosId,
    code: n.code ?? n.nosId,
    name: n.name ?? "",
    max: Object.fromEntries(COMPONENTS.map((c) => [c, componentCeiling(qualification, n, c)])),
  }));
  const rowOf = new Map(result.rows.map((r) => [String(r.candidateId), r]));
  // A component is shown when some NOS has a ceiling above zero or any candidate has a mark in it.
  const shown = COMPONENTS.filter((c) =>
    nosList.some(
      (n) =>
        (n.max[c] ?? 0) > 0 ||
        result.rows.some((r) => r.nos.some((x) => x.nosId === n.nosId && x[c] != null)),
    ),
  );
  const maxTotal = nosList.reduce(
    (sum, n) => sum + shown.reduce((s, c) => s + (n.max[c] ?? 0), 0),
    0,
  );

  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  const rows = sorted.map((c, i) => {
    const r = rowOf.get(String(c._id));
    const marks = nosList.map((n) => {
      const m = r?.nos.find((x) => x.nosId === n.nosId);
      return Object.fromEntries(shown.map((comp) => [comp, m?.[comp] ?? null]));
    });
    const totals = Object.fromEntries(
      shown.map((comp) => [comp, marks.reduce((s, m) => s + (m[comp] ?? 0), 0)]),
    );
    const total = shown.reduce((s, comp) => s + totals[comp], 0);
    const absent = r?.absent === true || r?.outcome === "Absent";
    return {
      sNo: i + 1,
      candidateId: String(c._id),
      learnerId: c.learnerId ? String(c.learnerId) : null,
      reference: c.externalRef ?? "",
      name: c.name,
      marks,
      totals,
      total: absent ? 0 : total,
      percentage: absent || maxTotal === 0 ? 0 : round2((total / maxTotal) * 100),
      status: r?.outcome ?? "Pending",
    };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    batchId: String(batch._id),
    resultStatus: result.status,
    batchStatus: batch.status,
    header: {
      qualification: qualification
        ? `${qualification.name}${qualification.code ? ` (${qualification.code})` : ""}`
        : "",
      sector: batch.sector,
      assessor: labels.assessorName ?? "",
      centre: [labels.centreName, batch.mode ? batch.mode.toUpperCase() : ""]
        .filter(Boolean)
        .join(", "),
      partner: labels.tpName ?? "",
      date: dateText(batch.assessmentStartDate),
      endDate: dateText(batch.assessmentEndDate),
    },
    counts: {
      total: rows.length,
      assessed: rows.length - count("Absent"),
      pass: count("Pass"),
      fail: count("Fail"),
      absent: count("Absent"),
    },
    components: shown,
    nos: nosList,
    maxTotal,
    rows,
  };
}

export async function buildCandidateSummaryWorkbook(s) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Candidate summary");
  const bold = { bold: true };
  const width = 6 + s.nos.length * s.components.length + s.components.length + 3;
  ws.addRow([safeCell("CANDIDATE SUMMARY REPORT")]).font = { bold: true, size: 14 };
  ws.addRow([]);
  const head = [
    ["Batch Id", s.batchId, "Result Index", "Total", s.counts.total],
    ["Job role", safeCell(s.header.qualification), "", "Pass", s.counts.pass],
    ["Assessor Name", safeCell(s.header.assessor), "", "Fail", s.counts.fail],
    ["Centre Location", safeCell(s.header.centre), "", "Absent", s.counts.absent],
    ["Partner", safeCell(s.header.partner), "Candidates Assessed", s.counts.assessed, ""],
    ["Date of Assessment", s.header.date, "", "", ""],
  ];
  for (const h of head) {
    const row = ws.addRow(h);
    row.getCell(1).font = bold;
    row.getCell(3).font = bold;
  }
  ws.addRow([]);

  // Three header rows: fixed columns, NOS code over its components, and the maximum marks.
  const fixed = ["S.No", "Candidate Id", "Candidate Name", "Partner Name", "Job Role"];
  const r1 = [...fixed];
  const r2 = fixed.map(() => "");
  const r3 = fixed.map(() => "");
  for (const n of s.nos) {
    r1.push(safeCell(n.code), ...s.components.slice(1).map(() => ""));
    for (const c of s.components) {
      r2.push(COMPONENT_LABEL[c]);
      r3.push(n.max[c] != null ? `(${n.max[c]})` : "");
    }
  }
  for (const c of s.components) {
    r1.push(c === s.components[0] ? "Totals" : "");
    r2.push(`Total ${COMPONENT_LABEL[c]}`);
    r3.push("");
  }
  r1.push("Overall Marks", "Status", "Total Percentage");
  r2.push("", "", "");
  r3.push(s.maxTotal ? `(${s.maxTotal})` : "", "", "");
  for (const r of [r1, r2, r3]) {
    const row = ws.addRow(r);
    row.font = bold;
    row.alignment = { horizontal: "center" };
  }
  for (const r of s.rows) {
    ws.addRow([
      r.sNo,
      safeCell(r.reference),
      safeCell(r.name),
      safeCell(s.header.partner),
      safeCell(s.header.qualification),
      ...r.marks.flatMap((m) => s.components.map((c) => m[c])),
      ...s.components.map((c) => r.totals[c]),
      r.total,
      r.status,
      r.percentage,
    ]);
  }
  ws.addRow([]);
  ws.addRow([
    "This is a system generated report, contains confidential information intended for a specific individual and purpose, and is intended for the addressee only. Any unauthorized use, copying, or distribution of this report is strictly prohibited.",
  ]);
  ws.columns = Array.from({ length: width }, (_, i) => ({ width: i < 5 ? 24 : 12 }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One row per batch that has reached results, with the counts, for the Results page. */
export async function listResultBatches(user, query = {}) {
  const filter = { ...batchQueryFilter(user), status: { $in: RESULT_BATCH_STATUSES } };
  if (query.status) filter.status = query.status;
  if (query.sector) filter.sector = query.sector;
  if (query.qualificationId) filter.qualificationId = query.qualificationId;
  if (query.centreId) filter.centreId = query.centreId;
  if (query.batchId) filter._id = query.batchId;
  if (query.from || query.to) {
    filter.assessmentStartDate = {};
    if (query.from) filter.assessmentStartDate.$gte = query.from;
    if (query.to) filter.assessmentStartDate.$lte = query.to;
  }
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const [total, batches] = await Promise.all([
    Batch.countDocuments(filter),
    Batch.find(filter)
      .sort({ assessmentStartDate: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  const [results, names] = await Promise.all([
    Result.find({ batchId: { $in: batches.map((b) => b._id) } }).lean(),
    namesForBatches(batches),
  ]);
  const byBatch = new Map(results.map((r) => [String(r.batchId), r]));
  const labelOf = (b) => (typeof names.get === "function" ? names.get(String(b._id)) : null) ?? {};
  const items = batches.map((b) => {
    const r = byBatch.get(String(b._id));
    const count = (o) => (r ? r.rows.filter((x) => x.outcome === o).length : 0);
    const label = labelOf(b);
    return {
      batchId: String(b._id),
      qualification: label.qualificationName ?? null,
      sector: b.sector,
      centre: label.centreName ?? null,
      partner: label.tpName ?? null,
      assessor: label.assessorName ?? null,
      assessmentDate: b.assessmentStartDate,
      batchStatus: b.status,
      resultStatus: r ? r.status : null,
      total: r ? r.rows.length : b.candidateCount,
      pass: count("Pass"),
      fail: count("Fail"),
      absent: count("Absent"),
    };
  });
  return { page, pageSize, total, items };
}
