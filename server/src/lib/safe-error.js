/**
 * Codes only. Error messages from MongoDB or SMTP can echo the document or credentials.
 * String codes must look like EAUTH or SMTP_NOT_CONFIGURED so a password cannot pass through.
 */
export function safeErrorCode(err, fallback = "ERROR") {
  if (typeof err?.code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(err.code)) return err.code;
  if (typeof err?.code === "number" && Number.isFinite(err.code)) return String(err.code);
  return fallback;
}
