/**
 * NCVET:FR Annexure II recognition and assessment language.
 * Plain-language text for the two batch rule codes in API_CONTRACT v0.5.
 * Batch and assignment screens are a later task. Existing alerts use this text.
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
  return details.checks.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Extra sentences for the two batch rule codes. Null for every other code. */
export function explainBatchRule(code: string, details: unknown): string | null {
  if (code === "RULE_OUTSIDE_RECOGNITION") {
    const checks = recognitionChecks(details).map((check) => RECOGNITION_CHECKS[check] ?? check);
    const failed = checks.length > 0 ? ` ${checks.join(" ")}` : "";
    return `This batch is outside recognition.${failed} An AA admin can send an override reason when creating the batch.`;
  }
  if (code === "RULE_ASSESSOR_LANGUAGE") {
    return "The assessor's languages do not include this batch's assessment language. An AA admin can send an override reason when assigning the assessor.";
  }
  return null;
}

export function joinErrorParts(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(". ")
    .replace(/\.\.+/g, ".")
    .replace(/\. \./g, ".");
}
