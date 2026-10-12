import { z } from "zod";
import { LOGIN_ACTOR_TYPES } from "../../models/login-event.model.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const instant = z.string().datetime({ offset: true });

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

export const ATTENDANCE_MAX_RECORDS = 500;
export const CHECKLIST_MAX_ITEMS = 200;

export const batchIdParamSchema = z.object({ id: objectIdSchema });

function uniqueBy(rows, pick) {
  return new Set(rows.map(pick)).size === rows.length;
}

/**
 * POST /assessor/batches/:id/attendance. docs/SCHEMA.md §3.13.
 * `.strict()` rejects server-owned fields and any ID number (no Aadhaar).
 */
export const attendanceBodySchema = z
  .object({
    capturedAt: instant,
    records: z
      .array(
        z
          .object({
            candidateId: objectIdSchema,
            present: z.boolean(),
            idVerified: z.boolean().optional(),
            note: z.string().trim().min(1).max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(ATTENDANCE_MAX_RECORDS)
      .refine((rows) => uniqueBy(rows, (row) => row.candidateId.toLowerCase()), {
        message: "candidateId must not repeat",
      }),
  })
  .strict();

/** POST /assessor/batches/:id/checklist. docs/SCHEMA.md §3.13. */
export const checklistBodySchema = z
  .object({
    clientEventId: z.string().trim().min(1).max(200),
    capturedAt: instant,
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(200).optional(),
            available: z.boolean(),
            note: z.string().trim().min(1).max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(CHECKLIST_MAX_ITEMS)
      .refine((rows) => uniqueBy(rows, (row) => row.key), { message: "key must not repeat" }),
    completeAssessment: z.boolean().optional().default(false),
  })
  .strict();

export const loginEventsQuerySchema = z
  .object({
    from: z.preprocess(blankToUndefined, instant.optional()),
    to: z.preprocess(blankToUndefined, instant.optional()),
    actorType: z.preprocess(blankToUndefined, z.enum(LOGIN_ACTOR_TYPES).optional()),
  })
  .refine((query) => !query.from || !query.to || new Date(query.from) <= new Date(query.to), {
    message: "from must be on or before to",
    path: ["from"],
  });

export const checklistQuerySchema = z.object({
  latest: z.preprocess(blankToUndefined, z.enum(["true", "false"]).optional()),
});
