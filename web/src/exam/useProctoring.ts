import { useCallback, useEffect, useRef, useState } from "react";
import { stopScreen, takeHeldScreen } from "./screenShare";
import {
  createProctoringSession,
  listWarnings,
  sendHeartbeat,
  uploadVideoPiece,
  type ProctorWarning,
} from "../api/proctoringSession";
import { createTransport } from "../proctoring/transport";
import { startVideoRecorder, type VideoRecorder } from "../proctoring/videoRecorder";
import {
  FACE_EVIDENCE_NOTICE,
  submitFaceEvidence,
  type FaceStart,
} from "./faceEvidence";
import {
  addNotice,
  dismissNotice,
  NO_NOTICES,
  type NoticeState,
} from "./flagNotices";
import {
  getProctorEngine,
  type ProctorEngine,
  type ProctorFlagType,
  type ProctorStatus,
} from "./proctorBridge";

export const HEARTBEAT_MS = 15000;
export const WARNING_POLL_MS = 15000;

type Input = {
  attemptId: string;
  batchId: string;
  stream: MediaStream | null;
  /** P-09: ID card photo, selfie and the matcher from the camera check. Memory only. */
  face?: FaceStart | null;
  /** X-08: when false the engine does not watch full screen (no fullscreen_exit flag). Default false. */
  requireFullscreen?: boolean;
  /** X-23: the id of the question on screen, read when a flag is raised. */
  getQuestionId?: () => string | null;
};

export type ProctoringView = {
  /** Set when no session could be created. The exam carries on. */
  unavailable: string | null;
  status: ProctorStatus;
  /** Warnings the candidate has not acknowledged yet, oldest first. */
  warnings: ProctorWarning[];
  acknowledge: (id: string) => void;
  /** X-05: the flag type to tell the candidate about now, or null. Repeats inside the cooldown are merged. */
  notice: ProctorFlagType | null;
  dismissNotice: () => void;
  /** B-20: from the heartbeat. null until the first answer. */
  paused: boolean | null;
  stop: () => void;
};

/**
 * Opens the proctoring session for an attempt, starts the engine with the camera
 * stream, sends heartbeats and polls warnings. Nothing here is stored in the browser.
 */
export function useProctoring({
  attemptId,
  batchId,
  stream,
  face,
  requireFullscreen = false,
  getQuestionId,
}: Input): ProctoringView {
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [status, setStatus] = useState<ProctorStatus>({ state: "starting" });
  const [warnings, setWarnings] = useState<ProctorWarning[]>([]);
  const [notices, setNotices] = useState<NoticeState>(NO_NOTICES);
  const [paused, setPaused] = useState<boolean | null>(null);
  const cooldownMs = useRef(15000);
  const seen = useRef(new Set<string>());
  const engine = useRef<ProctorEngine | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const stopped = useRef(false);
  const faceRef = useRef<FaceStart | null>(face ?? null);
  const faceTransport = useRef<ReturnType<typeof createTransport> | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const recorder = useRef<VideoRecorder | null>(null);
  const questionIdRef = useRef(getQuestionId);
  questionIdRef.current = getQuestionId;

  // The engine clears the matcher when it stops. When it never started, this does it.
  const clearMatcher = useCallback(() => {
    try {
      faceRef.current?.matcher?.clear();
    } catch {
      // Nothing more to do with a matcher that fails to clear.
    }
  }, []);

  const stop = useCallback(() => {
    if (stopped.current) return;
    stopped.current = true;
    timers.current.forEach(clearInterval);
    timers.current = [];
    try {
      engine.current?.stop();
    } catch {
      // A failing engine must not block the end of the exam.
    }
    engine.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    // X-27: the last piece is sent before the tracks are stopped.
    const closing = recorder.current;
    recorder.current = null;
    const screenToStop = screenStream.current;
    screenStream.current = null;
    if (closing) void closing.stop().finally(() => stopScreen(screenToStop));
    else stopScreen(screenToStop);
    faceTransport.current?.dispose();
    faceTransport.current = null;
    setStatus({ state: "stopped" });
  }, []);

  useEffect(() => {
    stopped.current = false;
    let live = true;

    const poll = async (sessionId: string) => {
      try {
        const rows = await listWarnings(sessionId);
        if (!live) return;
        const fresh = rows.filter((row) => !seen.current.has(row.id));
        fresh.forEach((row) => seen.current.add(row.id));
        if (fresh.length > 0) setWarnings((current) => [...current, ...fresh]);
      } catch {
        // The next poll tries again.
      }
    };

    void (async () => {
      let session;
      try {
        session = await createProctoringSession(attemptId);
      } catch {
        if (!live) return;
        clearMatcher();
        setUnavailable(
          "Proctoring is unavailable right now. You can carry on with the exam.",
        );
        setStatus({ state: "degraded", message: "Proctoring unavailable" });
        return;
      }
      if (!live || stopped.current) return;

      const faceStart = faceRef.current;
      if (faceStart) {
        // The exam does not wait for this and never stops if it fails.
        const transport = createTransport();
        faceTransport.current = transport;
        void submitFaceEvidence(
          faceStart,
          { sessionId: session.id, attemptId, batchId },
          { transport },
        )
          .then((sent) => {
            if (!sent && live && !stopped.current)
              setUnavailable((cur) => cur ?? FACE_EVIDENCE_NOTICE);
          })
          .catch(() => {});
      }

      timers.current.push(
        setInterval(() => {
          void sendHeartbeat(session.id)
            .then((beat) => {
              if (live && !stopped.current) setPaused(beat.paused);
            })
            .catch(() => {});
        }, HEARTBEAT_MS),
        setInterval(() => void poll(session.id), WARNING_POLL_MS),
      );

      if (!stream) {
        clearMatcher();
        setStatus({ state: "degraded", message: "Camera not available" });
        return;
      }
      cooldownMs.current =
        Math.max(0, session.config.flagCooldownSeconds) * 1000;
      const next = getProctorEngine();
      engine.current = next;
      // X-14: the microphone is only listened to for loudness. If it is not allowed, the exam goes on without it.
      let audioStream: MediaStream | undefined;
      try {
        // X-16: when voice checking is off for the batch, the microphone is not even asked for.
        if (session.config.disabledFlags?.includes("voice_detected")) throw new Error("off");
        audioStream = await navigator.mediaDevices?.getUserMedia?.({ audio: true, video: false });
      } catch {
        audioStream = undefined;
      }
      if (audioStream) {
        const mic = audioStream;
        micStream.current = mic;
        if (!live) {
          mic.getTracks().forEach((t) => t.stop());
          return;
        }
      }
      // X-21: the screen shared on the check screen (null when the batch does not require it).
      const screen = takeHeldScreen();
      screenStream.current = screen;
      if (screen && !live) {
        stopScreen(screen);
        screenStream.current = null;
        return;
      }
      try {
        await next.start({
          stream,
          audioStream,
          screenStream: screen ?? undefined,
          sessionId: session.id,
          attemptId,
          batchId,
          config: session.config,
          faceMatcher: faceStart?.matcher ?? undefined,
          watchFullscreen: requireFullscreen,
          captureLocation: session.captureLocation,
          getQuestionId: () => questionIdRef.current?.() ?? null,
          onFlag: (flag) => {
            if (live && !stopped.current) {
              const at = Date.now();
              setNotices((cur) =>
                addNotice(cur, flag.type, at, cooldownMs.current),
              );
            }
          },
          onStatus: (s) => {
            if (live && !stopped.current) setStatus(s);
          },
        });
        // X-27: record the camera and the shared screen, when the batch asks for it.
        if (session.config.recordVideo && live && !stopped.current) {
          const flagSender = faceTransport.current ?? createTransport();
          faceTransport.current = flagSender;
          let failedOnce = false;
          recorder.current = startVideoRecorder({
            camera: stream,
            audio: audioStream ?? null,
            screen,
            chunkSeconds: session.config.videoChunkSeconds ?? 10,
            send: (track, seq, piece) => uploadVideoPiece(session.id, track, seq, piece),
            onFailure: (track, reason) => {
              if (failedOnce || !live || stopped.current) return;
              failedOnce = true;
              void flagSender.sendFlag(session.id, {
                clientEventId: `video-${Date.now().toString(36)}`,
                type: "recording_failed",
                capturedAt: new Date().toISOString(),
                detail: { label: `${track}: ${reason}`.slice(0, 60), count: 1, confidence: 1 },
              });
              setNotices((cur) => addNotice(cur, "recording_failed", Date.now(), cooldownMs.current));
            },
          });
        }
      } catch {
        if (live && !stopped.current)
          setStatus({
            state: "degraded",
            message: "The proctoring engine did not start",
          });
      }
    })();

    return () => {
      live = false;
      stop();
    };
  }, [attemptId, batchId, stream, stop, clearMatcher, requireFullscreen]);

  const acknowledge = useCallback((id: string) => {
    setWarnings((current) => current.filter((row) => row.id !== id));
  }, []);

  const dismiss = useCallback(
    () => setNotices((cur) => dismissNotice(cur)),
    [],
  );

  return {
    unavailable,
    status,
    warnings,
    acknowledge,
    notice: notices.queue[0] ?? null,
    dismissNotice: dismiss,
    paused,
    stop,
  };
}
