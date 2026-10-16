import { z } from "zod";
import { ATTEMPT_STATUSES } from "../../models/attempt.model.js";
import { assertNoNationalIdKeys } from "../question-bank/question-bank.schemas.js";

const guard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

const objectId = (label) => z.string().regex(/^[a-fA-F0-9]{24}$/, `Invalid ${label}`);

export const idParamSchema = z.object({ id: objectId("attempt ID") }).strict();

export const getQuerySchema = z
  .object({ itemPage: z.coerce.number().int().min(1).max(1_000_000).default(1) })
  .strict();

export const startSchema = guard(
  z.object({ batchId: objectId("batch ID"), testPaperId: objectId("test paper ID") }).strict(),
);

const answerSchema = z
  .object({
    questionId: objectId("question ID"),
    answer: z.string().max(10000).nullable(),
  })
  .strict();

export const answersSchema = guard(
  z
    .object({ answers: z.array(answerSchema).min(1).max(200) })
    .strict()
    .superRefine((val, ctx) => {
      const seen = new Set();
      val.answers.forEach((a, i) => {
        const id = a.questionId.toLowerCase();
        if (seen.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["answers", i, "questionId"],
            message: "Duplicate questionId",
          });
        }
        seen.add(id);
      });
    }),
);

const markSchema = z
  .object({
    questionId: objectId("question ID"),
    marks: z
      .number()
      .min(0)
      .max(100000)
      .refine((n) => Math.round(n * 100) / 100 === n, "At most two decimal places"),
  })
  .strict();

export const manualMarksSchema = guard(
  z
    .object({ marks: z.array(markSchema).min(1).max(200) })
    .strict()
    .superRefine((val, ctx) => {
      const seen = new Set();
      val.marks.forEach((m, i) => {
        const id = m.questionId.toLowerCase();
        if (seen.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["marks", i, "questionId"],
            message: "Duplicate questionId",
          });
        }
        seen.add(id);
      });
    }),
);

export const listQuerySchema = z
  .object({
    batchId: objectId("batch ID").optional(),
    testPaperId: objectId("test paper ID").optional(),
    status: z.enum(ATTEMPT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
