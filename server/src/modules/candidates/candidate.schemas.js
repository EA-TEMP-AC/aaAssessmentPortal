import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

const accommodationSchema = z.array(z.string().trim().min(1).max(100));
const reasonSchema = z.string().trim().min(1).max(2000);

export const batchIdParamSchema = z.object({
  id: objectIdSchema,
});

export const candidateIdParamSchema = z.object({
  id: objectIdSchema,
  candidateId: objectIdSchema,
});

export const addCandidateBodySchema = z
  .object({
    learnerId: objectIdSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    externalRef: z.string().trim().min(1).max(64).optional(),
    /** X-35/X-36: the student's email. Used as the sign-in id when valid and free; never blocks the add. */
    email: z.string().trim().max(254).optional(),
    accommodations: accommodationSchema.optional(),
    ratioOverrideReason: reasonSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.learnerId) {
      if (body.name !== undefined || body.externalRef !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Do not send name or externalRef with learnerId",
          path: ["name"],
        });
      }
      return;
    }
    if (!body.name || !body.externalRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "learnerId or name and externalRef is required",
        path: ["learnerId"],
      });
    }
  });

export const patchCandidateBodySchema = z
  .object({
    active: z.boolean().optional(),
    accommodations: accommodationSchema.optional(),
    ratioOverrideReason: reasonSchema.optional(),
  })
  .strict()
  .refine((body) => body.active !== undefined || body.accommodations !== undefined, {
    message: "At least one of active or accommodations is required",
  });

/** POST /batches/:id/candidates/:candidateId/login. X-36. */
export const loginBodySchema = z.object({ reset: z.boolean().optional() }).strict();

export const listCandidatesQuerySchema = z.object({
  active: z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean().optional()),
});

export const importQuerySchema = z.object({
  ratioOverrideReason: z.preprocess(blankToUndefined, reasonSchema.optional()),
});
