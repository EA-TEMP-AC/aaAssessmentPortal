import { z } from "zod";
import { PROCTORING_SESSION_STATUSES } from "../../models/proctoring-session.model.js";
import {
  PROCTORING_DECISIONS,
  PROCTORING_FLAG_TYPES,
  PROCTORING_SEVERITIES,
} from "../../models/proctoring-flag.model.js";
import { assertNoNationalIdKeys } from "../question-bank/question-bank.schemas.js";

const guard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

const objectId = (label) => z.string().regex(/^[a-fA-F0-9]{24}$/, `Invalid ${label}`);
const emptyToUndef = (schema) =>
  z.preprocess((value) => (value === "" || value === undefined ? undefined : value), schema);

export const idParamSchema = z.object({ id: objectId("id") }).strict();

export const createSessionSchema = guard(z.object({ attemptId: objectId("attempt ID") }).strict());

/** Heartbeat takes no fields. */
export const heartbeatSchema = z.object({}).strict();

/** A label, a count and a confidence. Never an image, a name or any other personal data. */
const detailSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9 _-]+$/, "Letters, digits, spaces, _ and - only")
      .optional(),
    count: z.number().int().min(0).max(100).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/** X-07: where the browser was when it took the flag photo. Coordinates are personal data. */
const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(1_000_000).optional(),
  })
  .strict();

export const flagSchema = guard(
  z
    .object({
      clientEventId: z.string().trim().min(1).max(200),
      type: z.enum(PROCTORING_FLAG_TYPES),
      capturedAt: z.string().datetime({ offset: true }),
      detail: detailSchema.optional(),
      evidenceId: objectId("evidence ID").optional(),
      location: locationSchema.optional(),
      questionId: objectId("question ID").optional(),
    })
    .strict(),
);

export const listQuerySchema = z
  .object({
    batchId: emptyToUndef(objectId("batch ID").optional()),
    status: emptyToUndef(z.enum(PROCTORING_SESSION_STATUSES).optional()),
    minSeverity: emptyToUndef(z.enum(PROCTORING_SEVERITIES).optional()),
    page: emptyToUndef(z.coerce.number().int().min(1).max(1_000_000).default(1)),
    pageSize: emptyToUndef(z.coerce.number().int().min(1).max(100).default(50)),
  })
  .strict();

export const reviewSchema = guard(
  z
    .object({
      decision: z.enum(PROCTORING_DECISIONS),
      note: z.string().trim().max(300).optional(),
    })
    .strict(),
);
