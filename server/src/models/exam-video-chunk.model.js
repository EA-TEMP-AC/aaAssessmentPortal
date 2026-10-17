import mongoose from "mongoose";

export const VIDEO_TRACKS = Object.freeze(["camera", "screen"]);

/**
 * examVideoChunks. docs/SCHEMA.md. X-27. One piece (about 10 seconds) of the exam video of a
 * proctoring session, camera or screen. The bytes are a file on the server disk under a key made
 * from ids, not a name chosen by anyone. Pieces are deleted `expiresAt` (90 days after receipt).
 */
const examVideoChunkSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "ProctoringSession" },
    attemptId: { type: mongoose.Schema.Types.ObjectId, required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true },
    abId: { type: mongoose.Schema.Types.ObjectId, required: true },
    track: { type: String, required: true, enum: VIDEO_TRACKS },
    seq: { type: Number, required: true, min: 0 },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    storageKey: { type: String, required: true },
    receivedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: false },
);

examVideoChunkSchema.index({ sessionId: 1, track: 1, seq: 1 }, { unique: true });

export const ExamVideoChunk = mongoose.model(
  "ExamVideoChunk",
  examVideoChunkSchema,
  "examVideoChunks",
);
