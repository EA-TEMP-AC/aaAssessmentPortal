import mongoose from "mongoose";

/**
 * accessLogs. docs/SCHEMA.md §3.23. NCVET:TR s20; DPDP access accountability.
 * One row per person whose personal data a read endpoint returned. Append-only.
 * Holds ids and field names only, never the data that was read.
 */
export const ACCESS_SUBJECT_TYPES = Object.freeze([
  "user",
  "learner",
  "assessor",
  "proctor",
  "evidence",
]);
export const ACCESS_KINDS = Object.freeze(["list", "detail"]);

const BLOCKED_QUERY_HOOKS = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
];

const accessLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId },
    actorRole: { type: String },
    subjectType: { type: String, required: true, enum: ACCESS_SUBJECT_TYPES },
    subjectId: { type: String, required: true },
    kind: { type: String, required: true, enum: ACCESS_KINDS },
    /** Names of the personal fields the response carried. */
    fields: { type: [String], default: [] },
    /** Route template, for example `GET /api/v1/learners/:id`. No query string, no values. */
    route: { type: String, required: true },
    /** Shared by every row written for one list response. */
    requestId: { type: String, required: true },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

accessLogSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });
accessLogSchema.index({ actorId: 1, createdAt: -1 });
accessLogSchema.index({ createdAt: -1 });

accessLogSchema.pre("save", function rejectUpdate() {
  if (!this.isNew) throw new Error("accessLogs are append-only");
});

for (const hook of BLOCKED_QUERY_HOOKS) {
  accessLogSchema.pre(hook, function rejectMutation() {
    throw new Error("accessLogs are append-only");
  });
}

export const AccessLog = mongoose.model("AccessLog", accessLogSchema, "accessLogs");
