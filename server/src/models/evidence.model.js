import mongoose from "mongoose";

/**
 * evidence. docs/SCHEMA.md §3.24. NCVET Guidelines 4.11b; V-01.
 * One row per uploaded file. The file itself is in object storage under a random key.
 * A row is never edited or deleted: only `lastVerification` and `verifyCount` may change,
 * and only through `verifyEvidence`.
 */
export const EVIDENCE_KINDS = Object.freeze([
  "photo",
  "id_proof",
  "attendance",
  "equipment",
  "other",
  "video",
  // X-30: a picture of on-the-job training. Needs the batch switch allowOjtImages.
  "ojt_image",
  // P-01: a JPEG the candidate's browser takes during a proctored attempt. Needs a sessionId.
  "proctor_snapshot",
]);
export const EVIDENCE_CONTENT_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "application/pdf",
  "video/mp4",
]);
export const EVIDENCE_LOCATION_STATUSES = Object.freeze([
  "captured",
  "unavailable",
  "not_provided",
]);
export const EVIDENCE_VERIFY_RESULTS = Object.freeze(["ok", "mismatch", "missing"]);

const verificationSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
    result: { type: String, required: true, enum: EVIDENCE_VERIFY_RESULTS },
    /** What the stored file hashed to when it did not match. Null otherwise. */
    actualSha256: { type: String, default: null },
    actualSize: { type: Number, default: null },
  },
  { _id: false },
);

const evidenceSchema = new mongoose.Schema(
  {
    clientEventId: { type: String, required: true, maxlength: 200 },
    batchId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Batch" },
    abId: { type: mongoose.Schema.Types.ObjectId, required: true },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", default: null },
    /** P-01: the proctoring session of a `proctor_snapshot`. Null for every other kind. */
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ProctoringSession", default: null },
    kind: { type: String, required: true, enum: EVIDENCE_KINDS },
    contentType: { type: String, required: true, enum: EVIDENCE_CONTENT_TYPES },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    storageDriver: { type: String, required: true },
    /** Random key. Never sent in a response. No user-supplied file name is kept. */
    storageKey: { type: String, required: true },
    uploaderUserId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    uploaderRole: { type: String, required: true },
    /** Device clock, as sent. Kept apart from uploadedAt. */
    capturedAt: { type: Date, required: true },
    /** Server clock. */
    uploadedAt: { type: Date, required: true },
    locationStatus: { type: String, required: true, enum: EVIDENCE_LOCATION_STATUSES },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy: { type: Number, default: null },
    locationUnavailableReason: { type: String, default: null, maxlength: 200 },
    deviceId: { type: String, default: null, maxlength: 200 },
    payloadHash: { type: String, required: true },
    lastVerification: { type: verificationSchema, default: null },
    verifyCount: { type: Number, default: 0 },
  },
  { timestamps: false },
);

evidenceSchema.index({ clientEventId: 1 }, { unique: true });
evidenceSchema.index({ batchId: 1, capturedAt: -1 });
evidenceSchema.index({ candidateId: 1, capturedAt: -1 });
evidenceSchema.index({ abId: 1, capturedAt: -1 });
evidenceSchema.index({ uploaderUserId: 1, capturedAt: -1 });
evidenceSchema.index({ sha256: 1 });
evidenceSchema.index({ sessionId: 1, capturedAt: -1 });

const BLOCKED_QUERY_HOOKS = [
  "updateMany",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
];
const VERIFY_FIELDS = new Set(["lastVerification", "verifyCount"]);

function rejectMutation() {
  throw new Error("evidence is immutable");
}

for (const hook of BLOCKED_QUERY_HOOKS) evidenceSchema.pre(hook, rejectMutation);

// Single-document updates are allowed only for the verification result.
for (const hook of ["updateOne", "findOneAndUpdate"]) {
  evidenceSchema.pre(hook, function guardUpdate() {
    const update = this.getUpdate() ?? {};
    const operators = Object.keys(update);
    const touched = operators.flatMap((op) =>
      op.startsWith("$") ? Object.keys(update[op] ?? {}) : [op],
    );
    const allowedOps = operators.every((op) => op === "$set" || op === "$inc");
    if (!allowedOps || touched.length === 0 || !touched.every((f) => VERIFY_FIELDS.has(f))) {
      rejectMutation();
    }
  });
}

evidenceSchema.pre("save", function rejectUpdate() {
  if (!this.isNew) rejectMutation();
});
evidenceSchema.pre("deleteOne", { document: true, query: false }, rejectMutation);

export const Evidence = mongoose.model("Evidence", evidenceSchema, "evidence");
