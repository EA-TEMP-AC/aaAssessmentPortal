/**
 * NCVET:FR Annexure II recognition and assessment language, plus the other
 * Phase 1 RULE_* codes on API_CONTRACT v0.5. Existing alerts and F-02 screens
 * use this text. Do not call these NCVET-mandated product rules (TR s29).
 */

const RECOGNITION_CHECKS: Record<string, string> = {
  sector: "The qualification sector is not a recognised sector.",
  state: "The centre state is not a recognised state.",
  not_started: "The recognition period has not started.",
  expired: "The recognition period has ended.",
  unconfigured: "Recognition has not been set up.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recognitionChecks(details: unknown): string[] {
  if (!isRecord(details) || !Array.isArray(details.checks)) return [];
  return details.checks.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

export const SLA_EXPIRED_CODES = [
  "SLA_ACCEPT_EXPIRED",
  "SLA_ASSIGN_EXPIRED",
  "SLA_RESULT_EXPIRED",
] as const;
export type SlaExpiredCode = (typeof SLA_EXPIRED_CODES)[number];

export const BLOCKABLE_RULE_CODES = [
  "RULE_RATIO",
  "RULE_ASSESSOR_LANGUAGE",
  "RULE_OUTSIDE_RECOGNITION",
] as const;
export type BlockableRuleCode = (typeof BLOCKABLE_RULE_CODES)[number];

export type OverrideField =
  | "ratioOverrideReason"
  | "languageOverrideReason"
  | "recognitionOverrideReason";

const RULE_TEXT: Record<string, string> = {
  RULE_TOA_INVALID:
    "This assessor has no valid Training of Assessor certificate that covers the assessment dates.",
  RULE_MAX_AAS:
    "This assessor already works with more than four assessment agencies.",
  RULE_RATIO:
    "The candidate count is above the assessor-to-learner ratio for this batch's ratio class. An AA admin can send an override reason when assigning the assessor.",
  RULE_ASSESSOR_CLASH:
    "This assessor is already booked at a different centre on an overlapping day.",
};

function ratioDetails(details: unknown): string {
  if (!isRecord(details)) return "";
  const parts: string[] = [];
  if (typeof details.ratioClass === "string" && details.ratioClass.length > 0) {
    parts.push(`Ratio class: ${details.ratioClass}.`);
  }
  if (typeof details.candidateCount === "number") {
    parts.push(`Candidates: ${details.candidateCount}.`);
  }
  if (typeof details.max === "number") {
    parts.push(`Maximum for this class: ${details.max}.`);
  }
  return parts.join(" ");
}

/** Extra sentences for Phase 1 RULE_* codes. Null for every other code. */
export function explainBatchRule(
  code: string,
  details: unknown,
): string | null {
  if (code === "RULE_OUTSIDE_RECOGNITION") {
    const checks = recognitionChecks(details).map(
      (check) => RECOGNITION_CHECKS[check] ?? check,
    );
    const failed = checks.length > 0 ? ` ${checks.join(" ")}` : "";
    return `This batch is outside recognition.${failed} An AA admin can send an override reason when creating the batch.`;
  }
  if (code === "RULE_ASSESSOR_LANGUAGE") {
    return "The assessor's languages do not include this batch's assessment language. An AA admin can send an override reason when assigning the assessor.";
  }
  if (code === "RULE_RATIO") {
    const extra = ratioDetails(details);
    return extra ? `${RULE_TEXT.RULE_RATIO} ${extra}` : RULE_TEXT.RULE_RATIO;
  }
  return RULE_TEXT[code] ?? null;
}

export function isSlaExpiredCode(code: string): code is SlaExpiredCode {
  return (SLA_EXPIRED_CODES as readonly string[]).includes(code);
}

export function isBlockableRuleCode(code: string): code is BlockableRuleCode {
  return (BLOCKABLE_RULE_CODES as readonly string[]).includes(code);
}

export function overrideFieldForRule(code: string): OverrideField | null {
  if (code === "RULE_RATIO") return "ratioOverrideReason";
  if (code === "RULE_ASSESSOR_LANGUAGE") return "languageOverrideReason";
  if (code === "RULE_OUTSIDE_RECOGNITION") return "recognitionOverrideReason";
  return null;
}

export function slaExpiredPrompt(code: string): string {
  if (code === "SLA_ACCEPT_EXPIRED") {
    return "Accept or reject is past the stored accept due time. Enter a late reason to continue. The server records a breach.";
  }
  if (code === "SLA_ASSIGN_EXPIRED") {
    return "Assign is past the stored assign due time. Enter a late reason to continue. The server records a breach.";
  }
  if (code === "SLA_RESULT_EXPIRED") {
    return "The result step is past the stored result due time. Enter a late reason to continue. The server records a breach.";
  }
  return "This action is past the stored due time. Enter a late reason to continue. The server records a breach.";
}

export function joinErrorParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(". ")
    .replace(/\.\.+/g, ".")
    .replace(/\. \./g, ".");
}
