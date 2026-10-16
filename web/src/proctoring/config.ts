import type { ProctorConfig } from "./types";

/**
 * Every threshold and confidence cut-off in one place. These are starting values for a
 * demo, not tuned figures; change them here, not in the rules.
 */
export const PROCTOR_THRESHOLDS = {
  /** Minimum model score for each kind of detection to count. */
  confidence: {
    face: 0.5,
    person: 0.5,
    phone: 0.4,
    object: 0.5,
  },
  /** Object-detector labels (COCO names) treated as a phone. */
  phoneLabels: ["cell phone"] as readonly string[],
  /** Object-detector labels treated as a forbidden object or an extra screen. */
  objectLabels: ["book", "laptop", "tv"] as readonly string[],
  /** Mean brightness (0 to 255) below which the frame counts as blocked or covered. */
  darkBrightness: 18,
  /** Mean per-pixel difference (0 to 255) below which two frames count as identical. */
  frozenDifference: 0.4,
  /** Size of the tiny grey frame used for brightness and freeze checks. */
  sampleWidth: 32,
  sampleHeight: 24,
  /** Snapshot JPEG. */
  snapshotMaxWidth: 640,
  snapshotQuality: 0.7,
  /** Speed (X-05). Face detection runs at most this often (the server's interval is used if shorter). */
  faceDetectionIntervalMs: 500,
  /** Object detection is the heavy model, so it runs less often; the last result is reused between runs. */
  objectDetectionIntervalMs: 2000,
  /** Frames are scaled down to at most this wide before detection. */
  detectionMaxWidth: 320,
  /** Flag send retry. */
  retryDelayMs: 5000,
  maxQueuedFlags: 50,
} as const;

export type ProctorThresholds = typeof PROCTOR_THRESHOLDS;

/** Used when the server config leaves a flag type out of `sustainedSeconds`. 0 means at once. */
export const DEFAULT_SUSTAINED_SECONDS: Record<string, number> = {
  face_not_present: 5,
  multiple_faces: 2,
  person_detected: 2,
  phone_detected: 1,
  object_detected: 2,
  camera_blocked: 3,
  camera_frozen: 5,
};

/** Local config for the demo page and tests. The exam page gets the real one from the server. */
export const DEMO_CONFIG: ProctorConfig = {
  snapshotIntervalSeconds: 60,
  detectionIntervalMs: 500,
  flagCooldownSeconds: 10,
  sustainedSeconds: { ...DEFAULT_SUSTAINED_SECONDS },
};
