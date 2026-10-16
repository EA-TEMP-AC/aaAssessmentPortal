/** Every number the face checks use. Change them here, nowhere else. */
export interface FaceConfig {
  /** Same-person check: distance at or below this is a match (face-api scale, 0 to about 1.5). */
  distanceThreshold: number;
  /** ID card check: kept apart because card photos are small and old. */
  idDistanceThreshold: number;
  /** One live sample every this many ms during the exam. */
  sampleIntervalMs: number;
  /** Consecutive mismatched samples needed before a flag. */
  mismatchSamples: number;
  /** The mismatch run must also have lasted this long (first to latest mismatch). */
  mismatchHoldMs: number;
  /** A gap longer than this between two mismatches starts a new run. */
  maxSampleGapMs: number;
  /** No second face_mismatch flag until this long after the last one. */
  flagCooldownMs: number;
  /** Camera check: frames tried before giving up. */
  precheckAttempts: number;
  /** Camera check: wait between tries. */
  precheckGapMs: number;
  /** Tiny face detector input size for the live face (multiple of 32). */
  detectorInputSize: number;
  /** Bigger input for the ID card, where the face is small. */
  idDetectorInputSize: number;
  /** Detector score below this is not a face. */
  detectorScoreThreshold: number;
  /** JPEG copies for a later upload. */
  jpegMaxWidth: number;
  jpegQuality: number;
  /** Where the model files are served from (no CDN). */
  modelUrl: string;
}

export const DEFAULT_FACE_CONFIG: Readonly<FaceConfig> = Object.freeze({
  distanceThreshold: 0.6,
  idDistanceThreshold: 0.6,
  sampleIntervalMs: 1000,
  mismatchSamples: 3,
  mismatchHoldMs: 4000,
  maxSampleGapMs: 3000,
  flagCooldownMs: 60_000,
  precheckAttempts: 5,
  precheckGapMs: 400,
  detectorInputSize: 320,
  idDetectorInputSize: 512,
  detectorScoreThreshold: 0.5,
  jpegMaxWidth: 1024,
  jpegQuality: 0.8,
  modelUrl: `${import.meta.env.BASE_URL.replace(/\/$/, "")}/models/face`,
});

export function faceConfig(overrides: Partial<FaceConfig> = {}): FaceConfig {
  return { ...DEFAULT_FACE_CONFIG, ...overrides };
}
