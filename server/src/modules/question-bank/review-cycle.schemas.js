import { z } from "zod";
import { compliance } from "../../config/compliance.js";
import { REVIEW_CYCLE_STATUSES, REVIEW_DECISIONS } from "../../models/review-cycle.model.js";
import { assertNoNationalIdKeys } from "./question-bank.schemas.js";

const nationalIdGuard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

const objectId = (label) => z.string().regex(/^[a-fA-F0-9]{24}$/, `Invalid ${label}`);

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

export const MAX_CYCLE_QUESTIONS = 1000;

export const cycleIdParamSchema = z.object({ id: objectId("review cycle ID") }).strict();

export const qualificationParamSchema = z
  .object({ qualificationId: objectId("qualification ID") })
  .strict();

export const createCycleSchema = nationalIdGuard(
  z
    .object({
      qualificationId: objectId("qualification ID"),
      abId: objectId("awarding body ID"),
      reviewerId: objectId("reviewer ID"),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD"),
      // Left out: every approved, latest question of the qualification.
      questionIds: z.array(objectId("question ID")).min(1).max(MAX_CYCLE_QUESTIONS).optional(),
    })
    .strict(),
);

export const listCyclesQuerySchema = nationalIdGuard(
  z
    .object({
      status: z.enum(REVIEW_CYCLE_STATUSES).optional(),
      qualificationId: objectId("qualification ID").optional(),
      abId: objectId("awarding body ID").optional(),
      page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
      pageSize: queryNumber({ min: 1, max: 100, fallback: 20 }),
    })
    .strict(),
);

export const decisionSchema = nationalIdGuard(
  z
    .object({
      questionId: objectId("question ID"),
      decision: z.enum(REVIEW_DECISIONS),
      comment: z.string().trim().min(1).max(2000),
      // Only for `revise`: fields of the new version, as for PUT /questions/:id (no status).
      changes: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .refine((data) => data.changes === undefined || data.decision === "revise", {
      message: "changes is only allowed with decision revise",
      path: ["changes"],
    })
    .refine((data) => data.changes === undefined || !("status" in data.changes), {
      message: "changes cannot set status; a revised version is always a draft",
      path: ["changes"],
    }),
);

export const closeCycleSchema = nationalIdGuard(
  z.object({ allowIncomplete: z.boolean().optional() }).strict(),
);

export const intervalSchema = nationalIdGuard(
  z
    .object({
      intervalMonths: z
        .number()
        .int()
        .min(compliance.QUESTION_REVIEW_INTERVAL_MIN_MONTHS)
        .max(compliance.QUESTION_REVIEW_INTERVAL_MAX_MONTHS),
    })
    .strict(),
);

export const reviewDueQuerySchema = nationalIdGuard(
  z
    .object({
      page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
      pageSize: queryNumber({ min: 1, max: 100, fallback: 20 }),
    })
    .strict(),
);
