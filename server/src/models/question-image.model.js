import mongoose from "mongoose";

/**
 * questionImages. docs/SCHEMA.md. X-25. One picture used in the stem of a question. The bytes
 * are kept in the row (a PNG or JPEG of at most 1 MB), found by id only. A row is never edited
 * or deleted; a question points to it with a text description for screen readers.
 */
export const QUESTION_IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg"]);
export const QUESTION_IMAGE_MAX_BYTES = 1024 * 1024;
export const QUESTION_IMAGES_PER_QUESTION = 3;

const questionImageSchema = new mongoose.Schema(
  {
    contentType: { type: String, required: true, enum: QUESTION_IMAGE_TYPES },
    size: { type: Number, required: true, min: 1, max: QUESTION_IMAGE_MAX_BYTES },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    data: { type: Buffer, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const QuestionImage = mongoose.model("QuestionImage", questionImageSchema, "questionImages");
