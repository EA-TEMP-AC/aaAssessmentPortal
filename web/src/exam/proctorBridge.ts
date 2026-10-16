/**
 * The seam between the exam page and the proctoring engine. The real engine is
 * built in a separate task and plugged in with installProctorEngine(); until then
 * getProctorEngine() returns a no-op engine that reports "degraded".
 * Do not change these types without changing the engine task too.
 */

import type { FaceMatcher } from "../proctoring/face/types";

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
  | "id_unreadable";

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
    /** X-05: called when the rules raise a flag, so the page can tell the candidate. */
    onFlag?: (flag: { type: ProctorFlagType }) => void;
    /** P-09: holds the selfie reference; the engine compares the live face with it. */
    faceMatcher?: FaceMatcher;
    /** X-08: false in the exam window, where full screen is not asked for. Default true. */
    watchFullscreen?: boolean;
  }): Promise<void>;
  stop(): void;
}

export const ENGINE_NOT_INSTALLED = "Proctoring engine not installed";

function createNoopEngine(): ProctorEngine {
  let onStatus: ((s: ProctorStatus) => void) | null = null;
  return {
    async start(o) {
      onStatus = o.onStatus;
      o.onStatus({ state: "degraded", message: ENGINE_NOT_INSTALLED });
    },
    stop() {
      onStatus?.({ state: "stopped" });
      onStatus = null;
    },
  };
}

let factory: (() => ProctorEngine) | null = null;

/** Wires the real engine in. Pass null to go back to the no-op engine. */
export function installProctorEngine(next: (() => ProctorEngine) | null): void {
  factory = next;
}

export function getProctorEngine(): ProctorEngine {
  return factory ? factory() : createNoopEngine();
}
