import { z } from "zod";
import { QUESTION_DIFFICULTIES } from "../../models/question.model.js";
import { BLOOM_LEVELS, WEIGHT_PROFILE_STATUSES } from "../../models/weight-profile.model.js";
import { assertNoNationalIdKeys } from "../question-bank/question-bank.schemas.js";
import { weightsSumToHundred } from "../test-generator/weight-math.js";

const guard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

const percent = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimal places");

const sumsTo100 = [weightsSumToHundred, { message: "Weights must add up to 100" }];

/** All three difficulties are required. */
const difficultyWeights = z
  .object(Object.fromEntries(QUESTION_DIFFICULTIES.map((k) => [k, percent])))
  .strict()
  .refine(...sumsTo100);

/** A Bloom level left out counts as 0. */
const bloomWeights = z
  .object(Object.fromEntries(BLOOM_LEVELS.map((k) => [k, percent.optional()])))
  .strict()
  .transform((w) => Object.fromEntries(BLOOM_LEVELS.map((k) => [k, w[k] ?? 0])))
  .refine(...sumsTo100);

const qualificationRef = z.string().trim().min(1).max(64);

export const createSchema = guard(
  z
    .object({
      name: z.string().trim().min(1).max(120),
      qualificationId: qualificationRef.optional(),
      difficultyWeights,
      bloomWeights,
    })
    .strict(),
);

export const editSchema = guard(
  z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      qualificationId: qualificationRef.nullable().optional(),
      difficultyWeights: difficultyWeights.optional(),
      bloomWeights: bloomWeights.optional(),
      expectedVersion: z.number().int().min(1).max(100000).optional(),
    })
    .strict()
    .refine(
      (v) => Object.keys(v).some((k) => k !== "expectedVersion"),
      "Send at least one field to change",
    ),
);

export const approveSchema = guard(
  z.object({ version: z.number().int().min(1).max(100000).optional() }).strict(),
);

export const idParamSchema = z
  .object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid weight profile ID") })
  .strict();

export const getQuerySchema = z
  .object({ version: z.coerce.number().int().min(1).max(100000).optional() })
  .strict();

export const listQuerySchema = z
  .object({
    qualificationId: qualificationRef.optional(),
    status: z.enum(WEIGHT_PROFILE_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
