import { apiRequest } from "../api/client";

/** Average brightness (0 to 255) below this counts as a black or covered camera. */
export const BLACK_FRAME_MAX_LUMA = 20;
/** How many frames to try, and how far apart, before the camera check fails. */
export const FRAME_CHECK_ATTEMPTS = 8;
export const FRAME_CHECK_INTERVAL_MS = 400;
/** A health check slower than this is shown as a slow connection. */
export const SLOW_NETWORK_MS = 2000;

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 24;

/**
 * Reads one small frame from the preview. Returns null until the video has a
 * frame to give. The pixels stay in memory and are never stored or sent.
 */
export function sampleVideoFrame(video: HTMLVideoElement): Uint8ClampedArray | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  return context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
}

/** RGBA pixels in, true when the picture is close to black. */
export function isBlackFrame(rgba: Uint8ClampedArray): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return true;
  let total = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    total += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return total / pixels < BLACK_FRAME_MAX_LUMA;
}

export type BrowserCheck = { id: string; label: string; ok: boolean; required: boolean; help: string };

export function checkBrowser(): BrowserCheck[] {
  const camera = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const secure = typeof window !== "undefined" && window.isSecureContext !== false;
  const fullscreen =
    typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function";
  return [
    {
      id: "camera",
      label: "Camera access",
      ok: camera,
      required: true,
      help: "Use a recent Chrome, Edge, Firefox or Safari.",
    },
    {
      id: "secure",
      label: "Secure connection",
      ok: secure,
      required: true,
      help: "Open the portal with an https:// address.",
    },
    {
      id: "fullscreen",
      label: "Full screen",
      ok: fullscreen,
      required: false,
      help: "Your browser cannot go full screen. You can still take the exam.",
    },
  ];
}

export type NetworkCheck =
  | { state: "ok"; ms: number }
  | { state: "slow"; ms: number }
  | { state: "offline" }
  | { state: "unreachable" };

export async function checkNetwork(now: () => number = () => performance.now()): Promise<NetworkCheck> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { state: "offline" };
  const started = now();
  try {
    await apiRequest<unknown>("/health", { auth: false, retryOn401: false });
  } catch {
    return { state: "unreachable" };
  }
  const ms = Math.max(0, Math.round(now() - started));
  return ms > SLOW_NETWORK_MS ? { state: "slow", ms } : { state: "ok", ms };
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
