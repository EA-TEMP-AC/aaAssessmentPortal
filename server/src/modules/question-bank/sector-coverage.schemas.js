import mongoose from "mongoose";
import { z } from "zod";
import { SECTOR_NAMES } from "../../config/annexure.js";
import { assertNoNationalIdKeys } from "./question-bank.schemas.js";

const guard = (schema) =>
  z.preprocess((val) => {
    assertNoNationalIdKeys(val);
    return val;
  }, schema);

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), "Invalid id");

export const sectorIdParamSchema = z.object({ sectorId: objectId }).strict();

export const sectorConfigParamSchema = z.object({ id: objectId }).strict();

export const createSectorConfigSchema = guard(
  z.object({ sector: z.enum(SECTOR_NAMES), active: z.boolean().optional() }).strict(),
);

export const updateSectorConfigSchema = guard(z.object({ active: z.boolean() }).strict());

export const uncoveredQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const nqrImportQuerySchema = z
  .object({ partial: z.enum(["true", "false"]).default("false") })
  .strict()
  .transform((q) => ({ partial: q.partial === "true" }));
