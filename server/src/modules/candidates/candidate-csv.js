import { validationError } from "../../lib/errors.js";
import { CANDIDATE_CSV_MAX_BYTES, CANDIDATE_CSV_MAX_ROWS } from "./candidate-limits.js";

const FORMULA_PREFIX = /^[=+\-@]/;

/**
 * Store CSV cells as inert strings. Never eval or interpret formulas.
 * Leading = + - @ (and DDE tab/CR) are prefixed with `'` so a later
 * spreadsheet export cannot execute them.
 */
export function sanitizeCsvCell(raw) {
  let value = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\0/g, "")
    .trim();
  if (value.startsWith("\t") || value.startsWith("\r")) {
    value = value.replace(/^[\t\r]+/, "");
  }
  if (FORMULA_PREFIX.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * RFC4180-ish parser. Does not execute cells.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const input = String(text ?? "").replace(/^\uFEFF/, "");

  const pushRow = () => {
    row.push(cell);
    cell = "";
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      if (input[i + 1] === "\n") i += 1;
      pushRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function assertLooksLikeCsv(text) {
  const start = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (start.startsWith("{") || start.startsWith("[") || start.startsWith("PK")) {
    throw validationError("CSV file required", { file: ["Not a CSV file"] });
  }
}

/**
 * Header must include name and externalRef; an optional email column creates the student's login (X-35). Extra columns are ignored.
 * @param {string} text
 * @returns {{ rowNumber: number, name: string, externalRef: string }[]}
 */
export function rosterFromCsv(text) {
  assertLooksLikeCsv(text);
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw validationError("CSV header is required", {
      csv: ["Expected header name,externalRef"],
    });
  }

  const header = rows[0].map((col) =>
    String(col ?? "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  const nameIdx = header.indexOf("name");
  const refIdx = header.indexOf("externalref");
  const emailIdx = header.indexOf("email");
  if (nameIdx < 0 || refIdx < 0) {
    throw validationError("CSV header is required", {
      csv: ["Expected header name,externalRef"],
    });
  }

  const data = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i];
    if (cols.every((col) => String(col ?? "").trim() === "")) continue;
    data.push({
      rowNumber: i + 1,
      name: sanitizeCsvCell(cols[nameIdx] ?? ""),
      externalRef: sanitizeCsvCell(cols[refIdx] ?? ""),
      email: emailIdx >= 0 ? sanitizeCsvCell(cols[emailIdx] ?? "") : "",
    });
  }

  if (data.length > CANDIDATE_CSV_MAX_ROWS) {
    throw validationError("CSV has too many rows", {
      csv: [`At most ${CANDIDATE_CSV_MAX_ROWS} data rows`],
    });
  }
  return data;
}

/**
 * Pull the CSV file and optional ratioOverrideReason from a multipart body.
 * @param {Buffer|string} buffer
 * @param {string} contentType
 */
export function parseMultipartCsv(buffer, contentType) {
  const type = String(contentType || "");
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type);
  if (!boundaryMatch) {
    throw validationError("CSV file required", { file: ["Missing multipart boundary"] });
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? "", "utf8");
  const overhead = 8192;
  if (raw.length > CANDIDATE_CSV_MAX_BYTES + overhead) {
    throw validationError("CSV file is too large", { file: ["File exceeds the size limit"] });
  }

  const text = raw.toString("utf8");
  const parts = text.split(`--${boundary}`);
  let csv = null;
  let filename = "";
  const fields = {};

  for (const part of parts) {
    if (part === "" || part === "--" || part === "--\r\n" || part.startsWith("--")) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    let body = part.slice(headerEnd + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    const disp = /Content-Disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headers);
    if (!disp) continue;
    const fieldName = /name="([^"]+)"/i.exec(disp[1]);
    const fileName = /filename="([^"]*)"/i.exec(disp[1]);
    if (fileName?.[1]) {
      filename = fileName[1];
      csv = body;
    } else if (fieldName?.[1]) {
      fields[fieldName[1]] = body.trim();
    }
  }

  if (csv == null) {
    throw validationError("CSV file required", { file: ["Attach a .csv file"] });
  }
  if (!filename.toLowerCase().endsWith(".csv")) {
    throw validationError("CSV file required", { file: ["File must have a .csv extension"] });
  }
  if (Buffer.byteLength(csv, "utf8") > CANDIDATE_CSV_MAX_BYTES) {
    throw validationError("CSV file is too large", { file: ["File exceeds the size limit"] });
  }
  return { csv, filename, fields };
}
