import mongoose from "mongoose";
import { QUESTION_TYPES } from "./question.model.js";

/**
 * Candidate attempt at an approved test paper. docs/SCHEMA.md §3.21. Task E-03.
 * Holds the stored question order, the saved answers and the scores. Question text and the
 * answer key are read from `questions` by id; they are never copied here.
 */
export const ATTEMPT_STATUSES = Object.freeze(["in_progress", "submitted", "timed_out"]);
export const ATTEMPT_CLOSE_REASONS = Object.freeze(["submit", "timeout"]);
export const SCORE_STATUSES = Object.freeze(["pending", "scored"]);
export const SCORED_BY = Object.freeze(["auto", "manual"]);

const attemptQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    version: { type: Number, required: true },
    nosId: { type: String, required: true },
    pcId: { type: String, required: true },
    type: { type: String, required: true, enum: QUESTION_TYPES },
    marks: { type: Number, required: true, min: 0 },
    answer: { type: String, default: null, maxlength: 10000 },
    answeredAt: { type: Date, default: null },
    awardedMarks: { type: Number, default: null, min: 0 },
    scoreStatus: { type: String, enum: SCORE_STATUSES, default: "pending" },
    scoredBy: { type: String, enum: [...SCORED_BY, null], default: null },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    markedAt: { type: Date, default: null },
  },
  { _id: false },
);

const scoreGroupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    maxMarks: { type: Number, required: true },
    obtainedMarks: { type: Number, required: true },
    pendingMarks: { type: Number, required: true },
    pendingCount: { type: Number, required: true },
  },
  { _id: false },
);

const scoresSchema = new mongoose.Schema(
  {
    maxMarks: { type: Number, required: true },
    obtainedMarks: { type: Number, required: true },
    pendingMarks: { type: Number, required: true },
    pendingCount: { type: Number, required: true },
    complete: { type: Boolean, required: true },
    byNos: { type: [scoreGroupSchema], default: [] },
    byType: { type: [scoreGroupSchema], default: [] },
  },
  { _id: false },
);

/**
 * B-20. Set when the batch's flag policy pauses the attempt. While `active` the server refuses
 * answer saves and submit. The clock is not touched. Unlocking clears `active` and keeps the
 * history counters.
 */
const attemptPauseSchema = new mongoose.Schema(
  {
    active: { type: Boolean, required: true, default: false },
    pausedAt: { type: Date, default: null },
    /** How many times this attempt has been paused. */
    timesPaused: { type: Number, default: 0, min: 0 },
    /**
     * X-12. Set when the pause begins, from the batch's `flagPolicy.extendOnUnlock`. While true
     * the exam clock is held: the attempt cannot time out, and an unlock moves the deadline out
     * by the time it was paused.
     */
    clockStopped: { type: Boolean, default: false },
    /** Seconds given back by unlocks, in total. */
    secondsGivenBack: { type: Number, default: 0, min: 0 },
    lastUnlockedAt: { type: Date, default: null },
    lastUnlockedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" },
  },
  { _id: false },
);

const attemptSchema = new mongoose.Schema(
  {
    testPaperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestPaper",
      required: true,
    },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true },
    abId: { type: mongoose.Schema.Types.ObjectId, ref: "AwardingBody", required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", required: true },
    learnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Learner", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, required: true, enum: ATTEMPT_STATUSES, default: "in_progress" },
    durationMinutes: { type: Number, required: true, min: 1 },
    graceSeconds: { type: Number, required: true, min: 0 },
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    /** deadlineAt plus the grace. The server accepts saves and a submit until this instant. */
    acceptUntil: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, enum: [...ATTEMPT_CLOSE_REASONS, null], default: null },
    /** B-20: the batch's shuffleOptions at the start, so a later settings change keeps this order. */
    shuffleOptions: { type: Boolean, default: false },
    pause: { type: attemptPauseSchema, default: undefined },
    questions: { type: [attemptQuestionSchema], default: [] },
    scores: { type: scoresSchema, default: null },
    /** Bumped by every write. Closing and marking compare it so a save is never overwritten. */
    rev: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

attemptSchema.index({ testPaperId: 1, candidateId: 1 }, { unique: true });
attemptSchema.index({ batchId: 1, status: 1 });
attemptSchema.index({ abId: 1, startedAt: -1 });
attemptSchema.index({ status: 1, acceptUntil: 1 });

export const Attempt = mongoose.model("Attempt", attemptSchema, "attempts");
