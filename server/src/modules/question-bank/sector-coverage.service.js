import { SECTOR_NAMES } from "../../config/annexure.js";
import { compliance } from "../../config/compliance.js";
import { AppError, duplicateResource, notFound, validationError } from "../../lib/errors.js";
import { AaRecognition, RECOGNITION_KEY } from "../../models/aa-recognition.model.js";
import { NqrQualification } from "../../models/nqr-qualification.model.js";
import { Qualification } from "../../models/qualification.model.js";
import { Question } from "../../models/question.model.js";
import { SectorConfig } from "../../models/sector-config.model.js";
import { assertLooksLikeCsv, parseCsv, sanitizeCsvCell } from "../candidates/candidate-csv.js";
import { containsNationalIdKey } from "./question-bank.schemas.js";

/** project. Q-05. Upload limits for the NQR list. Open question 364. */
export const NQR_CSV_MAX_BYTES = 2_097_152;
export const NQR_CSV_MAX_ROWS = 20_000;

const NQR_COLUMNS = Object.freeze(["code", "name", "sector"]);

const SECTOR_BY_LOWER = new Map(SECTOR_NAMES.map((name) => [name.toLowerCase(), name]));

/**
 * Coverage maths. Compares covered * 100 with total * minimum so 5 of 100 is never
 * lost to rounding. An empty sector has no percentage and does not meet the minimum.
 */
export function computeCoverage(
  total,
  covered,
  minPercent = compliance.SECTOR_MIN_COVERAGE_PERCENT,
) {
  if (total === 0) {
    return { percentCovered: null, meetsMinimum: false };
  }
  return {
    percentCovered: Math.round((covered / total) * 10000) / 100,
    meetsMinimum: covered * 100 >= total * minPercent,
  };
}

function configView(doc) {
  return {
    id: String(doc._id),
    sector: doc.sector,
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function createSectorConfig(user, body) {
  const recognition = await AaRecognition.findOne({ key: RECOGNITION_KEY }).lean();
  if (!recognition?.sectors.includes(body.sector)) {
    throw new AppError(409, "SECTOR_NOT_RECOGNISED", "Sector is not on the recognition record", {
      sector: body.sector,
    });
  }
  if (await SectorConfig.exists({ sector: body.sector })) {
    throw duplicateResource("Sector already has a config row");
  }
  const doc = await SectorConfig.create({
    sector: body.sector,
    active: body.active ?? true,
    createdBy: user._id,
    updatedBy: user._id,
  });
  return configView(doc.toObject());
}

export async function updateSectorConfig(user, id, body) {
  const before = await SectorConfig.findById(id).lean();
  if (!before) throw notFound("Sector config not found");
  const after = await SectorConfig.findByIdAndUpdate(
    id,
    { $set: { active: body.active, updatedBy: user._id } },
    { new: true },
  ).lean();
  return { before: configView(before), after: configView(after) };
}

/** Codes of held qualifications that have at least one approved, latest question. */
async function coveredCodeSet() {
  const qualificationIds = await Question.distinct("qualificationId", {
    status: "approved",
    isLatest: true,
  });
  if (qualificationIds.length === 0) return new Set();
  const quals = await Qualification.find({ _id: { $in: qualificationIds } })
    .select("code")
    .lean();
  return new Set(quals.map((q) => q.code));
}

function sectorSummary(config, nqrRows, covered) {
  const total = nqrRows.length;
  const coveredCount = nqrRows.filter((r) => covered.has(r.code)).length;
  return {
    sectorId: String(config._id),
    sector: config.sector,
    active: config.active,
    nqrQualificationCount: total,
    coveredCount,
    ...computeCoverage(total, coveredCount),
    minimumPercent: compliance.SECTOR_MIN_COVERAGE_PERCENT,
  };
}

export async function listSectorCoverage() {
  const configs = await SectorConfig.find({ active: true }).sort({ sector: 1 }).lean();
  const sectors = configs.map((c) => c.sector);
  const [nqr, covered] = await Promise.all([
    NqrQualification.find({ sector: { $in: sectors } })
      .select("code sector")
      .lean(),
    coveredCodeSet(),
  ]);
  const bySector = new Map(sectors.map((s) => [s, []]));
  for (const row of nqr) bySector.get(row.sector).push(row);

  return {
    minimumPercent: compliance.SECTOR_MIN_COVERAGE_PERCENT,
    items: configs.map((c) => sectorSummary(c, bySector.get(c.sector), covered)),
  };
}

export async function getSectorCoverage(sectorId, { page, limit }) {
  const config = await SectorConfig.findById(sectorId).lean();
  if (!config) throw notFound("Sector config not found");
  const [nqr, covered] = await Promise.all([
    NqrQualification.find({ sector: config.sector }).select("code name").sort({ code: 1 }).lean(),
    coveredCodeSet(),
  ]);
  const uncovered = nqr.filter((r) => !covered.has(r.code));
  const start = (page - 1) * limit;
  return {
    ...sectorSummary(config, nqr, covered),
    uncovered: {
      total: uncovered.length,
      page,
      limit,
      items: uncovered.slice(start, start + limit).map((r) => ({ code: r.code, name: r.name })),
    },
  };
}

function validateRow(cells, header, rowNumber) {
  const errors = [];
  const get = (col) => sanitizeCsvCell(cells[header.indexOf(col)] ?? "");
  const code = get("code");
  const name = get("name");
  const sectorRaw = get("sector");
  const sector = SECTOR_BY_LOWER.get(sectorRaw.toLowerCase());

  if (!code) errors.push("Missing code");
  else if (code.length > 64) errors.push("Code is longer than 64 characters");
  if (!name) errors.push("Missing name");
  else if (name.length > 200) errors.push("Name is longer than 200 characters");
  if (!sectorRaw) errors.push("Missing sector");
  else if (!sector) errors.push(`Unknown sector '${sectorRaw}'. Use an Annexure II sector name`);

  return { row: rowNumber, errors, data: errors.length === 0 ? { code, name, sector } : null };
}

/**
 * Imports the NQR qualification list. Header must be code,name,sector (any order).
 * Nothing is saved when any row fails unless partial is true. Existing codes are updated.
 */
export async function importNqrQualifications(user, { csv, partial }) {
  if (typeof csv !== "string" || csv.trim() === "") {
    throw validationError("CSV file required", { file: ["Send the CSV as text/csv"] });
  }
  if (Buffer.byteLength(csv, "utf8") > NQR_CSV_MAX_BYTES) {
    throw validationError("CSV file is too large", { file: ["File exceeds the size limit"] });
  }
  assertLooksLikeCsv(csv);
  const table = parseCsv(csv);
  const header = (table[0] ?? []).map((c) =>
    String(c ?? "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  if (containsNationalIdKey(Object.fromEntries(header.map((h) => [h, true])))) {
    throw validationError("National ID fields are not permitted", {
      nationalId: ["National ID fields are not permitted"],
    });
  }
  const unknown = header.filter((h) => !NQR_COLUMNS.includes(h));
  const missing = NQR_COLUMNS.filter((c) => !header.includes(c));
  if (unknown.length > 0 || missing.length > 0 || new Set(header).size !== header.length) {
    throw validationError("CSV header must be code,name,sector", {
      csv: [
        ...(missing.length ? [`Missing column: ${missing.join(", ")}`] : []),
        ...(unknown.length ? [`Unknown column: ${unknown.join(", ")}`] : []),
      ],
    });
  }

  const dataRows = [];
  for (let i = 1; i < table.length; i += 1) {
    if (table[i].every((c) => String(c ?? "").trim() === "")) continue;
    dataRows.push({ cells: table[i], rowNumber: i + 1 });
  }
  if (dataRows.length === 0) {
    throw new AppError(400, "NO_DATA", "No rows found to import");
  }
  if (dataRows.length > NQR_CSV_MAX_ROWS) {
    throw validationError("CSV has too many rows", {
      csv: [`At most ${NQR_CSV_MAX_ROWS} data rows`],
    });
  }

  const results = dataRows.map((r) => validateRow(r.cells, header, r.rowNumber));
  const firstSeen = new Map();
  for (const r of results) {
    if (!r.data) continue;
    if (firstSeen.has(r.data.code)) {
      r.errors.push(`Duplicate code '${r.data.code}' (first on row ${firstSeen.get(r.data.code)})`);
      r.data = null;
    } else {
      firstSeen.set(r.data.code, r.row);
    }
  }

  const failed = results.filter((r) => r.errors.length > 0);
  const valid = results.filter((r) => r.errors.length === 0);
  const errors = failed.map((f) => ({ row: f.row, errors: f.errors }));

  if (failed.length > 0 && !partial) {
    return {
      success: false,
      code: "IMPORT_VALIDATION_FAILED",
      totalRows: dataRows.length,
      importedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      errorCount: failed.length,
      errors,
    };
  }

  let createdCount = 0;
  if (valid.length > 0) {
    const res = await NqrQualification.bulkWrite(
      valid.map(({ data }) => ({
        updateOne: {
          filter: { code: data.code },
          update: { $set: { name: data.name, sector: data.sector, importedBy: user._id } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    createdCount = res.upsertedCount;
  }

  return {
    success: true,
    totalRows: dataRows.length,
    importedCount: valid.length,
    createdCount,
    updatedCount: valid.length - createdCount,
    errorCount: failed.length,
    errors,
  };
}
