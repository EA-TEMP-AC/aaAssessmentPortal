import { z } from "zod";
import { IDENTITY_DOC_TYPES, LEARNER_FILE_KINDS } from "../../models/learner-file.model.js";

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

export const learnerParamSchema = z.object({ id: objectId }).strict();
export const fileParamSchema = z.object({ id: objectId, fileId: objectId }).strict();

export const uploadFieldsSchema = z
  .object({
    kind: z.enum(LEARNER_FILE_KINDS),
    docType: z.enum(IDENTITY_DOC_TYPES).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.kind === "identity" && !body.docType) {
      ctx.addIssue({ code: "custom", path: ["docType"], message: "docType is required" });
    }
    if (body.kind === "photo" && body.docType) {
      ctx.addIssue({ code: "custom", path: ["docType"], message: "docType is only for identity" });
    }
  });
