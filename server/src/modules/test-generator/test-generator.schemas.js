import { z } from "zod";
import { QUESTION_TYPES } from "../../models/question.model.js";
import { TEST_PAPER_STATUSES } from "../../models/test-paper.model.js";
import { assertNoNationalIdKeys } from "../question-bank/question-bank.schemas.js";

const guard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

const quotaSchema = z
  .object({
    nosId: z.string().trim().min(1).max(64),
    type: z.enum(QUESTION_TYPES).optional(),
    count: z.number().int().min(1).max(500),
  })
  .strict();

export const generateSchema = guard(
  z
    .object({
      qualificationId: z.string().trim().min(1).max(64),
      language: z.string().trim().min(1).max(32),
      name: z.string().trim().min(1).max(80).optional(),
      quotas: z.array(quotaSchema).min(1).max(200),
      totalMarks: z.number().positive().max(100000).optional(),
      durationMinutes: z.number().int().min(1).max(600).optional(),
      seed: z.number().int().min(0).max(4294967295).optional(),
      allowPartial: z.boolean().optional(),
      weightProfileId: z
        .string()
        .regex(/^[a-fA-F0-9]{24}$/, "Invalid weight profile ID")
        .optional(),
      version: z.number().int().min(1).max(100000).optional(),
    })
    .strict()
    .refine((v) => v.version === undefined || v.weightProfileId !== undefined, {
      message: "version needs weightProfileId",
      path: ["version"],
    }),
);

export const idParamSchema = z
  .object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid test paper ID") })
  .strict();

export const getQuerySchema = z
  .object({
    withQuestions: z.enum(["true", "false"]).optional(),
    itemPage: z.coerce.number().int().min(1).max(1_000_000).default(1),
  })
  .strict();

export const listQuerySchema = z
  .object({
    qualificationId: z.string().trim().min(1).max(64).optional(),
    status: z.enum(TEST_PAPER_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
