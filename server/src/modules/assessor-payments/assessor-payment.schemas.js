import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

/** Rupees: a finite number, at least 0, with at most two decimal places. */
const rupees = z
  .number()
  .finite()
  .min(0)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "At most 2 decimal places",
  });

export const batchIdParamSchema = z.object({ id: objectIdSchema });

/** PUT body. `pending` is not accepted: the server sets it. */
export const assessorPaymentBodySchema = z
  .object({
    assessorId: objectIdSchema.optional(),
    amountDue: rupees,
    amountPaid: rupees,
    logisticsNote: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Math.round(body.amountPaid * 100) > Math.round(body.amountDue * 100)) {
      ctx.addIssue({
        code: "custom",
        path: ["amountPaid"],
        message: "amountPaid cannot exceed amountDue",
      });
    }
  });

export const PAYMENT_PAGE_SIZE_DEFAULT = 20;
export const PAYMENT_PAGE_SIZE_MAX = 100;

function queryNumber({ min, max, fallback }) {
  return z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().int().min(min).max(max),
  );
}

export const listPaymentsQuerySchema = z
  .object({
    page: queryNumber({ min: 1, max: 100000, fallback: 1 }),
    pageSize: queryNumber({
      min: 1,
      max: PAYMENT_PAGE_SIZE_MAX,
      fallback: PAYMENT_PAGE_SIZE_DEFAULT,
    }),
    assessorId: objectIdSchema.optional(),
    pendingOnly: z.enum(["true", "false"]).optional(),
  })
  .strict();
