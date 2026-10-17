import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { AppError } from "../../lib/errors.js";
import { Qualification } from "../../models/qualification.model.js";
import {
  QUESTION_IMAGE_MAX_BYTES,
  QUESTION_IMAGES_PER_QUESTION,
  QuestionImage,
} from "../../models/question-image.model.js";
import { sniffContentType } from "../evidence/file-type.js";
import { uploadQuestionImage } from "./question-image.service.js";
import { Question, QUESTION_DIFFICULTIES, QUESTION_TYPES } from "../../models/question.model.js";
import { compliance } from "../../config/compliance.js";
import {
  containsNationalIdKey,
  hasDuplicateOptionKeys,
  normalizeOptions,
  resolveMcqKey,
} from "./question-bank.schemas.js";

/**
 * Resolves a qualification document by either ObjectId or qualification code,
 * and verifies that the given NOS and PC exist within it.
 */
export async function resolveQualificationAndPc(qualificationRef, nosRef, pcRef) {
  if (!qualificationRef) {
    throw new AppError(400, "QUALIFICATION_REQUIRED", "Qualification is required");
  }

  let qual = null;
  if (mongoose.Types.ObjectId.isValid(qualificationRef)) {
    qual = await Qualification.findById(qualificationRef);
  }
  if (!qual) {
    qual = await Qualification.findOne({
      code: String(qualificationRef).trim(),
    });
  }

  if (!qual) {
    throw new AppError(
      404,
      "QUALIFICATION_NOT_FOUND",
      `Qualification '${qualificationRef}' not found`,
    );
  }

  const nosClean = String(nosRef || "")
    .trim()
    .toLowerCase();
  const matchedNos = (qual.nos || []).find(
    (n) =>
      (n.nosId && n.nosId.toLowerCase() === nosClean) ||
      (n.code && n.code.toLowerCase() === nosClean),
  );

  if (!matchedNos) {
    throw new AppError(
      400,
      "NOS_NOT_FOUND",
      `NOS '${nosRef}' not found on qualification '${qual.code}'`,
    );
  }

  const pcClean = String(pcRef || "")
    .trim()
    .toLowerCase();
  const matchedPc = (matchedNos.pcs || []).find(
    (p) =>
      (p.pcId && p.pcId.toLowerCase() === pcClean) || (p.code && p.code.toLowerCase() === pcClean),
  );

  if (!matchedPc) {
    throw new AppError(
      400,
      "PC_NOT_FOUND",
      `PC '${pcRef}' not found under NOS '${matchedNos.code || matchedNos.nosId}'`,
    );
  }

  return { qualification: qual, nos: matchedNos, pc: matchedPc };
}

/**
 * Checks an MCQ's options and returns the correct answer as the option key.
 * The answer may be given as a key or as the option text (case-insensitive); the key is stored.
 */
function mcqKeyOrThrow(options, answer) {
  if (options.length < 2) {
    throw new AppError(400, "INVALID_OPTIONS", "MCQ questions must have at least 2 options");
  }
  if (hasDuplicateOptionKeys(options)) {
    throw new AppError(
      400,
      "DUPLICATE_OPTION_KEYS",
      "Option keys must be unique (compared without case)",
    );
  }
  const key = resolveMcqKey(options, answer);
  if (key === null) {
    throw new AppError(
      400,
      "INVALID_CORRECT_ANSWER",
      "MCQ correct answer must match one of the option keys or option text",
    );
  }
  return key;
}

/** X-25: every image must exist, and none may repeat. Returns the list to store. */
async function checkedImages(images) {
  const list = (images ?? []).map((i) => ({ imageId: i.imageId.toLowerCase(), alt: i.alt.trim() }));
  if (new Set(list.map((i) => i.imageId)).size !== list.length) {
    throw new AppError(400, "VALIDATION_ERROR", "The same image is used twice", {
      images: ["The same image is used twice"],
    });
  }
  if (list.length > 0) {
    const found = await QuestionImage.countDocuments({ _id: { $in: list.map((i) => i.imageId) } });
    if (found !== list.length) {
      throw new AppError(400, "VALIDATION_ERROR", "An image was not found", {
        images: ["An image was not found; upload it again"],
      });
    }
  }
  return list;
}

/**
 * Creates a new question in draft status (version 1).
 */
export async function createQuestion(user, data) {
  const qualRef = data.qualificationId || data.qualification;
  const nosRef = data.nosId || data.nos;
  const pcRef = data.pcId || data.pc;

  const { qualification, nos, pc } = await resolveQualificationAndPc(qualRef, nosRef, pcRef);

  const normalizedOptions = normalizeOptions(data.options);
  let correctAnswer = data.correctAnswer ? String(data.correctAnswer).trim() : null;
  if (data.type === "mcq") {
    correctAnswer = mcqKeyOrThrow(normalizedOptions, data.correctAnswer);
  }

  const question = new Question({
    qualificationId: qualification._id,
    nosId: nos.nosId || nos.code,
    pcId: pc.pcId || pc.code,
    type: data.type,
    language: String(data.language).trim().toLowerCase(),
    difficulty: data.difficulty || null,
    bloomLevel: data.bloomLevel ? String(data.bloomLevel).trim() : null,
    stem: String(data.stem).trim(),
    options: normalizedOptions,
    correctAnswer,
    marks: Number(data.marks),
    images: await checkedImages(data.images),
    status: "draft",
    version: 1,
    isLatest: true,
    createdBy: user._id,
  });

  question.rootQuestionId = question._id;
  await question.save();

  return question;
}

/**
 * Reads a single question by ID.
 */
export async function getQuestion(_user, id) {
  const question = await Question.findById(id).lean();
  if (!question) {
    throw new AppError(404, "NOT_FOUND", "Question not found");
  }
  return question;
}

/**
 * Lists questions with filtering and pagination.
 */
export async function listQuestions(_user, filters) {
  const query = {};

  const qualRef = filters.qualification || filters.qualificationId;
  if (qualRef) {
    if (mongoose.Types.ObjectId.isValid(qualRef)) {
      query.qualificationId = new mongoose.Types.ObjectId(qualRef);
    } else {
      const qual = await Qualification.findOne({ code: String(qualRef).trim() });
      if (qual) {
        query.qualificationId = qual._id;
      } else {
        return {
          items: [],
          total: 0,
          page: filters.page,
          pageSize: filters.pageSize,
          totalPages: 0,
        };
      }
    }
  }

  const nosRef = filters.nos || filters.nosId;
  if (nosRef) {
    query.nosId = String(nosRef).trim();
  }

  const pcRef = filters.pc || filters.pcId;
  if (pcRef) {
    query.pcId = String(pcRef).trim();
  }

  if (filters.type) {
    query.type = filters.type;
  }

  if (filters.language) {
    query.language = String(filters.language).trim().toLowerCase();
  }

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.difficulty) {
    query.difficulty = filters.difficulty;
  }

  if (filters.latestOnly !== false) {
    query.isLatest = true;
  }

  const page = Number(filters.page) || 1;
  const pageSize = Number(filters.pageSize) || 20;
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    Question.countDocuments(query),
    Question.find(query).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

function notLatestError(action) {
  return new AppError(
    409,
    "QUESTION_NOT_LATEST",
    `Cannot ${action} a question that is not the latest version`,
  );
}

function assertLatest(question, action) {
  if (!question.isLatest) throw notLatestError(action);
}

/**
 * Updates a question. Preserves the old version (setting isLatest: false)
 * and creates a new document with an incremented version number.
 * Never hard-deletes old content.
 */
export async function updateQuestion(user, id, data) {
  const existing = await Question.findById(id);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Question not found");
  }

  if (existing.status === "retired") {
    throw new AppError(409, "QUESTION_RETIRED", "Cannot update a retired question");
  }
  assertLatest(existing, "update");

  const qualRef = data.qualificationId || data.qualification || existing.qualificationId;
  const nosRef = data.nosId || data.nos || existing.nosId;
  const pcRef = data.pcId || data.pc || existing.pcId;

  const { qualification, nos, pc } = await resolveQualificationAndPc(qualRef, nosRef, pcRef);

  const nextType = data.type || existing.type;
  let nextOptions = existing.options;
  if (data.options !== undefined) {
    nextOptions = normalizeOptions(data.options);
  }

  let nextCorrectAnswer = existing.correctAnswer;
  if (data.correctAnswer !== undefined) {
    nextCorrectAnswer = data.correctAnswer ? String(data.correctAnswer).trim() : null;
  }

  if (nextType === "mcq") {
    nextCorrectAnswer = mcqKeyOrThrow(nextOptions, nextCorrectAnswer);
  }

  const newQuestion = new Question({
    qualificationId: qualification._id,
    nosId: nos.nosId || nos.code,
    pcId: pc.pcId || pc.code,
    type: nextType,
    language: data.language ? String(data.language).trim().toLowerCase() : existing.language,
    difficulty: data.difficulty !== undefined ? data.difficulty : existing.difficulty,
    bloomLevel: data.bloomLevel !== undefined ? data.bloomLevel : existing.bloomLevel,
    stem: data.stem !== undefined ? String(data.stem).trim() : existing.stem,
    options: nextOptions,
    correctAnswer: nextCorrectAnswer,
    marks: data.marks !== undefined ? Number(data.marks) : existing.marks,
    images:
      data.images !== undefined
        ? await checkedImages(data.images)
        : (existing.images ?? []).map((i) => ({ imageId: i.imageId, alt: i.alt })),
    status: "draft",
    version: existing.version + 1,
    rootQuestionId: existing.rootQuestionId || existing._id,
    previousVersionId: existing._id,
    isLatest: true,
    createdBy: existing.createdBy,
    updatedBy: user._id,
  });

  // Compare-and-set on isLatest, then insert the new version. Two edits at once: only one
  // wins the flip; the unique {rootQuestionId, version} index is the second guard.
  const flipped = await Question.findOneAndUpdate(
    { _id: existing._id, isLatest: true },
    { $set: { isLatest: false } },
    { new: true },
  );
  if (!flipped) throw notLatestError("update");
  try {
    await newQuestion.save();
  } catch (err) {
    await Question.updateOne({ _id: existing._id }, { $set: { isLatest: true } });
    if (err?.code === 11000) throw notLatestError("update");
    throw err;
  }

  return { question: newQuestion, previous: flipped };
}

/**
 * Retires a question (soft-delete). Never hard deletes.
 */
export async function retireQuestion(user, id) {
  const question = await Question.findById(id);
  if (!question) {
    throw new AppError(404, "NOT_FOUND", "Question not found");
  }

  if (question.status === "retired") {
    throw new AppError(409, "QUESTION_RETIRED", "The question is already retired");
  }
  assertLatest(question, "retire");

  const retired = await Question.findOneAndUpdate(
    { _id: question._id, isLatest: true, status: { $ne: "retired" } },
    { $set: { status: "retired", retiredBy: user._id, retiredAt: new Date() } },
    { new: true },
  );
  if (!retired) throw new AppError(409, "CONFLICT", "The question changed; reload and try again");

  return retired;
}

/**
 * Approves a question. Allowed for ab_reviewer and aa_admin.
 */
export async function approveQuestion(user, id) {
  const question = await Question.findById(id);
  if (!question) {
    throw new AppError(404, "NOT_FOUND", "Question not found");
  }

  if (question.status === "retired") {
    throw new AppError(409, "QUESTION_RETIRED", "Cannot approve a retired question");
  }

  assertLatest(question, "approve");
  if (question.status === "approved") {
    throw new AppError(409, "QUESTION_ALREADY_APPROVED", "The question is already approved");
  }

  const approved = await Question.findOneAndUpdate(
    { _id: question._id, isLatest: true, status: { $in: ["draft", "in_review"] } },
    { $set: { status: "approved", approvedBy: user._id, approvedAt: new Date() } },
    { new: true },
  );
  if (!approved) throw new AppError(409, "CONFLICT", "The question changed; reload and try again");

  return approved;
}

/**
 * X-10: sends a draft question for review (draft -> in_review). Same rules as approve for
 * retired and older versions.
 */
export async function submitQuestionForReview(_user, id) {
  const question = await Question.findById(id);
  if (!question) {
    throw new AppError(404, "NOT_FOUND", "Question not found");
  }
  if (question.status === "retired") {
    throw new AppError(409, "QUESTION_RETIRED", "Cannot submit a retired question");
  }
  assertLatest(question, "submit");
  if (question.status === "approved") {
    throw new AppError(409, "QUESTION_ALREADY_APPROVED", "The question is already approved");
  }
  if (question.status === "in_review") {
    throw new AppError(409, "QUESTION_ALREADY_IN_REVIEW", "The question is already in review");
  }
  const submitted = await Question.findOneAndUpdate(
    { _id: question._id, isLatest: true, status: "draft" },
    { $set: { status: "in_review" } },
    { new: true },
  );
  if (!submitted) throw new AppError(409, "CONFLICT", "The question changed; reload and try again");
  return submitted;
}

export const IMPORT_TEMPLATE_COLUMNS = Object.freeze([
  "qualification",
  "nos",
  "pc",
  "type",
  "language",
  "difficulty",
  "bloomLevel",
  "stem",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "optionE",
  "optionF",
  "correctAnswer",
  "marks",
  "imageAlt",
]);

/** X-10: an empty .xlsx with the columns the import reads, and a notes sheet after the data sheet. */
export async function buildImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questions");
  sheet.addRow([...IMPORT_TEMPLATE_COLUMNS]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = IMPORT_TEMPLATE_COLUMNS.map((header) => ({
    header,
    key: header,
    width: header === "stem" ? 60 : 16,
  }));
  const notes = workbook.addWorksheet("Notes");
  [
    ["Fill the Questions sheet, one question per row, and keep the header row."],
    ["qualification, nos and pc: the code or id, as shown in Master data."],
    ["type: mcq, short_answer, scenario, viva or practical. language: for example en."],
    ["difficulty (optional): easy, medium or tough. marks: 0.5 or more."],
    [
      "MCQ rows need at least two of optionA to optionF and a correctAnswer (an option letter or its text).",
    ],
    [
      "Pictures (optional): insert up to 3 PNG or JPEG pictures, 1 MB or less each, on the row of the question. Left to right is their order. Describe them in imageAlt, one description per picture, separated by |. A description is required for every picture.",
    ],
    ["Imported questions start as draft."],
  ].forEach((line) => notes.addRow(line));
  notes.getColumn(1).width = 100;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Coverage endpoint for a qualification:
 * Lists each PC with its approved question count, and flags PCs
 * with fewer than QUESTION_MIN_APPROVED_PER_PC approved questions.
 */
export async function getCoverage(_user, qualificationRef) {
  let qual = null;
  if (mongoose.Types.ObjectId.isValid(qualificationRef)) {
    qual = await Qualification.findById(qualificationRef);
  }
  if (!qual) {
    qual = await Qualification.findOne({
      code: String(qualificationRef).trim(),
    });
  }

  if (!qual) {
    throw new AppError(
      404,
      "QUALIFICATION_NOT_FOUND",
      `Qualification '${qualificationRef}' not found`,
    );
  }

  const approvedDocs = await Question.find({
    qualificationId: qual._id,
    status: "approved",
    isLatest: true,
  }).lean();

  const countByPc = new Map();
  for (const q of approvedDocs) {
    const key = String(q.pcId || "").toLowerCase();
    countByPc.set(key, (countByPc.get(key) || 0) + 1);
  }

  const pcs = [];
  for (const nos of qual.nos || []) {
    for (const pc of nos.pcs || []) {
      const pcIdKey = String(pc.pcId || "").toLowerCase();
      const pcCodeKey = String(pc.code || "").toLowerCase();
      const count =
        (countByPc.get(pcIdKey) || 0) + (pcCodeKey !== pcIdKey ? countByPc.get(pcCodeKey) || 0 : 0);
      const flagged = count < compliance.QUESTION_MIN_APPROVED_PER_PC;

      pcs.push({
        nosId: nos.nosId,
        nosCode: nos.code,
        pcId: pc.pcId,
        pcCode: pc.code,
        pcName: pc.name,
        approvedQuestionCount: count,
        flagged,
      });
    }
  }

  const totalPCs = pcs.length;
  const totalApprovedQuestions = approvedDocs.length;
  const averageApprovedQuestionsPerPc =
    totalPCs > 0 ? Number((totalApprovedQuestions / totalPCs).toFixed(2)) : 0;
  const flaggedPcsCount = pcs.filter((p) => p.flagged).length;

  return {
    qualificationId: qual._id,
    qualificationCode: qual.code,
    qualificationName: qual.name,
    totalPCs,
    totalApprovedQuestions,
    averageApprovedQuestionsPerPc,
    flaggedPcsCount,
    pcs,
  };
}

/**
 * Validates a single row for import.
 */
async function validateImportRow(row, rowIndex) {
  const errors = [];

  if (containsNationalIdKey(row)) {
    errors.push("National ID fields are not permitted");
  }

  const qualRef = row.qualification || row.qualificationId || row.qualificationCode;
  const nosRef = row.nos || row.nosId || row.nosCode;
  const pcRef = row.pc || row.pcId || row.pcCode;
  const type = String(row.type || "")
    .trim()
    .toLowerCase();
  const stem = String(row.stem || row.questionText || row.question || "").trim();
  const language = String(row.language || "")
    .trim()
    .toLowerCase();
  const marks = Number(row.marks);
  const difficulty = row.difficulty ? String(row.difficulty).trim().toLowerCase() : null;
  const bloomLevel = row.bloomLevel ? String(row.bloomLevel).trim() : null;

  if (!qualRef) errors.push("Missing qualification");
  if (!nosRef) errors.push("Missing NOS");
  if (!pcRef) errors.push("Missing PC");
  if (!stem) errors.push("Missing stem / question text");
  if (!language) errors.push("Missing language");

  if (!QUESTION_TYPES.includes(type)) {
    errors.push(`Invalid type '${type}'. Must be one of: ${QUESTION_TYPES.join(", ")}`);
  }

  if (isNaN(marks) || marks < 0.5) {
    errors.push("Marks must be a positive number (minimum 0.5)");
  }

  if (difficulty && !QUESTION_DIFFICULTIES.includes(difficulty)) {
    errors.push(
      `Invalid difficulty '${difficulty}'. Must be one of: ${QUESTION_DIFFICULTIES.join(", ")}`,
    );
  }

  let options = [];
  let correctAnswer = row.correctAnswer ? String(row.correctAnswer).trim() : null;

  if (type === "mcq") {
    // Extract options from columns: optionA, optionB, etc. or options list
    if (row.optionA || row.optionB) {
      const keys = ["A", "B", "C", "D", "E", "F"];
      for (const k of keys) {
        const text = row[`option${k}`] || row[`option_${k}`] || row[`option_${k.toLowerCase()}`];
        if (text && String(text).trim()) {
          options.push({ key: k, text: String(text).trim() });
        }
      }
    } else if (Array.isArray(row.options)) {
      options = normalizeOptions(row.options);
    } else if (typeof row.options === "string") {
      const parts = row.options
        .split(/\r?\n|;/)
        .map((s) => s.trim())
        .filter(Boolean);
      options = normalizeOptions(parts);
    }

    if (options.length < 2) {
      errors.push("MCQ must have at least 2 options (e.g. optionA, optionB)");
    }

    if (hasDuplicateOptionKeys(options)) {
      errors.push("Option keys must be unique (compared without case)");
    }

    if (!correctAnswer) {
      errors.push("MCQ requires a correctAnswer");
    } else {
      const key = resolveMcqKey(options, correctAnswer);
      if (key === null) {
        errors.push("MCQ correct answer does not match any provided option key or text");
      } else {
        correctAnswer = key;
      }
    }
  }

  // X-26: pictures placed on the row. Each needs a description; the type comes from the bytes.
  const pictures = Array.isArray(row.__pictures) ? row.__pictures : [];
  const alts = String(row.imageAlt ?? "")
    .split("|")
    .map((text) => text.trim());
  if (pictures.length > QUESTION_IMAGES_PER_QUESTION) {
    errors.push(`At most ${QUESTION_IMAGES_PER_QUESTION} pictures per question`);
  }
  pictures.forEach((bytes, index) => {
    const label = `Picture ${index + 1}`;
    if (bytes.length > QUESTION_IMAGE_MAX_BYTES) errors.push(`${label} is larger than 1 MB`);
    const kind = sniffContentType(bytes.subarray(0, 1024));
    if (kind !== "image/png" && kind !== "image/jpeg") errors.push(`${label} must be PNG or JPEG`);
    if (!alts[index]) errors.push(`${label} needs a description in imageAlt`);
    else if (alts[index].length > 300) errors.push(`${label} description is over 300 characters`);
  });
  if (pictures.length === 0 && alts.some(Boolean)) {
    errors.push("imageAlt is filled in but the row has no pictures");
  }

  let resolved = null;
  if (qualRef && nosRef && pcRef) {
    try {
      resolved = await resolveQualificationAndPc(qualRef, nosRef, pcRef);
    } catch (err) {
      errors.push(err.message);
    }
  }

  return {
    row: rowIndex,
    valid: errors.length === 0,
    errors,
    data:
      errors.length === 0
        ? {
            qualificationId: resolved.qualification._id,
            nosId: resolved.nos.nosId || resolved.nos.code,
            pcId: resolved.pc.pcId || resolved.pc.code,
            type,
            language,
            difficulty,
            bloomLevel,
            stem,
            options,
            correctAnswer,
            marks,
            status: "draft",
            version: 1,
            isLatest: true,
            pictures: pictures.map((bytes, index) => ({ bytes, alt: alts[index] })),
          }
        : null,
  };
}

export const MAX_IMPORT_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (X-26: pictures are inside the file)
export const MAX_IMPORT_ROWS = 5000;

/** X-26: the pictures placed on each sheet row, left to right. Keys are 1-based sheet rows. */
function picturesByRow(workbook, worksheet) {
  const byRow = new Map();
  for (const placed of worksheet.getImages?.() ?? []) {
    const row = (placed.range?.tl?.nativeRow ?? -1) + 1;
    const image = workbook.getImage(placed.imageId);
    if (row < 2 || !image?.buffer) continue;
    const list = byRow.get(row) ?? [];
    list.push({ col: placed.range.tl.nativeCol ?? 0, buffer: Buffer.from(image.buffer) });
    byRow.set(row, list);
  }
  for (const list of byRow.values()) list.sort((a, b) => a.col - b.col);
  return byRow;
}

function extractRowsFromExcelWorksheet(worksheet, workbook = null) {
  if (!worksheet || worksheet.rowCount < 2) return [];
  const pictures = workbook ? picturesByRow(workbook, worksheet) : new Map();
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    let val = cell.value;
    if (typeof val === "object" && val !== null) {
      if (val.text !== undefined) val = val.text;
      else if (val.result !== undefined) val = val.result;
    }
    headers[colNumber] = val != null ? String(val).trim() : "";
  });

  const rows = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    let hasValue = false;
    const rowObj = {};
    for (let c = 1; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;
      const cell = row.getCell(c);
      let val = cell.value;
      if (val === null || val === undefined) {
        val = "";
      } else if (typeof val === "object") {
        if (Array.isArray(val.richText)) {
          val = val.richText.map((t) => t.text).join("");
        } else if (val.text !== undefined) {
          val = val.text;
        } else if (val.result !== undefined) {
          val = val.result;
        } else if (val instanceof Date) {
          val = val.toISOString();
        } else {
          val = String(val);
        }
      }
      val = typeof val === "string" ? val.trim() : val;
      if (val !== "") hasValue = true;
      rowObj[header] = val;
    }
    const placed = pictures.get(r);
    if (placed) {
      hasValue = true;
      rowObj.__pictures = placed.map((p) => p.buffer);
    }
    if (hasValue) {
      rows.push(rowObj);
    }
  }
  return rows;
}

/**
 * Imports questions from an Excel (.xlsx) buffer or parsed rows array.
 * Validates every row; returns a per-row error report.
 * If any row fails, imports nothing unless partial=true.
 */
export async function importQuestions(user, { buffer, rows: inputRows, partial = false }) {
  let rows = inputRows;

  if (buffer) {
    if (buffer.length > MAX_IMPORT_FILE_SIZE) {
      throw new AppError(400, "FILE_TOO_LARGE", "File size exceeds the 25 MB limit");
    }

    // Only .xlsx accepted (ZIP package with PK\x03\x04 header)
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x50 ||
      buffer[1] !== 0x4b ||
      buffer[2] !== 0x03 ||
      buffer[3] !== 0x04
    ) {
      throw new AppError(400, "INVALID_FILE_TYPE", "Only .xlsx files are accepted");
    }

    // Check for macros (e.g. xl/vbaProject.bin, macroEnabled)
    if (
      buffer.includes(Buffer.from("vbaProject.bin")) ||
      buffer.includes(Buffer.from("macroEnabled"))
    ) {
      throw new AppError(400, "MACROS_NOT_ALLOWED", "Excel files with macros are not accepted");
    }

    // Check for external links (e.g. xl/externalLinks/)
    if (
      buffer.includes(Buffer.from("externalLinks")) ||
      buffer.includes(Buffer.from("xl/externalLinks"))
    ) {
      throw new AppError(
        400,
        "EXTERNAL_LINKS_NOT_ALLOWED",
        "Excel files with external links are not accepted",
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch (err) {
      throw new AppError(
        400,
        "INVALID_FILE_TYPE",
        `Failed to parse Excel workbook: ${err.message}`,
      );
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new AppError(400, "EMPTY_EXCEL_FILE", "Excel workbook contains no sheets");
    }

    rows = extractRowsFromExcelWorksheet(worksheet, workbook);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError(400, "NO_DATA", "No rows found to import");
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      400,
      "ROW_LIMIT_EXCEEDED",
      `Maximum ${MAX_IMPORT_ROWS} rows allowed for import`,
    );
  }

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    // Row numbers are 2-indexed to account for header row in spreadsheet
    const validated = await validateImportRow(rows[i], i + 2);
    results.push(validated);
  }

  const failed = results.filter((r) => !r.valid);
  const valid = results.filter((r) => r.valid);

  if (failed.length > 0 && !partial) {
    return {
      success: false,
      code: "IMPORT_VALIDATION_FAILED",
      totalRows: rows.length,
      importedCount: 0,
      errorCount: failed.length,
      errors: failed.map((f) => ({ row: f.row, errors: f.errors })),
    };
  }

  const inserted = [];
  for (const item of valid) {
    const { pictures, ...fields } = item.data;
    const images = [];
    for (const { bytes, alt } of pictures) {
      const saved = await uploadQuestionImage(user, bytes);
      images.push({ imageId: saved.id, alt });
    }
    const doc = new Question({
      ...fields,
      images,
      createdBy: user._id,
    });
    doc.rootQuestionId = doc._id;
    await doc.save();
    inserted.push(doc);
  }

  return {
    success: true,
    totalRows: rows.length,
    importedCount: inserted.length,
    errorCount: failed.length,
    errors: failed.map((f) => ({ row: f.row, errors: f.errors })),
    imported: inserted,
  };
}
