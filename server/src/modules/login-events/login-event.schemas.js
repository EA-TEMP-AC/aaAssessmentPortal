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
 * B-06b: batchId is nullable.
 * GPS miss: if locationStatus is "unavailable", locationUnavailableReason is required
 * and lat/lng/accuracy must be absent. If "captured", lat and lng are required.
 */
export const loginEventBodySchema = z
  .object({
    clientEventId: z.string().trim().min(1).max(200),
    batchId: objectIdSchema.nullable(),
    type: z.enum(LOGIN_EVENT_TYPES),
    capturedAt: z.string().datetime({ offset: true }),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracy: z.number().nonnegative().optional(),
    locationStatus: z.enum(["captured", "unavailable"]).optional(),
    locationUnavailableReason: z.string().trim().min(1).max(200).optional(),
    locationUnavailableDetail: z.string().trim().max(1000).optional(),
    device: deviceSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.locationStatus === "unavailable") {
      if (!data.locationUnavailableReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "locationUnavailableReason is required when locationStatus is 'unavailable'",
          path: ["locationUnavailableReason"],
        });
      }
      if (data.lat !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "lat must be absent when locationStatus is 'unavailable'",
          path: ["lat"],
        });
      }
      if (data.lng !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "lng must be absent when locationStatus is 'unavailable'",
          path: ["lng"],
        });
      }
      if (data.accuracy !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "accuracy must be absent when locationStatus is 'unavailable'",
          path: ["accuracy"],
        });
      }
    } else {
      // locationStatus is "captured" or omitted
      if (data.lat === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "lat is required when locationStatus is 'captured'",
          path: ["lat"],
        });
      }
      if (data.lng === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "lng is required when locationStatus is 'captured'",
          path: ["lng"],
        });
      }
      if (data.locationUnavailableReason !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "locationUnavailableReason must be absent when locationStatus is 'captured'",
          path: ["locationUnavailableReason"],
        });
      }
      if (data.locationUnavailableDetail !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "locationUnavailableDetail must be absent when locationStatus is 'captured'",
          path: ["locationUnavailableDetail"],
        });
      }
    }
  });
