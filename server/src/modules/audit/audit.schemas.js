import { z } from "zod";

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
