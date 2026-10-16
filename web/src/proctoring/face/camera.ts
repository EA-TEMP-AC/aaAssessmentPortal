import type { FaceConfig } from "./config";
import type { IdCheckResult } from "./rules";
import type { FaceMatcher, IdFaceMatcher } from "./types";

/** Camera-check helpers for the exam page. Nothing here uploads or stores anything. */

export type CameraDeps = {
  grabFrame: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  sleep: (ms: number) => Promise<void>;
};

export const DEFAULT_CAMERA_DEPS: CameraDeps = {
  grabFrame: (video) => createImageBitmap(video),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const PRECHECK_MESSAGES = {
  camera_not_ready: "The camera is not ready yet. Wait a moment and try again.",
  no_face: "We cannot see your face. Add more light in front of you and face the camera.",
  multiple_faces: "More than one face is in view. Only you should be in front of the camera.",
  model_error: "The face check could not run on this device. Tell the proctor.",
} as const;

export type PrecheckFailure = keyof typeof PRECHECK_MESSAGES;

export type CaptureResult =
  | { ok: true; frame: ImageBitmap }
  | { ok: false; reason: PrecheckFailure; message: string };

function cameraReady(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

function fail(reason: PrecheckFailure): CaptureResult {
  return { ok: false, reason, message: PRECHECK_MESSAGES[reason] };
}

/**
 * Tries a few frames and keeps the first one with exactly one face as the matcher's reference.
 * Returns that frame (for the JPEG copy) or a message the candidate can act on.
 */
export async function capturePrecheckReference(
  video: HTMLVideoElement,
  matcher: FaceMatcher,
  config: Pick<FaceConfig, "precheckAttempts" | "precheckGapMs">,
  deps: CameraDeps = DEFAULT_CAMERA_DEPS,
): Promise<CaptureResult> {
  if (!cameraReady(video)) return fail("camera_not_ready");
  let sawMultiple = false;
  for (let attempt = 0; attempt < config.precheckAttempts; attempt += 1) {
    if (attempt > 0) await deps.sleep(config.precheckGapMs);
    let frame: ImageBitmap;
    try {
      frame = await deps.grabFrame(video);
    } catch {
      return fail("camera_not_ready");
    }
    try {
      const result = await matcher.setReference(frame);
      if (result.ok) return { ok: true, frame };
      if (result.reason === "multiple_faces") sawMultiple = true;
    } catch {
      frame.close();
      return fail("model_error");
    }
    frame.close();
  }
  return fail(sawMultiple ? "multiple_faces" : "no_face");
}

/** Takes one still of the ID card held up to the camera. Face reading happens in verify. */
export async function captureIdCard(
  video: HTMLVideoElement,
  deps: Pick<CameraDeps, "grabFrame"> = DEFAULT_CAMERA_DEPS,
): Promise<CaptureResult> {
  if (!cameraReady(video)) return fail("camera_not_ready");
  try {
    return { ok: true, frame: await deps.grabFrame(video) };
  } catch {
    return fail("camera_not_ready");
  }
}

/**
 * Compares the largest face on the ID card with the selfie reference held by `selfieReference`
 * (the matcher after capturePrecheckReference). Returns the distance, never a descriptor.
 */
export async function verifyIdAgainstReference(
  idFrame: ImageBitmap,
  selfieReference: IdFaceMatcher,
  config: Pick<FaceConfig, "idDistanceThreshold">,
): Promise<IdCheckResult> {
  if (!selfieReference.hasReference()) return { result: "selfie_no_face" };
  const largest = await selfieReference.compareLargest(idFrame);
  if (!largest.found) return { result: "id_no_face" };
  return largest.distance <= config.idDistanceThreshold
    ? { result: "match", distance: largest.distance }
    : { result: "mismatch", distance: largest.distance };
}
