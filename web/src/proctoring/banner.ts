import { PROCTOR_THRESHOLDS } from "./config";
import { DEFAULT_SEVERITY, flagName, flagReason, severityLabel } from "./flagText";
import type { PhotoLocation } from "./location";
import type { ProctorConfig } from "./types";

/**
 * The banner burned into the bottom of a flag photo (X-07). It is drawn in the browser, so it can
 * be forged; the server keeps the same facts separately and the review page shows both.
 */

export type BannerInput = {
  type: string;
  reason: string;
  severity: string;
  /** When the flag was raised, in ms. Drawn in IST. */
  at: number;
  /** Last six characters of the attempt id, upper case. */
  attemptCode: string;
  location: PhotoLocation | null;
};

export const NO_LOCATION_TEXT = "Location not shared";

export function attemptShortCode(attemptId: string): string {
  return attemptId.slice(-6).toUpperCase();
}

/** "20 Nov 2026, 10:30:05 IST" */
export function formatIst(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}:${get("second")} IST`;
}

export function locationText(location: PhotoLocation | null): string {
  if (!location) return NO_LOCATION_TEXT;
  const accuracy = location.accuracy === null ? "accuracy not known" : `accuracy ${Math.round(location.accuracy)} m`;
  return `Location: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)} (${accuracy})`;
}

/** Builds the banner for a raised flag from the engine's config. */
export function bannerFor(
  flag: { type: string; at: number },
  config: Pick<ProctorConfig, "sustainedSeconds" | "flagSeverity">,
  attemptId: string,
  location: PhotoLocation | null,
): BannerInput {
  return {
    type: flag.type,
    reason: flagReason(flag.type, config.sustainedSeconds),
    severity: config.flagSeverity?.[flag.type] ?? DEFAULT_SEVERITY[flag.type] ?? "unknown",
    at: flag.at,
    attemptCode: attemptShortCode(attemptId),
    location,
  };
}

/** The lines drawn, top to bottom. */
export function bannerLines(input: BannerInput): string[] {
  return [
    `${flagName(input.type)} | ${severityLabel(input.severity)} severity`,
    input.reason,
    `${formatIst(input.at)} | Attempt ${input.attemptCode}`,
    locationText(input.location),
  ];
}

/** The slice of the 2D context the banner uses, so tests can pass a recorder. */
export type BannerContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  fillText: (text: string, x: number, y: number) => void;
  measureText: (text: string) => { width: number };
};

export type BannerLayout = { fontPx: number; lineHeight: number; padding: number; height: number };

export function bannerLayout(width: number, lineCount: number): BannerLayout {
  const fontPx = Math.max(11, Math.round(width / 40));
  const lineHeight = Math.round(fontPx * 1.35);
  const padding = Math.round(fontPx * 0.6);
  return { fontPx, lineHeight, padding, height: lineCount * lineHeight + padding * 2 };
}

function fit(ctx: BannerContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}...`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}...`;
}

/** Draws the banner strip with its top edge at `top`. Text that is too wide is cut with "...". */
export function drawBanner(ctx: BannerContext, top: number, width: number, lines: string[]): BannerLayout {
  const layout = bannerLayout(width, lines.length);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, top, width, layout.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = `${layout.fontPx}px sans-serif`;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(fit(ctx, line, width - layout.padding * 2), layout.padding, top + layout.padding + i * layout.lineHeight);
  });
  return layout;
}

export type PhotoContext = BannerContext & {
  drawImage: (image: unknown, x: number, y: number, w: number, h: number) => void;
};

export type PhotoCanvas = {
  width: number;
  height: number;
  getContext: (kind: "2d") => PhotoContext | null;
  toBlob: (cb: (blob: Blob | null) => void, type: string, quality: number) => void;
};

const QUALITIES = [0.7, 0.55, 0.4, 0.3];
const SHRINK_STEPS = 3;

function encode(canvas: PhotoCanvas, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Makes the flag photo: the camera frame with the banner strip under it, as a JPEG of at most
 * `maxBytes`. Quality goes down first, then the picture is scaled down. Returns null when it
 * cannot fit or the browser has no canvas; the flag is then saved without a photo.
 */
export async function renderFlagPhoto(
  makeCanvas: () => PhotoCanvas,
  source: { image: unknown; width: number; height: number },
  banner: BannerInput | Promise<BannerInput>,
  maxBytes: number = PROCTOR_THRESHOLDS.flagPhotoMaxBytes,
): Promise<Blob | null> {
  // The frame is copied before anything is awaited, so the photo shows the moment of the flag.
  const frame = makeCanvas();
  frame.width = source.width;
  frame.height = source.height;
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) return null;
  frameCtx.drawImage(source.image, 0, 0, source.width, source.height);

  const lines = bannerLines(await banner);
  let scale = 1;
  for (let step = 0; step <= SHRINK_STEPS; step += 1) {
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    const out = makeCanvas();
    out.width = w;
    out.height = h + bannerLayout(w, lines.length).height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(frame, 0, 0, w, h);
    drawBanner(ctx, h, w, lines);
    for (const quality of QUALITIES) {
      const blob = await encode(out, quality);
      if (!blob) return null;
      if (blob.size <= maxBytes) return blob;
    }
    scale *= 0.75;
  }
  return null;
}
