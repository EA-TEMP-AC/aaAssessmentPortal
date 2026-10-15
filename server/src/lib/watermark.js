/**
 * Watermark helper. S-02 content-theft controls.
 *
 * Any export of question or test-paper content (a PDF, a spreadsheet, a print view, a package for
 * a test centre) MUST pass through `applyWatermark` before it leaves the server, so a leaked copy
 * can be traced to the user and the time. No export exists yet; this is the one place to reuse.
 *
 * A watermark holds only the user id, the role and the time (IST shown, UTC stored). It never
 * holds a name, email, phone or any content.
 */
const WATERMARK_MARK = Symbol.for("aa-portal.watermarked");

function istText(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} IST`;
}

/**
 * @param {{ _id?: unknown, id?: unknown, role?: string }} user  the authenticated user
 * @param {Date} [at]
 * @returns {{ userId: string, role: string, timestamp: string, text: string }}
 */
export function buildWatermark(user, at = new Date()) {
  const rawId = user?._id ?? user?.id;
  if (rawId == null || String(rawId) === "") throw new TypeError("Watermark needs a user id");
  if (typeof user?.role !== "string" || user.role === "") {
    throw new TypeError("Watermark needs a user role");
  }
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new TypeError("Watermark needs a valid time");
  }
  const userId = String(rawId);
  return {
    userId,
    role: user.role,
    timestamp: at.toISOString(),
    text: `CONFIDENTIAL | user ${userId} | ${user.role} | ${istText(at)}`,
  };
}

/**
 * Wraps export content with its watermark. Exporters render `watermark.text` on every page or
 * sheet and keep `watermark` in the file's metadata.
 *
 * @template T
 * @param {T} content
 * @param {{ _id?: unknown, id?: unknown, role?: string }} user
 * @param {{ at?: Date }} [options]
 * @returns {{ watermark: ReturnType<typeof buildWatermark>, content: T }}
 */
export function applyWatermark(content, user, options = {}) {
  const watermark = buildWatermark(user, options.at);
  const wrapped = { watermark, content };
  Object.defineProperty(wrapped, WATERMARK_MARK, { value: true, enumerable: false });
  return wrapped;
}

/** True only for a value that `applyWatermark` produced. Exporters call this before writing out. */
export function isWatermarked(value) {
  return Boolean(value && value[WATERMARK_MARK] === true && value.watermark?.text);
}

/** Throws unless the value came from `applyWatermark`. */
export function assertWatermarked(value) {
  if (!isWatermarked(value)) throw new Error("Export content must be watermarked");
  return value;
}
