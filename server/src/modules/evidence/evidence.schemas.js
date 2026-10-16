import { z } from "zod";
import { EVIDENCE_KINDS } from "../../models/evidence.model.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

export const evidenceIdParamSchema = z.object({ id: objectIdSchema });
export const batchIdParamSchema = z.object({ id: objectIdSchema });

/** Multipart fields all arrive as strings. An empty string means "not sent". */
const blankToUndefined = (value) => (value === "" || value === null ? undefined : value);
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());
const numberField = (min, max) =>
  optional(z.coerce.number({ invalid_type_error: "Must be a number" }).min(min).max(max));

/**
 * POST /batches/:id/evidence form fields. Server-owned fields are rejected by `.strict()`.
 * GPS follows the login-event rules: "captured" needs latitude and longitude; "unavailable" needs
 * a reason and no coordinates. Sending no location at all is allowed and stored as "not_provided".
 */
export const uploadFieldsSchema = z
  .object({
    clientEventId: z.string().trim().min(1).max(200),
    kind: z.enum(EVIDENCE_KINDS),
    capturedAt: z.string().datetime({ offset: true }),
    candidateId: optional(objectIdSchema),
    sessionId: optional(objectIdSchema),
    deviceId: optional(z.string().trim().min(1).max(200)),
    latitude: numberField(-90, 90),
    longitude: numberField(-180, 180),
    accuracy: numberField(0, 100000),
    locationStatus: optional(z.enum(["captured", "unavailable"])),
    locationUnavailableReason: optional(z.string().trim().min(1).max(200)),
  })
  .strict()
  .superRefine((data, ctx) => {
    const issue = (path, message) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    if (data.kind === "proctor_snapshot") {
      if (!data.sessionId) issue("sessionId", "sessionId is required for a proctor_snapshot");
      if (data.candidateId !== undefined) {
        issue("candidateId", "candidateId is set from the session for a proctor_snapshot");
      }
    } else if (data.sessionId !== undefined && data.kind !== "id_proof") {
      // P-09: id_proof may carry a sessionId (the candidate's own ID card photo). The service
      // requires it for a candidate and refuses it for staff.
      issue("sessionId", "sessionId is only allowed with kind 'proctor_snapshot' or 'id_proof'");
    }
    const hasCoords = data.latitude !== undefined || data.longitude !== undefined;
    if (data.locationStatus === "unavailable") {
      if (!data.locationUnavailableReason) {
        issue(
          "locationUnavailableReason",
          "locationUnavailableReason is required when locationStatus is 'unavailable'",
        );
      }
      for (const field of ["latitude", "longitude", "accuracy"]) {
        if (data[field] !== undefined) {
          issue(field, `${field} must be absent when locationStatus is 'unavailable'`);
        }
      }
      return;
    }
    if (data.locationUnavailableReason !== undefined) {
      issue(
        "locationUnavailableReason",
        "locationUnavailableReason is only allowed when locationStatus is 'unavailable'",
      );
    }
    if (data.locationStatus === "captured" || hasCoords) {
      if (data.latitude === undefined) issue("latitude", "latitude is required with a location");
      if (data.longitude === undefined) issue("longitude", "longitude is required with a location");
    } else if (data.accuracy !== undefined) {
      issue("accuracy", "accuracy needs latitude and longitude");
    }
  });

const boolQuery = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean().optional());

export const evidenceFileQuerySchema = z.object({ inline: boolQuery }).strict();

const dateQuery = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid date",
});

const emptyToUndef = (schema) =>
  z.preprocess((value) => (value === "" || value === undefined ? undefined : value), schema);

/** GET /evidence. `from` and `to` filter `capturedAt`. */
export const listEvidenceQuerySchema = z
  .object({
    batchId: emptyToUndef(objectIdSchema.optional()),
    candidateId: emptyToUndef(objectIdSchema.optional()),
    kind: emptyToUndef(z.enum(EVIDENCE_KINDS).optional()),
    uploaderId: emptyToUndef(objectIdSchema.optional()),
    sessionId: emptyToUndef(objectIdSchema.optional()),
    from: emptyToUndef(dateQuery.optional()),
    to: emptyToUndef(dateQuery.optional()),
    hasLocation: boolQuery,
    page: emptyToUndef(z.coerce.number().int().positive().default(1)),
    pageSize: emptyToUndef(z.coerce.number().int().min(1).max(100).default(20)),
  })
  .strict()
  .refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
    message: "`from` must be before or equal to `to`",
    path: ["from"],
  });
