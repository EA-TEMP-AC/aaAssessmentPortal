import { z } from "zod";

/** Longest range a request may cover. N-01: three years. */
export const ANALYTICS_MAX_RANGE_YEARS = 3;
export const ANALYTICS_PAGE_SIZE_DEFAULT = 20;
export const ANALYTICS_PAGE_SIZE_MAX = 100;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date : null;
}

const isoDate = z.string().refine((value) => parseIsoDate(value) !== null, {
  message: "Use a real calendar date as YYYY-MM-DD",
});

function queryNumber({ min, max, fallback }) {
  return z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : value),
    z.coerce.number().int().min(min).max(max),
  );
}

/** from and to are IST calendar dates, both inclusive. */
const rangeFields = { from: isoDate, to: isoDate };

function checkRange(query, ctx) {
  const from = parseIsoDate(query.from);
  const to = parseIsoDate(query.to);
  if (!from || !to) return;
  if (from > to) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "to must be on or after from" });
    return;
  }
  const limit = new Date(from);
  limit.setUTCFullYear(limit.getUTCFullYear() + ANALYTICS_MAX_RANGE_YEARS);
  if (to >= limit) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: `The range may not exceed ${ANALYTICS_MAX_RANGE_YEARS} years`,
    });
  }
}

export const summaryQuerySchema = z.object(rangeFields).strict().superRefine(checkRange);

export const groupedQuerySchema = z
  .object({
    ...rangeFields,
    page: queryNumber({ min: 1, max: 100000, fallback: 1 }),
    pageSize: queryNumber({
      min: 1,
      max: ANALYTICS_PAGE_SIZE_MAX,
      fallback: ANALYTICS_PAGE_SIZE_DEFAULT,
    }),
  })
  .strict()
  .superRefine(checkRange);
