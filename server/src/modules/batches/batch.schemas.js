import { z } from "zod";
import { isCalendarDate } from "../../lib/working-days.js";
import {
  CANDIDATE_INFO_FIELDS,
  CANDIDATE_INFO_GENDERS,
  FLAG_COUNT_SEVERITIES,
  FLAG_PAUSE_AFTER_MAX,
  FLAG_PAUSE_AFTER_MIN,
  FLAG_POLICY_ACTIONS,
  IMAGE_INTERVAL_MAX_SECONDS,
  IMAGE_INTERVAL_MIN_SECONDS,
} from "../../config/batch-settings.js";
import { assertNoNationalIdKeys } from "../question-bank/question-bank.schemas.js";
import { BATCH_MODES, BATCH_STATUSES, BATCH_TYPES } from "./batch-transitions.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const blankToUndefined = (value) => (value === "" || value === undefined ? undefined : value);

function queryNumber({ min, max, fallback }) {
  return z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return value;
  }, z.coerce.number().int().min(min).max(max));
}

const calendarDate = z.string().refine(isCalendarDate, "Expected YYYY-MM-DD");

const reasonSchema = z.string().trim().min(1).max(2000);

export const BATCH_PAGE_SIZE_DEFAULT = 20;
export const BATCH_PAGE_SIZE_MAX = 100;

export const batchIdParamSchema = z.object({
  id: objectIdSchema,
});

export const createBatchBodySchema = z
  .object({
    abId: objectIdSchema,
    qualificationId: objectIdSchema,
    type: z.enum(BATCH_TYPES),
    mode: z.enum(BATCH_MODES),
    assessmentStartDate: calendarDate,
    assessmentEndDate: calendarDate,
    tpId: objectIdSchema,
    centreId: objectIdSchema,
    schemeId: objectIdSchema.nullish(),
    projectId: objectIdSchema.nullish(),
    candidateCount: z.number().int().positive(),
    assessmentLanguage: z.string().trim().min(1).max(80),
    recognitionOverrideReason: reasonSchema.optional(),
  })
  .strict()
  .refine((body) => body.assessmentEndDate >= body.assessmentStartDate, {
    message: "assessmentEndDate must be on or after assessmentStartDate",
    path: ["assessmentEndDate"],
  });

export const acceptBodySchema = z
  .object({
    lateReason: reasonSchema.optional(),
  })
  .strict();

export const rejectBodySchema = z
  .object({
    reason: reasonSchema,
    lateReason: reasonSchema.optional(),
  })
  .strict();

export const reasonBodySchema = z
  .object({
    reason: reasonSchema,
  })
  .strict();

export const assignBodySchema = z
  .object({
    assessorId: objectIdSchema,
    proctorId: objectIdSchema.nullable().optional(),
    ratioOverrideReason: reasonSchema.optional(),
    languageOverrideReason: reasonSchema.optional(),
    lateReason: reasonSchema.optional(),
  })
  .strict();

export const reassignBodySchema = assignBodySchema;

/** POST /batches/:id/reassessments. Everything else is inherited from the parent batch. */
export const reassessmentBodySchema = z
  .object({
    assessmentStartDate: calendarDate,
    assessmentEndDate: calendarDate,
    centreId: objectIdSchema.optional(),
    learnerIds: z.array(objectIdSchema).min(1).max(500).optional(),
    assessmentLanguage: z.string().trim().min(1).max(80).optional(),
    recognitionOverrideReason: reasonSchema.optional(),
  })
  .strict()
  .refine((body) => body.assessmentEndDate >= body.assessmentStartDate, {
    message: "assessmentEndDate must be on or after assessmentStartDate",
    path: ["assessmentEndDate"],
  });

export const listBatchesQuerySchema = z
  .object({
    status: z.preprocess(blankToUndefined, z.enum(BATCH_STATUSES).optional()),
    from: z.preprocess(blankToUndefined, calendarDate.optional()),
    to: z.preprocess(blankToUndefined, calendarDate.optional()),
    tpId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
    schemeId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
    projectId: z.preprocess(blankToUndefined, objectIdSchema.optional()),
    page: queryNumber({ min: 1, max: 1_000_000, fallback: 1 }),
    pageSize: queryNumber({
      min: 1,
      max: BATCH_PAGE_SIZE_MAX,
      fallback: BATCH_PAGE_SIZE_DEFAULT,
    }),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

/** PUT /batches/:id/test-paper. D5. */
export const testPaperBodySchema = z.object({ testPaperId: objectIdSchema }).strict();

/** X-07: PUT /batches/:id/capture-location. */
export const captureLocationBodySchema = z.object({ captureLocation: z.boolean() }).strict();

/** PUT /batches/:id/learner-feedback. `reason` is required exactly when `collected` is false. */
export const learnerFeedbackBodySchema = z
  .object({
    collected: z.boolean(),
    reason: reasonSchema.nullish(),
    note: z.string().trim().min(1).max(2000).nullish(),
    collectedOn: calendarDate.nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.collected === false && body.reason == null) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "reason is required when feedback was not collected",
      });
    }
    if (body.collected === true && body.reason != null) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "reason must be empty when feedback was collected",
      });
    }
    if (body.collected === false && body.collectedOn != null) {
      ctx.addIssue({
        code: "custom",
        path: ["collectedOn"],
        message: "collectedOn is only for feedback that was collected",
      });
    }
  });

const guard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

/** Counted severities: exactly ["high"] or ["medium", "high"], in either order, no repeats. */
const countSeveritiesSchema = z
  .array(z.enum(FLAG_COUNT_SEVERITIES))
  .refine(
    (list) => new Set(list).size === list.length && list.includes("high"),
    'Use ["high"] or ["medium","high"]',
  )
  .transform((list) => FLAG_COUNT_SEVERITIES.filter((s) => list.includes(s)));

/**
 * PATCH /batches/:id/settings. B-20. Any subset of the groups; inside a group any subset of the
 * keys. Unknown keys are rejected, and there is no national ID field anywhere.
 */
export const batchSettingsBodySchema = guard(
  z
    .object({
      shuffleQuestions: z.boolean(),
      shuffleOptions: z.boolean(),
      showMarksToCandidate: z.boolean(),
      questionsMandatory: z.boolean(),
      flagPolicy: z
        .object({
          action: z.enum(FLAG_POLICY_ACTIONS),
          pauseAfterFlags: z.number().int().min(FLAG_PAUSE_AFTER_MIN).max(FLAG_PAUSE_AFTER_MAX),
          countSeverities: countSeveritiesSchema,
        })
        .partial()
        .strict(),
      imageCapture: z
        .object({
          intervalSeconds: z
            .number()
            .int()
            .min(IMAGE_INTERVAL_MIN_SECONDS)
            .max(IMAGE_INTERVAL_MAX_SECONDS),
          atStartAndEnd: z.boolean(),
        })
        .partial()
        .strict(),
      candidateInfoPopup: z
        .object({
          enabled: z.boolean(),
          fields: z
            .array(z.enum(CANDIDATE_INFO_FIELDS))
            .max(CANDIDATE_INFO_FIELDS.length)
            .refine((list) => new Set(list).size === list.length, "No repeated fields"),
        })
        .partial()
        .strict(),
      captureLocation: z.boolean(),
    })
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, "Send at least one setting"),
);

/** PUT /batches/:id/candidate-info. Which keys are needed depends on the batch settings. */
export const candidateInfoBodySchema = guard(
  z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      fatherName: z.string().trim().min(1).max(200),
      gender: z.enum(CANDIDATE_INFO_GENDERS),
      dateOfBirth: calendarDate,
    })
    .partial()
    .strict(),
);
