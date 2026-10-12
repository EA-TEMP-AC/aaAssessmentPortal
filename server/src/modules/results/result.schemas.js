import { z } from "zod";
import { CANDIDATE_OUTCOMES } from "../../models/result.model.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const reasonSchema = z.string().trim().min(1).max(2000);

const markSchema = z.number().finite().min(0).nullable().optional();

export const RESULT_MAX_ROWS = 500;
export const RESULT_MAX_NOS = 200;

export const idParamSchema = z.object({ id: objectIdSchema });

function uniqueBy(rows, pick) {
  return new Set(rows.map(pick)).size === rows.length;
}

/**
 * PUT /batches/:id/results. docs/SCHEMA.md §3.14.
 * `outcome` and `absent` are accepted only so a conflict with the server's
 * value can be reported; the server never stores the client's outcome.
 */
export const resultsBodySchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            candidateId: objectIdSchema,
            absent: z.boolean().optional(),
            outcome: z.enum(CANDIDATE_OUTCOMES).optional(),
            nos: z
              .array(
                z
                  .object({
                    nosId: z.string().trim().min(1).max(64),
                    theory: markSchema,
                    practical: markSchema,
                    viva: markSchema,
                  })
                  .strict(),
              )
              .max(RESULT_MAX_NOS)
              .refine((rows) => uniqueBy(rows, (row) => row.nosId), {
                message: "nosId must not repeat",
              })
              .default([]),
          })
          .strict(),
      )
      .max(RESULT_MAX_ROWS)
      .refine((rows) => uniqueBy(rows, (row) => row.candidateId.toLowerCase()), {
        message: "candidateId must not repeat",
      }),
    changeReason: reasonSchema.optional(),
  })
  .strict();

export const submitResultBodySchema = z.object({ lateReason: reasonSchema.optional() }).strict();

export const reviewBodySchema = z.object({ reason: reasonSchema.optional() }).strict();

/** POST /batches/:id/return-for-correction. The reason is required. */
export const returnForCorrectionBodySchema = z.object({ reason: reasonSchema }).strict();
