import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRoles } from "../../middleware/require-roles.js";
import { RECOGNITION_READ_ROLES, RECOGNITION_WRITE_ROLES } from "../../models/roles.js";
import { putRecognitionSchema } from "./recognition.schemas.js";
import { getRecognition, saveRecognition } from "./recognition.service.js";

export const recognitionRouter = Router();

recognitionRouter.use(requireAuth);

recognitionRouter.get(
  "/",
  requireRoles(...RECOGNITION_READ_ROLES),
  asyncHandler(async (_req, res) => {
    await res.status(200).json(await getRecognition());
  }),
);

recognitionRouter.put(
  "/",
  requireRoles(...RECOGNITION_WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const body = putRecognitionSchema.parse(req.body);
    const saved = await saveRecognition(body, req.user);
    req.audit = {
      action: "aaRecognition.update",
      entity: "aaRecognition",
      entityId: saved.recognition.id,
      ...(saved.before ? { before: saved.before } : {}),
      after: saved.recognition,
    };
    await res.status(200).json(saved.recognition);
  }),
);
