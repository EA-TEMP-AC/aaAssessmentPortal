import { z } from "zod";
import { MAX_QUESTIONS_PER_PAGE } from "../../config/content-controls.js";
import { isNationalIdKey } from "../../lib/redact.js";
import { QUESTION_DIFFICULTIES, QUESTION_TYPES } from "../../models/question.model.js";

export function containsNationalIdKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsNationalIdKey(item));
  }
  for (const [key, nested] of Object.entries(value)) {
    if (isNationalIdKey(key)) return true;
    if (typeof nested === "object" && containsNationalIdKey(nested)) return true;
  }
  return false;
}

import { AppError } from "../../lib/errors.js";

export function assertNoNationalIdKeys(value) {
  if (containsNationalIdKey(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "National ID fields are not permitted", {
      nationalId: ["National ID fields are not permitted"],
    });
  }
}

const nationalIdGuard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

const imageItemSchema = z
  .object({
    imageId: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid image ID"),
    alt: z.string().trim().min(1).max(300),
  })
  .strict();
const imagesSchema = z.array(imageItemSchema).max(3);

const optionItemSchema = z.union([
  z
    .object({
      key: z.string().trim().min(1).max(16),
      text: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .transform((text) => ({
      key: "TEMP",
      text,
    })),
]);

export function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((opt, idx) => {
    if (typeof opt === "string") {
      const charCode = 65 + idx; // A, B, C...
      return { key: String.fromCharCode(charCode), text: opt.trim() };
    }
    if (opt && typeof opt === "object") {
      const key =
        opt.key === "TEMP"
          ? String.fromCharCode(65 + idx)
          : opt.key || String.fromCharCode(65 + idx);
      return { key: String(key).trim(), text: String(opt.text || "").trim() };
    }
    return { key: String.fromCharCode(65 + idx), text: String(opt).trim() };
  });
}

/** True when two options share a key, compared case-insensitively. */
export function hasDuplicateOptionKeys(options) {
  const seen = new Set();
  for (const o of options) {
    const k = String(o.key).trim().toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/**
 * The option key a stored or submitted MCQ answer points to: matches an option key first,
 * then option text, case-insensitively. Returns null when nothing matches.
 */
export function resolveMcqKey(options, answer) {
  const a = String(answer ?? "")
    .trim()
    .toLowerCase();
  if (a === "") return null;
  const byKey = options.find((o) => String(o.key).trim().toLowerCase() === a);
  if (byKey) return byKey.key;
  const byText = options.find((o) => String(o.text).trim().toLowerCase() === a);
  return byText ? byText.key : null;
}

export const idParamSchema = z
  .object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid question ID"),
  })
  .strict();

export const coverageParamSchema = z
  .object({
    qualificationId: z.string().trim().min(1, "Qualification ID is required"),
  })
  .strict();

export const createQuestionSchema = nationalIdGuard(
  z
    .object({
      qualificationId: z.string().trim().min(1).optional(),
      qualification: z.string().trim().min(1).optional(),
      nosId: z.string().trim().min(1).max(64).optional(),
      nos: z.string().trim().min(1).max(64).optional(),
      pcId: z.string().trim().min(1).max(64).optional(),
      pc: z.string().trim().min(1).max(64).optional(),
      type: z.enum(QUESTION_TYPES),
      language: z.string().trim().min(1).max(32),
      difficulty: z.enum(QUESTION_DIFFICULTIES).nullable().optional(),
      bloomLevel: z.string().trim().min(1).max(64).nullable().optional(),
      stem: z.string().trim().min(1).max(10000),
      options: z.array(optionItemSchema).optional(),
      correctAnswer: z.string().trim().max(2000).nullable().optional(),
      marks: z.coerce.number().positive().min(0.5),
      images: imagesSchema.optional(),
    })
    .strict()
    .refine((data) => data.qualificationId || data.qualification, {
      message: "Qualification is required (qualificationId or qualification)",
      path: ["qualificationId"],
    })
    .refine((data) => data.nosId || data.nos, {
      message: "NOS is required (nosId or nos)",
      path: ["nosId"],
    })
    .refine((data) => data.pcId || data.pc, {
      message: "Performance Criteria (PC) is required (pcId or pc)",
      path: ["pcId"],
    })
    .refine(
      (data) => {
        if (data.type === "mcq") {
          const opts = normalizeOptions(data.options);
          return opts.length >= 2;
        }
        return true;
      },
      {
        message: "MCQ questions must have at least 2 options",
        path: ["options"],
      },
    )
    .refine(
      (data) => data.type !== "mcq" || !hasDuplicateOptionKeys(normalizeOptions(data.options)),
      {
        message: "Option keys must be unique (compared without case)",
        path: ["options"],
      },
    )
    .refine(
      (data) => {
        if (data.type === "mcq") {
          if (!data.correctAnswer) return false;
          const opts = normalizeOptions(data.options);
          const answerTrim = data.correctAnswer.trim().toLowerCase();
          return opts.some(
            (o) => o.key.toLowerCase() === answerTrim || o.text.toLowerCase() === answerTrim,
          );
        }
        return true;
      },
      {
        message: "MCQ correct answer must match one of the option keys or option text",
        path: ["correctAnswer"],
      },
    ),
);

export const updateQuestionSchema = nationalIdGuard(
  z
    .object({
      qualificationId: z.string().trim().min(1).optional(),
      qualification: z.string().trim().min(1).optional(),
      nosId: z.string().trim().min(1).max(64).optional(),
      nos: z.string().trim().min(1).max(64).optional(),
      pcId: z.string().trim().min(1).max(64).optional(),
      pc: z.string().trim().min(1).max(64).optional(),
      type: z.enum(QUESTION_TYPES).optional(),
      language: z.string().trim().min(1).max(32).optional(),
      difficulty: z.enum(QUESTION_DIFFICULTIES).nullable().optional(),
      bloomLevel: z.string().trim().min(1).max(64).nullable().optional(),
      stem: z.string().trim().min(1).max(10000).optional(),
      options: z.array(optionItemSchema).optional(),
      correctAnswer: z.string().trim().max(2000).nullable().optional(),
      marks: z.coerce.number().positive().min(0.5).optional(),
      images: imagesSchema.optional(),
    })
    .strict(),
);

export const listQuestionsQuerySchema = nationalIdGuard(
  z
    .object({
      qualification: z.string().trim().optional(),
      qualificationId: z.string().trim().optional(),
      nos: z.string().trim().optional(),
      nosId: z.string().trim().optional(),
      pc: z.string().trim().optional(),
      pcId: z.string().trim().optional(),
      type: z.string().trim().optional(),
      language: z.string().trim().optional(),
      status: z.string().trim().optional(),
      difficulty: z.string().trim().optional(),
      latestOnly: z.preprocess((val) => {
        if (val === undefined || val === "") return true;
        if (val === "false" || val === false) return false;
        return true;
      }, z.boolean()),
      page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
      pageSize: queryNumber({ min: 1, max: MAX_QUESTIONS_PER_PAGE, fallback: 20 }),
    })
    .strict(),
);

export const importQuerySchema = nationalIdGuard(
  z
    .object({
      partial: z.preprocess((val) => {
        if (val === "true" || val === true) return true;
        return false;
      }, z.boolean().default(false)),
    })
    .strict(),
);
