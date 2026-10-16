/**
 * Proctoring engine contract (P-02, P-05, P-06, P-07). The exam page and the server
 * API build against these names; keep them exactly as they are.
 */

export const PROCTOR_FLAG_TYPES = [
  "tab_hidden",
  "fullscreen_exit",
  "window_blur",
  "permission_revoked",
  "object_detected",
  "face_not_present",
  "multiple_faces",
  "person_detected",
  "phone_detected",
  "camera_blocked",
  "camera_frozen",
] as const;

export type ProctorFlagType =
  | "tab_hidden"
  | "fullscreen_exit"
  | "window_blur"
  | "permission_revoked"
  | "object_detected"
  | "face_not_present"
  | "multiple_faces"
  | "person_detected"
  | "phone_detected"
  | "camera_blocked"
  | "camera_frozen";

export interface ProctorConfig {
  snapshotIntervalSeconds: number;
  detectionIntervalMs: number;
  flagCooldownSeconds: number;
  sustainedSeconds: Record<string, number>;
}

export type ProctorStatus = { state: "starting" | "running" | "degraded" | "stopped"; message?: string };

export interface ProctorEngine {
  start(o: {
    stream: MediaStream;
    sessionId: string;
    attemptId: string;
    batchId: string;
    config: ProctorConfig;
    onStatus: (s: ProctorStatus) => void;
  }): Promise<void>;
  stop(): void;
}

/** One thing a model saw in one frame. */
export interface Detection {
  kind: "face" | "person" | "phone" | "object";
  label: string;
  confidence: number;
}

/** A replaceable model (MediaPipe today; YOLO or a vendor later). */
export interface Detector {
  detect(frame: ImageBitmap | HTMLVideoElement): Promise<Detection[]>;
  close?(): void;
}

/** Kept small on purpose: no image data, no names, no question text. */
export type FlagDetail = { label: string; count: number; confidence: number };

/** What the rules engine decided to raise. */
export type RaisedFlag = { type: ProctorFlagType; at: number; detail?: FlagDetail };

/** Body of POST /proctoring/sessions/:id/flags. The server decides severity. */
export type FlagBody = {
  clientEventId: string;
  type: ProctorFlagType;
  capturedAt: string;
  detail?: FlagDetail;
  evidenceId?: string;
};

export type SnapshotUpload = {
  batchId: string;
  sessionId: string;
  clientEventId: string;
  capturedAt: string;
  blob: Blob;
};

export interface ProctorTransport {
  sendFlag(sessionId: string, body: FlagBody): Promise<void>;
  /** Returns the evidence id, or null when the upload failed. */
  uploadSnapshot(input: SnapshotUpload): Promise<string | null>;
  dispose(): void;
}
