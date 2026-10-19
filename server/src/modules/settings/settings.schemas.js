import { z } from "zod";

export const putAccessSettingsSchema = z
  .object({
    abReviewerCanReadAssessorPayments: z.boolean().optional(),
    ncvetViewerCanSeeAbQueue: z.boolean().optional(),
    aadhaarVisibility: z.enum(["hidden", "masked", "full"]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one setting is required",
  });
