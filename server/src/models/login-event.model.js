import mongoose from "mongoose";

/**
 * loginEvents. docs/SCHEMA.md §3.11. NCVET:FR §E; NCVET:TR s9, s26.
 * One row per `clientEventId`. `capturedAt` is the device clock, `receivedAt`
 * the server clock, and `clockSkewMs` is receivedAt − capturedAt.
 * Coordinates are stored as sent. No Aadhaar or other national ID.
 */
export const LOGIN_ACTOR_TYPES = Object.freeze(["assessor", "proctor", "student"]);

export const LOGIN_EVENT_TYPES = Object.freeze(["login", "logout"]);

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, maxlength: 200 },
    platform: { type: String, required: true, maxlength: 50 },
    appVersion: { type: String, required: true, maxlength: 50 },
  },
  { _id: false },
);

const loginEventSchema = new mongoose.Schema(
  {
    clientEventId: { type: String, required: true, maxlength: 200 },
    actorType: { type: String, required: true, enum: LOGIN_ACTOR_TYPES },
    /** assessors / proctors / learners id (users.linkedProfileId). */
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    type: { type: String, required: true, enum: LOGIN_EVENT_TYPES },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number },
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    clockSkewMs: { type: Number, required: true },
    clockSkewFlag: { type: Boolean, required: true },
    lateSync: { type: Boolean, required: true },
    device: { type: deviceSchema },
    syncedAt: { type: Date, required: true },
    abEmailQueuedAt: { type: Date, default: null },
    abEmailSentAt: { type: Date, default: null },
    /** SHA-256 of the accepted request. A replay must match it. Never returned. */
    payloadHash: { type: String, required: true },
  },
  { timestamps: true },
);

loginEventSchema.index({ clientEventId: 1 }, { unique: true });
loginEventSchema.index({ batchId: 1, capturedAt: 1 });
loginEventSchema.index({ actorType: 1, actorId: 1, capturedAt: -1 });

export const LoginEvent = mongoose.model("LoginEvent", loginEventSchema, "loginEvents");
