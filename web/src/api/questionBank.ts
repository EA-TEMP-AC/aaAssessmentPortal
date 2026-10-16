import { ApiError, apiRequest } from "./client";

/**
 * Question bank (Q-01, X-10). Paths and errors follow API_CONTRACT.md "Question bank".
 * Question text and answers are confidential: nothing here stores them outside React state,
 * and a page is never larger than QUESTION_PAGE_SIZE (the server refuses more).
 */

export const QUESTION_PAGE_SIZE = 50;

export const QUESTION_TYPES = [
  "mcq",
  "short_answer",
  "scenario",
  "viva",
  "practical",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  short_answer: "Short answer",
  scenario: "Scenario",
  viva: "Viva",
  practical: "Practical",
};

export const QUESTION_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "retired",
] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  retired: "Retired",
};

export const DIFFICULTIES = ["easy", "medium", "tough"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

export type QuestionOption = { key: string; text: string };

export type Question = {
  id: string;
  qualificationId: string;
  nosId: string;
  pcId: string;
  type: QuestionType;
  language: string;
  difficulty: Difficulty | null;
  bloomLevel: string | null;
  stem: string;
  options: QuestionOption[];
  correctAnswer: string | null;
  marks: number;
  status: QuestionStatus;
  version: number;
  isLatest: boolean;
};

export type QuestionFilters = {
  qualification: string;
  nos: string;
  pc: string;
  type: string;
  language: string;
  status: string;
};

export const EMPTY_QUESTION_FILTERS: QuestionFilters = {
  qualification: "",
  nos: "",
  pc: "",
  type: "",
  language: "",
  status: "",
};

export type QuestionPage = {
  items: Question[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type QuestionWrite = {
  qualificationId: string;
  nosId: string;
  pcId: string;
  type: QuestionType;
  language: string;
  difficulty: Difficulty | null;
  bloomLevel: string | null;
  stem: string;
  options: QuestionOption[];
  correctAnswer: string | null;
  marks: number;
};

export type ImportRowError = { row: number; errors: string[] };

export type ImportResult = {
  totalRows: number;
  importedCount: number;
  errorCount: number;
  errors: ImportRowError[];
};

function responseError(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "Question bank response was not recognised.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" &&
    (list as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function parseQuestion(value: unknown): Question {
  if (!isRecord(value)) throw responseError();
  const id =
    typeof value._id === "string"
      ? value._id
      : typeof value.id === "string"
        ? value.id
        : "";
  const type = oneOf(QUESTION_TYPES, value.type);
  const status = oneOf(QUESTION_STATUSES, value.status);
  if (
    !id ||
    !type ||
    !status ||
    typeof value.qualificationId !== "string" ||
    typeof value.nosId !== "string" ||
    typeof value.pcId !== "string" ||
    typeof value.language !== "string" ||
    typeof value.stem !== "string" ||
    typeof value.marks !== "number" ||
    typeof value.version !== "number"
  ) {
    throw responseError();
  }
  const options = Array.isArray(value.options)
    ? value.options.flatMap((item): QuestionOption[] =>
        isRecord(item) &&
        typeof item.key === "string" &&
        typeof item.text === "string"
          ? [{ key: item.key, text: item.text }]
          : [],
      )
    : [];
  return {
    id,
    qualificationId: value.qualificationId,
    nosId: value.nosId,
    pcId: value.pcId,
    type,
    language: value.language,
    difficulty: oneOf(DIFFICULTIES, value.difficulty),
    bloomLevel: typeof value.bloomLevel === "string" ? value.bloomLevel : null,
    stem: value.stem,
    options,
    correctAnswer:
      typeof value.correctAnswer === "string" ? value.correctAnswer : null,
    marks: value.marks,
    status,
    version: value.version,
    isLatest: value.isLatest !== false,
  };
}

function parsePage(value: unknown): QuestionPage {
  if (!isRecord(value) || !Array.isArray(value.items)) throw responseError();
  const { total, page, pageSize } = value;
  if (
    typeof total !== "number" ||
    typeof page !== "number" ||
    typeof pageSize !== "number"
  )
    throw responseError();
  const totalPages =
    typeof value.totalPages === "number"
      ? value.totalPages
      : Math.max(1, Math.ceil(total / pageSize));
  return {
    items: value.items.map(parseQuestion),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function listQuestions(
  filters: QuestionFilters,
  page: number,
  signal?: AbortSignal,
): Promise<QuestionPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim()) params.set(key, value.trim());
  }
  params.set("page", String(page));
  params.set("pageSize", String(QUESTION_PAGE_SIZE));
  return parsePage(
    await apiRequest<unknown>(`/question-bank/questions?${params.toString()}`, {
      signal,
    }),
  );
}

export async function createQuestion(input: QuestionWrite): Promise<Question> {
  return parseQuestion(
    await apiRequest<unknown>("/question-bank/questions", {
      method: "POST",
      body: input,
    }),
  );
}

/** Creates the next version. The old version stays, no longer the latest. */
export async function updateQuestion(
  id: string,
  input: QuestionWrite,
): Promise<Question> {
  return parseQuestion(
    await apiRequest<unknown>(`/question-bank/questions/${id}`, {
      method: "PUT",
      body: input,
    }),
  );
}

export async function submitQuestionForReview(id: string): Promise<Question> {
  return parseQuestion(
    await apiRequest<unknown>(
      `/question-bank/questions/${id}/submit-for-review`,
      { method: "POST" },
    ),
  );
}

export async function approveQuestion(id: string): Promise<Question> {
  return parseQuestion(
    await apiRequest<unknown>(`/question-bank/questions/${id}/approve`, {
      method: "POST",
    }),
  );
}

export async function downloadImportTemplate(): Promise<Blob> {
  const response = await apiRequest<Response>(
    "/question-bank/import-template",
    { raw: true },
  );
  return response.blob();
}

function parseRowErrors(value: unknown): ImportRowError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ImportRowError[] => {
    if (!isRecord(item) || typeof item.row !== "number") return [];
    const errors = Array.isArray(item.errors)
      ? item.errors.filter((e): e is string => typeof e === "string")
      : [];
    return [{ row: item.row, errors }];
  });
}

/** A refused import (nothing saved) carries the same report in ApiError.details. */
export function importReportFromError(error: unknown): ImportResult | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== "IMPORT_VALIDATION_FAILED" ||
    !isRecord(error.details)
  ) {
    return null;
  }
  const { details } = error;
  return {
    totalRows: typeof details.totalRows === "number" ? details.totalRows : 0,
    importedCount: 0,
    errorCount:
      typeof details.errorCount === "number"
        ? details.errorCount
        : parseRowErrors(details.errors).length,
    errors: parseRowErrors(details.errors),
  };
}

export async function importQuestions(
  file: Blob,
  validRowsOnly: boolean,
): Promise<ImportResult> {
  const body = await apiRequest<unknown>(
    `/question-bank/import${validRowsOnly ? "?partial=true" : ""}`,
    {
      method: "POST",
      body: file,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    },
  );
  if (!isRecord(body)) throw responseError();
  const errors = parseRowErrors(body.errors);
  return {
    totalRows: typeof body.totalRows === "number" ? body.totalRows : 0,
    importedCount:
      typeof body.importedCount === "number" ? body.importedCount : 0,
    errorCount:
      typeof body.errorCount === "number" ? body.errorCount : errors.length,
    errors,
  };
}
