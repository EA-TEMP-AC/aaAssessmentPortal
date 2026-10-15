import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { AppError } from "../../lib/errors.js";
import { Qualification } from "../../models/qualification.model.js";
import { Question, QUESTION_DIFFICULTIES, QUESTION_TYPES } from "../../models/question.model.js";
import { containsNationalIdKey, normalizeOptions } from "./question-bank.schemas.js";

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
 * Creates a new question in draft status (version 1).
 */
export async function createQuestion(user, data) {
  const qualRef = data.qualificationId || data.qualification;
  const nosRef = data.nosId || data.nos;
  const pcRef = data.pcId || data.pc;

  const { qualification, nos, pc } = await resolveQualificationAndPc(qualRef, nosRef, pcRef);

  const normalizedOptions = normalizeOptions(data.options);
  if (data.type === "mcq") {
    if (normalizedOptions.length < 2) {
      throw new AppError(400, "INVALID_OPTIONS", "MCQ questions must have at least 2 options");
    }
    const answer = String(data.correctAnswer || "")
      .trim()
      .toLowerCase();
    const hasMatch = normalizedOptions.some(
      (o) => o.key.toLowerCase() === answer || o.text.toLowerCase() === answer,
    );
    if (!hasMatch) {
      throw new AppError(
        400,
        "INVALID_CORRECT_ANSWER",
        "MCQ correct answer must match one of the option keys or option text",
      );
    }
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
    correctAnswer: data.correctAnswer ? String(data.correctAnswer).trim() : null,
    marks: Number(data.marks),
    status: data.status && data.status !== "approved" ? data.status : "draft",
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
    if (nextOptions.length < 2) {
      throw new AppError(400, "INVALID_OPTIONS", "MCQ questions must have at least 2 options");
    }
    const answer = String(nextCorrectAnswer || "")
      .trim()
      .toLowerCase();
    const hasMatch = nextOptions.some(
      (o) => o.key.toLowerCase() === answer || o.text.toLowerCase() === answer,
    );
    if (!hasMatch) {
      throw new AppError(
        400,
        "INVALID_CORRECT_ANSWER",
        "MCQ correct answer must match one of the option keys or option text",
      );
    }
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
    status: data.status && data.status !== "approved" ? data.status : "draft",
    version: existing.version + 1,
    rootQuestionId: existing.rootQuestionId || existing._id,
    previousVersionId: existing._id,
    isLatest: true,
    createdBy: existing.createdBy,
    updatedBy: user._id,
  });

  existing.isLatest = false;
  await Promise.all([existing.save(), newQuestion.save()]);

  return { question: newQuestion, previous: existing };
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
    return question;
  }

  question.status = "retired";
  question.retiredBy = user._id;
  question.retiredAt = new Date();
  await question.save();

  return question;
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

  question.status = "approved";
  question.approvedBy = user._id;
  question.approvedAt = new Date();
  await question.save();

  return question;
}

/**
 * Coverage endpoint for a qualification:
 * Lists each PC with its approved question count, and flags PCs
 * with fewer than 5 approved questions.
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
      const flagged = count < 5;

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

    if (!correctAnswer) {
      errors.push("MCQ requires a correctAnswer");
    } else {
      const answerClean = correctAnswer.toLowerCase();
      const hasMatch = options.some(
        (o) => o.key.toLowerCase() === answerClean || o.text.toLowerCase() === answerClean,
      );
      if (!hasMatch) {
        errors.push("MCQ correct answer does not match any provided option key or text");
      }
    }
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
          }
        : null,
  };
}

/**
 * Imports questions from an Excel (.xlsx) buffer or parsed rows array.
 * Validates every row; returns a per-row error report.
 * If any row fails, imports nothing unless partial=true.
 */
export async function importQuestions(user, { buffer, rows: inputRows, partial = false }) {
  let rows = inputRows;

  if (buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new AppError(400, "EMPTY_EXCEL_FILE", "Excel workbook contains no sheets");
    }
    const worksheet = workbook.Sheets[firstSheetName];
    rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError(400, "NO_DATA", "No rows found to import");
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
    const doc = new Question({
      ...item.data,
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
