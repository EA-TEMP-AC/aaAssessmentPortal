import express, { Router } from "express";
import ExcelJS from "exceljs";
import { ZodError } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { TrainingPartner } from "../../models/training-partner.model.js";
import { MASTER_DATA_WRITE_ROLES } from "../../models/roles.js";
import { createAssessorSchema } from "../assessors/assessor.schemas.js";
import { createAssessor } from "../assessors/assessor.service.js";
import { createProctorSchema } from "../proctors/proctor.schemas.js";
import { createProctor } from "../proctors/proctor.service.js";
import {
  createAwardingBodySchema,
  createCentreSchema,
  createLearnerSchema,
  createTrainingPartnerSchema,
} from "./master-data.schemas.js";
import {
  createAwardingBody,
  createCentre,
  createLearner,
  createTrainingPartner,
} from "./master-data.service.js";

/**
 * X-43. Bulk Excel upload of master records: awarding bodies, training partners, training centres,
 * assessors, proctors and students. One sheet, one header row, one record per row. Every row is
 * checked by the same rules as the single-record form and created by the same service; a bad row
 * is reported with its row number and the rest still go in. A record that already exists (same
 * code, email or reference) is counted as skipped, not as an error.
 */
export const BULK_MAX_ROWS = 2000;
const BULK_MAX_BYTES = 5 * 1024 * 1024;

const list = (v) =>
  String(v ?? "")
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
const yes = (v) => /^(y|yes|true|1)$/i.test(String(v ?? "").trim());
const no = (v) => /^(n|no|false|0)$/i.test(String(v ?? "").trim());
const text = (v) => {
  const t = String(v ?? "").trim();
  return t === "" ? undefined : t;
};
const gender = (v) => {
  const t = text(v);
  if (t === undefined) return undefined;
  const m = { male: "Male", m: "Male", female: "Female", f: "Female", other: "Other" }[
    t.toLowerCase()
  ];
  return m ?? t;
};
const flag = (v) => (yes(v) ? true : no(v) ? false : undefined);
const int = (v) => (text(v) === undefined ? undefined : Number(v));

function drop(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** column name -> { required, note, example }, plus how a row becomes a create body. */
const TYPES = {
  "awarding-bodies": {
    title: "Awarding bodies",
    columns: {
      name: { required: true, example: "Sample Awarding Body" },
      code: { example: "AB-001" },
      notificationEmails: {
        required: true,
        note: "One or more emails, separated by ;",
        example: "a@ab.example; b@ab.example",
      },
      active: { note: "yes or no, default yes", example: "yes" },
    },
    schema: createAwardingBodySchema,
    create: createAwardingBody,
    body: (r) =>
      drop({
        name: text(r.name),
        code: text(r.code),
        notificationEmails: list(r.notificationEmails),
        active: flag(r.active),
      }),
  },
  "training-partners": {
    title: "Training partners",
    columns: {
      name: { required: true, example: "Sample Training Partner" },
      code: { example: "TP-001" },
      email: { example: "tp@example.com" },
      active: { note: "yes or no, default yes", example: "yes" },
    },
    schema: createTrainingPartnerSchema,
    create: createTrainingPartner,
    body: (r) =>
      drop({
        name: text(r.name),
        code: text(r.code),
        email: text(r.email),
        active: flag(r.active),
      }),
  },
  centres: {
    title: "Training centres",
    columns: {
      name: { required: true, example: "Sample Centre" },
      code: { example: "CTR-001" },
      tpCode: { required: true, note: "Code of an existing training partner", example: "TP-001" },
      state: {
        required: true,
        note: "State or UT as in Annexure IV, for example Maharashtra",
        example: "Maharashtra",
      },
      active: { note: "yes or no, default yes", example: "yes" },
    },
    schema: createCentreSchema,
    create: createCentre,
    async body(r) {
      const code = text(r.tpCode);
      let tpId;
      if (code) {
        const tp = await TrainingPartner.findOne({ code }).select("_id").lean();
        if (!tp)
          throw validationError("Unknown training partner", {
            tpCode: [`No training partner with code ${code}`],
          });
        tpId = String(tp._id);
      }
      return drop({
        name: text(r.name),
        code: text(r.code),
        tpId,
        state: text(r.state),
        active: flag(r.active),
      });
    },
  },
  assessors: {
    title: "Assessors",
    columns: {
      name: { required: true, example: "Ravi Assessor" },
      code: { example: "ASR-001" },
      email: { example: "ravi@example.com" },
      qualifications: { note: "Separated by ;", example: "Electrician L4; Welder L3" },
      languages: { note: "Separated by ;", example: "Hindi; English" },
      yearsOfExperience: { example: "6" },
      toaCertNo: { note: "ToA certificate number; with the two dates below", example: "TOA-001" },
      toaIssuedOn: { note: "YYYY-MM-DD", example: "2024-01-15" },
      toaExpiresOn: { note: "YYYY-MM-DD", example: "2027-01-14" },
      otherAaCount: { note: "Other assessment agencies, default 0", example: "1" },
      undertaking: { note: "yes or no", example: "yes" },
      active: { note: "yes or no, default yes", example: "yes" },
    },
    schema: createAssessorSchema,
    create: createAssessor,
    body: (r) => {
      const hasToa = text(r.toaCertNo) || text(r.toaIssuedOn) || text(r.toaExpiresOn);
      return drop({
        name: text(r.name),
        code: text(r.code),
        email: text(r.email),
        qualifications: text(r.qualifications) ? list(r.qualifications) : undefined,
        languages: text(r.languages) ? list(r.languages) : undefined,
        yearsOfExperience: int(r.yearsOfExperience),
        toa: hasToa
          ? {
              certNo: text(r.toaCertNo),
              issuedOn: text(r.toaIssuedOn),
              expiresOn: text(r.toaExpiresOn),
            }
          : undefined,
        otherAaCount: int(r.otherAaCount),
        undertaking: flag(r.undertaking),
        active: flag(r.active),
      });
    },
  },
  proctors: {
    title: "Proctors",
    columns: {
      name: { required: true, example: "Priya Proctor" },
      code: { example: "PRC-001" },
      email: { example: "priya@example.com" },
      qualifications: { note: "Separated by ;", example: "Proctor L1" },
      languages: { note: "Separated by ;", example: "Hindi" },
      active: { note: "yes or no, default yes", example: "yes" },
    },
    schema: createProctorSchema,
    create: createProctor,
    body: (r) =>
      drop({
        name: text(r.name),
        code: text(r.code),
        email: text(r.email),
        qualifications: text(r.qualifications) ? list(r.qualifications) : undefined,
        languages: text(r.languages) ? list(r.languages) : undefined,
        active: flag(r.active),
      }),
  },
  learners: {
    title: "Students",
    columns: {
      name: { required: true, example: "Asha Devi" },
      externalRef: { note: "Student ID / Candidate ID", example: "TP-REG-10021" },
      enrolmentNumber: { note: "Enrolment number", example: "ENR-2026-001" },
      fatherName: { note: "Father's or husband's name", example: "Ram Kumar" },
      gender: { note: "Male, Female or Other", example: "Female" },
      phone: { note: "Mobile number", example: "9000000001" },
      address: { example: "12 Station Road, Gangtok" },
      aadhaar: {
        note: "Optional. 12 digits. Stored encrypted and shown only as the last four digits",
        example: "",
      },
      active: { note: "yes or no, default yes", example: "yes" },
    },
    schema: createLearnerSchema,
    create: createLearner,
    body: (r) =>
      drop({
        name: text(r.name),
        externalRef: text(r.externalRef),
        phone: text(r.phone),
        enrolmentNumber: text(r.enrolmentNumber),
        fatherName: text(r.fatherName),
        gender: gender(r.gender),
        address: text(r.address),
        aadhaar: text(r.aadhaar),
        active: flag(r.active),
      }),
  },
};

export const BULK_TYPES = Object.freeze(Object.keys(TYPES));

function cellText(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return String(cell.text ?? "").trim();
  return String(v).trim();
}

export async function buildBulkTemplate(type) {
  const def = TYPES[type];
  if (!def) throw notFound();
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet("Data");
  const names = Object.keys(def.columns);
  data.addRow(names);
  data.getRow(1).font = { bold: true };
  data.columns = names.map(() => ({ width: 22 }));
  const notes = wb.addWorksheet("Notes");
  notes.addRow(["Column", "Required", "Notes", "Example"]);
  notes.getRow(1).font = { bold: true };
  for (const [name, c] of Object.entries(def.columns)) {
    notes.addRow([name, c.required ? "yes" : "", c.note ?? "", c.example ?? ""]);
  }
  notes.addRow([]);
  notes.addRow([
    `Fill the Data sheet from row 2. One row per record. At most ${BULK_MAX_ROWS} rows. A record that already exists is skipped.`,
  ]);
  notes.columns = [{ width: 22 }, { width: 10 }, { width: 50 }, { width: 34 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function readRows(type, buffer) {
  const def = TYPES[type];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw validationError("Not an Excel (.xlsx) file", { file: ["Upload an .xlsx file"] });
  }
  const sheet = wb.getWorksheet("Data") ?? wb.worksheets[0];
  if (!sheet) throw validationError("The file has no sheet", { file: ["No sheet found"] });
  const header = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    header[col] = cellText(cell).toLowerCase();
  });
  const known = Object.keys(def.columns).map((c) => c.toLowerCase());
  const missing = Object.entries(def.columns)
    .filter(([, c]) => c.required)
    .map(([name]) => name)
    .filter((name) => !header.includes(name.toLowerCase()));
  if (missing.length > 0 || !header.some((h) => known.includes(h))) {
    throw validationError("The header row is missing columns", {
      file: [`Needs the columns: ${missing.join(", ") || Object.keys(def.columns).join(", ")}`],
    });
  }
  const byName = new Map(Object.keys(def.columns).map((c) => [c.toLowerCase(), c]));
  const rows = [];
  for (let n = 2; n <= sheet.rowCount; n += 1) {
    const row = sheet.getRow(n);
    const record = {};
    let any = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = byName.get(header[col] ?? "");
      if (!key) return;
      const value = cellText(cell);
      if (value !== "") any = true;
      record[key] = value;
    });
    if (any) rows.push({ rowNumber: n, record });
  }
  if (rows.length > BULK_MAX_ROWS) {
    throw validationError("Too many rows", { file: [`At most ${BULK_MAX_ROWS} rows`] });
  }
  return rows;
}

function reasonOf(err) {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ");
  }
  if (err instanceof AppError) {
    const fields =
      err.details && typeof err.details === "object" ? Object.values(err.details).flat() : [];
    return fields.length > 0 ? `${err.message}: ${fields.join("; ")}` : err.message;
  }
  return null;
}

export async function importMasterRecords(type, buffer) {
  const def = TYPES[type];
  if (!def) throw notFound();
  const rows = await readRows(type, buffer);
  let created = 0;
  let skipped = 0;
  const errors = [];
  for (const { rowNumber, record } of rows) {
    try {
      const body = def.schema.parse(await def.body(record));
      await def.create(body);
      created += 1;
    } catch (err) {
      if (err instanceof AppError && err.code === "DUPLICATE_RESOURCE") {
        skipped += 1;
        continue;
      }
      const reason = reasonOf(err);
      if (reason === null) throw err;
      errors.push({ row: rowNumber, reason });
    }
  }
  return { type, totalRows: rows.length, created, skipped, errors };
}

const excelParser = express.raw({
  type: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
  limit: BULK_MAX_BYTES,
});

/** Mounted at /api/v1/master-import. */
export const masterImportRouter = Router();
masterImportRouter.use(requireAuth);

masterImportRouter.get(
  "/:type/template",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const buffer = await buildBulkTemplate(req.params.type);
    res.status(200).set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${req.params.type}-template.xlsx"`,
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }),
);

masterImportRouter.post(
  "/:type",
  requireRoles(...MASTER_DATA_WRITE_ROLES),
  excelParser,
  asyncHandler(async (req, res) => {
    if (!TYPES[req.params.type]) throw notFound();
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw validationError("Excel file required", {
        file: ["Send the .xlsx file as the request body"],
      });
    }
    const result = await importMasterRecords(req.params.type, req.body);
    req.audit = {
      action: "master.bulk_import",
      entity: req.params.type,
      omitRequestBody: true,
      meta: {
        type: result.type,
        totalRows: result.totalRows,
        created: result.created,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
    };
    await res.status(200).json(result);
  }),
);
