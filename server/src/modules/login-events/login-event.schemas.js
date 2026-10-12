import { z } from "zod";
import { LOGIN_EVENT_TYPES } from "../../models/login-event.model.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

const deviceSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(200),
    platform: z.string().trim().min(1).max(50),
    appVersion: z.string().trim().min(1).max(50),
  })
  .strict();

/**
 * POST /assessor|proctor|student/login-event. docs/SCHEMA.md §3.11.
 * Server-owned fields (receivedAt, clockSkewMs, lateSync, ...) are rejected by `.strict()`.
 * `locationStatus` is what the field app sends with a fix; only `captured` is accepted
 * because lat and lng are required (open question 33).
 */
export const loginEventBodySchema = z
  .object({
    clientEventId: z.string().trim().min(1).max(200),
    batchId: objectIdSchema,
    type: z.enum(LOGIN_EVENT_TYPES),
    capturedAt: z.string().datetime({ offset: true }),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().optional(),
    locationStatus: z.literal("captured").optional(),
    device: deviceSchema.optional(),
  })
  .strict();
