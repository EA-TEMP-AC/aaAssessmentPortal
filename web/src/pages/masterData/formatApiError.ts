import { ApiError } from "../../api/client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detailText(details: unknown): { field?: string; extra: string } {
  if (!isRecord(details)) return { extra: "" };
  const field = typeof details.field === "string" && details.field.length > 0 ? details.field : undefined;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === "field") continue;
    if (!Array.isArray(value)) continue;
    const messages = value.filter((item): item is string => typeof item === "string" && item.length > 0);
    if (messages.length > 0) lines.push(`${key}: ${messages.join(" ")}`);
  }
  return { field, extra: lines.join(" ") };
}

/** Includes the server code so DUPLICATE_RESOURCE and RESULT_PASS_MARK_INVALID stay visible. */
export function formatMasterDataError(error: unknown): { message: string; field?: string } {
  if (!(error instanceof ApiError)) {
    return { message: "Could not reach the server. Try again." };
  }
  const details = detailText(error.details);
  const message = [error.code, error.message, details.field ? `Field: ${details.field}.` : "", details.extra]
    .filter((part) => part.length > 0)
    .join(". ")
    .replace(/\.\./g, ".");
  return { message, field: details.field };
}
