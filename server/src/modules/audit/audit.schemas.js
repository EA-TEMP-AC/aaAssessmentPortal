import { z } from "zod";
import { ACCESS_KINDS, ACCESS_SUBJECT_TYPES } from "../../models/access-log.model.js";
import { USER_ROLES } from "../../models/roles.js";

const optionalQuery = (schema) =>
  z.preprocess((value) => (value === "" || value === undefined ? undefined : value), schema);

const dateQuery = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Invalid date",
});

export const listAuditLogsQuerySchema = z
  .object({
    entity: optionalQuery(z.string().trim().min(1).max(100).optional()),
    entityId: optionalQuery(z.string().trim().min(1).max(100).optional()),
    from: optionalQuery(dateQuery.optional()),
    to: optionalQuery(dateQuery.optional()),
    page: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.coerce.number().int().positive().default(1),
    ),
  })
  .refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
    message: "`from` must be before or equal to `to`",
    path: ["from"],
  });

const objectIdQuery = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

export const listAccessLogsQuerySchema = z
  .object({
    subjectType: optionalQuery(z.enum(ACCESS_SUBJECT_TYPES).optional()),
    subjectId: optionalQuery(z.string().trim().min(1).max(100).optional()),
    actorId: optionalQuery(objectIdQuery.optional()),
    actorRole: optionalQuery(z.enum(USER_ROLES).optional()),
    kind: optionalQuery(z.enum(ACCESS_KINDS).optional()),
    from: optionalQuery(dateQuery.optional()),
    to: optionalQuery(dateQuery.optional()),
    page: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.coerce.number().int().positive().default(1),
    ),
    pageSize: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.coerce.number().int().min(1).max(100).default(20),
    ),
  })
  .strict()
  .refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
    message: "`from` must be before or equal to `to`",
    path: ["from"],
  });
