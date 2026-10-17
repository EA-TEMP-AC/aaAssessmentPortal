import { ApiError, apiRequest } from "./client";
import type { ProctorConfig } from "../exam/proctorBridge";

/**
 * Proctoring session calls made by the exam page. The server side is a separate
 * task; these follow the F-05 contract (DECISIONS.md open questions 640 onwards):
 *   POST /proctoring/sessions { attemptId } -> { id, status, config }
 *   POST /proctoring/sessions/:id/heartbeat (no body)
 *   GET  /proctoring/sessions/:id/warnings -> { items: [{ id, message, createdAt }] }
 */

export type ProctoringSession = {
  id: string;
  status: string;
  config: ProctorConfig;
  captureLocation: boolean;
};

export type ProctorWarning = {
  id: string;
  message: string;
  createdAt: string | null;
};

/** Used when the server leaves a setting out. */
export const DEFAULT_PROCTOR_CONFIG: ProctorConfig = {
  snapshotIntervalSeconds: 300,
  detectionIntervalMs: 1000,
  flagCooldownSeconds: 60,
  sustainedSeconds: {},
};

function bad(what: string): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    `${what} response was not recognised.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function parseProctorConfig(value: unknown): ProctorConfig {
  if (!isRecord(value))
    return { ...DEFAULT_PROCTOR_CONFIG, sustainedSeconds: {} };
  const sustainedSeconds: Record<string, number> = {};
  if (isRecord(value.sustainedSeconds)) {
    for (const [key, seconds] of Object.entries(value.sustainedSeconds)) {
      if (
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        sustainedSeconds[key] = seconds;
    }
  }
  const flagSeverity: Record<string, string> = {};
  if (isRecord(value.flagSeverity)) {
    for (const [key, level] of Object.entries(value.flagSeverity)) {
      if (level === "low" || level === "medium" || level === "high")
        flagSeverity[key] = level;
    }
  }
  return {
    snapshotIntervalSeconds: positive(
      value.snapshotIntervalSeconds,
      DEFAULT_PROCTOR_CONFIG.snapshotIntervalSeconds,
    ),
    detectionIntervalMs: positive(
      value.detectionIntervalMs,
      DEFAULT_PROCTOR_CONFIG.detectionIntervalMs,
    ),
    flagCooldownSeconds: positive(
      value.flagCooldownSeconds,
      DEFAULT_PROCTOR_CONFIG.flagCooldownSeconds,
    ),
    sustainedSeconds,
    ...(typeof value.snapshotAtStartAndEnd === "boolean"
      ? { snapshotAtStartAndEnd: value.snapshotAtStartAndEnd }
      : {}),
    ...(Object.keys(flagSeverity).length > 0 ? { flagSeverity } : {}),
    // X-16: flag types the batch switched off. Kept as sent; only strings count.
    ...(Array.isArray(value.disabledFlags)
      ? { disabledFlags: value.disabledFlags.filter((t): t is string => typeof t === "string") }
      : {}),
    // X-27
    ...(value.recordVideo === true ? { recordVideo: true } : {}),
    ...(typeof value.videoChunkSeconds === "number" && value.videoChunkSeconds > 0
      ? { videoChunkSeconds: value.videoChunkSeconds }
      : {}),
  };
}

export async function createProctoringSession(
  attemptId: string,
): Promise<ProctoringSession> {
  const body = await apiRequest<unknown>("/proctoring/sessions", {
    method: "POST",
    body: { attemptId },
  });
  if (!isRecord(body)) throw bad("Proctoring session");
  const id = str(body.id);
  if (!id) throw bad("Proctoring session");
  return {
    id,
    status: str(body.status) ?? "active",
    config: parseProctorConfig(body.config),
    captureLocation: body.captureLocation === true,
  };
}

/** B-20: the heartbeat also says whether the flag policy has paused the attempt. */
export async function sendHeartbeat(
  sessionId: string,
): Promise<{ paused: boolean }> {
  const body = await apiRequest<unknown>(
    `/proctoring/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
    {
      method: "POST",
    },
  );
  return { paused: isRecord(body) && body.paused === true };
}

/** X-27: one WebM piece of the camera or the shared screen. Sending a piece again is safe. */
export async function uploadVideoPiece(
  sessionId: string,
  track: "camera" | "screen",
  seq: number,
  piece: Blob,
): Promise<void> {
  await apiRequest<unknown>(
    `/proctoring/sessions/${encodeURIComponent(sessionId)}/video/${track}/${seq}`,
    { method: "POST", headers: { "Content-Type": "video/webm" }, body: piece },
  );
}

export async function listWarnings(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ProctorWarning[]> {
  const body = await apiRequest<unknown>(
    `/proctoring/sessions/${encodeURIComponent(sessionId)}/warnings`,
    {
      signal,
    },
  );
  const rows = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.items)
      ? body.items
      : null;
  if (!rows) throw bad("Warnings");
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = str(row.id);
    const message = str(row.message);
    if (!id || !message) return [];
    return [{ id, message, createdAt: str(row.createdAt) }];
  });
}
