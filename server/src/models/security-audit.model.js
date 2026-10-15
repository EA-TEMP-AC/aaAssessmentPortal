import mongoose from "mongoose";

/**
 * securityAudits and securityFindings. docs/SCHEMA.md §3.31 and §3.32. S-02.
 * Records of security audits and the findings they raised. Archived, never deleted.
 */
export const SECURITY_AUDIT_TYPES = Object.freeze([
  "vapt",
  "penetration_test",
  "code_review",
  "infrastructure",
  "data_protection",
  "other",
]);
export const SECURITY_AUDIT_STATUSES = Object.freeze(["open", "closed"]);
export const FINDING_SEVERITIES = Object.freeze(["critical", "high", "medium", "low", "info"]);
export const FINDING_STATUSES = Object.freeze(["open", "closed"]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const securityAuditSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: SECURITY_AUDIT_TYPES },
    auditor: { type: String, required: true, trim: true, maxlength: 200 },
    auditDate: { type: String, required: true, match: DATE },
    scope: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, required: true, enum: SECURITY_AUDIT_STATUSES, default: "open" },
    /** Date by which the fixes for this audit are due. */
    fixesDueDate: { type: String, default: null, match: DATE },
    closedDate: { type: String, default: null, match: DATE },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
securityAuditSchema.index({ status: 1, auditDate: -1 });

const securityFindingSchema = new mongoose.Schema(
  {
    auditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SecurityAudit",
      required: true,
      index: true,
    },
    severity: { type: String, required: true, enum: FINDING_SEVERITIES },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    owner: { type: String, required: true, trim: true, maxlength: 200 },
    status: { type: String, required: true, enum: FINDING_STATUSES, default: "open" },
    dueDate: { type: String, required: true, match: DATE },
    closedDate: { type: String, default: null, match: DATE },
    /** A reference to the evidence (ticket id, report page, evidence vault id). Not a file. */
    evidenceRef: { type: String, default: null, trim: true, maxlength: 500 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
securityFindingSchema.index({ status: 1, severity: 1 });
securityFindingSchema.index({ status: 1, dueDate: 1 });

export const SecurityAudit = mongoose.model("SecurityAudit", securityAuditSchema, "securityAudits");
export const SecurityFinding = mongoose.model(
  "SecurityFinding",
  securityFindingSchema,
  "securityFindings",
);
