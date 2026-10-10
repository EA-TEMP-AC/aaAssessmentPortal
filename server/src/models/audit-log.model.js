import mongoose from "mongoose";

/**
 * auditLogs. docs/SCHEMA.md §3.15 ("as before") plus the header rule:
 * append-only; before/after redact secrets to "***".
 *
 * Field set used by B-01 (proposed for SCHEMA.md — see DECISIONS.md):
 * actorId, actorRole, action, entity, entityId, abId, batchId,
 * before, after, meta, ip, createdAt.
 *
 * abId / batchId support ab_reviewer scope (entities tied to that AB's batches).
 * Query indexes support GET /audit-logs; SCHEMA §3.15 does not list them yet.
 */
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

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId },
    actorRole: { type: String },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String },
    abId: { type: mongoose.Schema.Types.ObjectId },
    batchId: { type: mongoose.Schema.Types.ObjectId },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    meta: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ abId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

auditLogSchema.pre("save", function rejectUpdate() {
  if (!this.isNew) {
    throw new Error("auditLogs are append-only");
  }
});

for (const hook of BLOCKED_QUERY_HOOKS) {
  auditLogSchema.pre(hook, function rejectMutation() {
    throw new Error("auditLogs are append-only");
  });
}

export const AuditLog = mongoose.model("AuditLog", auditLogSchema, "auditLogs");
