/**
 * Proctoring engine contract (P-02, P-05, P-06, P-07). The exam page and the server
 * API build against these names; keep them exactly as they are.
 */

import type { FaceMatcher } from "./face/types";

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
  "face_mismatch",
  "id_mismatch",
  "id_unreadable",
  "looking_away",
  "voice_detected",
  "screen_share_stopped",
  "recording_failed",
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
  | "camera_frozen"
  | "face_mismatch"
  | "id_mismatch"
  | "id_unreadable"
  | "looking_away"
  | "voice_detected"
  | "screen_share_stopped"
  | "recording_failed";

export interface ProctorConfig {
  snapshotIntervalSeconds: number;
  detectionIntervalMs: number;
  flagCooldownSeconds: number;
  sustainedSeconds: Record<string, number>;
  /** X-07: severity by flag type, drawn on the flag photo. Missing: the built-in table. */
  flagSeverity?: Record<string, string>;
  /** X-16: flag types switched off for this batch. The engine does not check for them. */
  disabledFlags?: string[];
  /** X-27: record the camera and the shared screen and send the pieces. */
  recordVideo?: boolean;
  /** X-27: how often the browser sends a piece, in seconds. */
  videoChunkSeconds?: number;
}

export type ProctorStatus = {
  state: "starting" | "running" | "degraded" | "stopped";
  message?: string;
};

export interface ProctorEngine {
  start(o: {
    stream: MediaStream;
    sessionId: string;
    attemptId: string;
    batchId: string;
    config: ProctorConfig;
    onStatus: (s: ProctorStatus) => void;
    /** X-05: called when the rules raise a flag, so the page can tell the candidate. */
    onFlag?: (flag: { type: ProctorFlagType }) => void;
    /** P-09: holds the selfie reference. When present, the live face is compared with it. */
    faceMatcher?: FaceMatcher;
    /** X-08: false in the exam window, where full screen is not asked for. Default true. */
    watchFullscreen?: boolean;
    /** X-07: the batch has location capture on, so flag photos and flags may carry the location. */
    captureLocation?: boolean;
    /** X-23: the id of the question on screen now, or null. */
    getQuestionId?: () => string | null;
    /** X-14: a microphone stream, used only to measure loudness. Nothing is recorded or sent. */
    audioStream?: MediaStream;
    /** X-21: the shared screen. The engine only watches that it keeps sharing; no screen picture is read. */
    screenStream?: MediaStream;
  }): Promise<void>;
  stop(): void;
}

/** One thing a model saw in one frame. */
export interface Detection {
  kind: "face" | "person" | "phone" | "object";
  label: string;
  confidence: number;
  /**
   * X-14, faces only. How far the head is turned sideways: the nose's offset from the middle of
   * the eyes, as a fraction of the distance between the eyes. About 0 facing the camera,
   * negative and positive for the two directions. Absent when the model gave no landmarks.
   */
  headTurn?: number;
}

/** A replaceable model (MediaPipe today; YOLO or a vendor later). */
export interface Detector {
  detect(frame: ImageBitmap | HTMLVideoElement): Promise<Detection[]>;
  close?(): void;
}

/** Kept small on purpose: no image data, no names, no question text. */
export type FlagDetail = { label: string; count: number; confidence?: number };

/** What the rules engine decided to raise. */
export type RaisedFlag = {
  type: ProctorFlagType;
  at: number;
  detail?: FlagDetail;
};

/** Body of POST /proctoring/sessions/:id/flags. The server decides severity. */
export type FlagBody = {
  clientEventId: string;
  type: ProctorFlagType;
  capturedAt: string;
  detail?: FlagDetail;
  evidenceId?: string;
  /** X-07: only when the batch has location capture on and the candidate allowed it. */
  location?: { latitude: number; longitude: number; accuracy?: number };
  /** X-23: the question on screen when the flag was raised. The server adds its place and the saved answer. */
  questionId?: string;
};

export type SnapshotUpload = {
  batchId: string;
  sessionId: string;
  clientEventId: string;
  capturedAt: string;
  blob: Blob;
  /** P-09: the camera check uploads the ID card photo as id_proof. Default proctor_snapshot. */
  kind?: "proctor_snapshot" | "id_proof";
};

export interface ProctorTransport {
  sendFlag(sessionId: string, body: FlagBody): Promise<void>;
  /** Returns the evidence id, or null when the upload failed. */
  uploadSnapshot(input: SnapshotUpload): Promise<string | null>;
  dispose(): void;
}
