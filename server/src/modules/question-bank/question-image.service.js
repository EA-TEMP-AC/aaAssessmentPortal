import { createHash } from "node:crypto";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { Attempt } from "../../models/attempt.model.js";
import { Question } from "../../models/question.model.js";
import { QUESTION_IMAGE_MAX_BYTES, QuestionImage } from "../../models/question-image.model.js";
import { QUESTION_READ_ROLES } from "../../models/roles.js";
import { sniffContentType } from "../evidence/file-type.js";

const ALLOWED = new Set(["image/png", "image/jpeg"]);

/**
 * X-25. Saves one picture sent as the raw request body. The type comes from the first bytes,
 * never from the header or a file name. Returns what the editor needs to attach it.
 */
export async function uploadQuestionImage(user, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Send the picture as the request body", {
      file: ["Send a PNG or JPEG picture as the request body"],
    });
  }
  if (bytes.length > QUESTION_IMAGE_MAX_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "The picture is larger than 1 MB", {
      maxBytes: QUESTION_IMAGE_MAX_BYTES,
    });
  }
  const contentType = sniffContentType(bytes.subarray(0, 1024));
  if (!contentType || !ALLOWED.has(contentType)) {
    throw new AppError(400, "VALIDATION_ERROR", "Only PNG and JPEG pictures are accepted", {
      file: ["Only PNG and JPEG pictures are accepted"],
    });
  }
  const created = await QuestionImage.create({
    contentType,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    data: bytes,
    uploadedBy: user._id,
  });
  return { id: String(created._id), contentType, size: bytes.length };
}

/**
 * Who may fetch a picture: the people who can read questions, and a candidate with an open
 * attempt that holds a question using it. Everyone else is refused.
 */
export async function loadReadableQuestionImage(user, id) {
  const image = await QuestionImage.findById(id).lean();
  if (!image) throw notFound();
  if (QUESTION_READ_ROLES.includes(user.role)) return image;
  if (["assessor", "proctor", "tp", "ab_reviewer"].includes(user.role)) return image;
  if (user.role === "candidate") {
    const questionIds = await Question.find({ "images.imageId": image._id }).distinct("_id");
    const open = await Attempt.exists({
      userId: user._id,
      status: "in_progress",
      "questions.questionId": { $in: questionIds },
    });
    if (open) return image;
  }
  throw forbidden();
}
