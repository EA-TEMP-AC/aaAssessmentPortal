import { useCallback, useEffect, useRef, useState } from "react";
import { createProctoringSession, listWarnings, sendHeartbeat, type ProctorWarning } from "../api/proctoringSession";
import { createTransport } from "../proctoring/transport";
import { FACE_EVIDENCE_NOTICE, submitFaceEvidence, type FaceStart } from "./faceEvidence";
import { addNotice, dismissNotice, NO_NOTICES, type NoticeState } from "./flagNotices";
import { getProctorEngine, type ProctorEngine, type ProctorFlagType, type ProctorStatus } from "./proctorBridge";

export const HEARTBEAT_MS = 15000;
export const WARNING_POLL_MS = 15000;

type Input = {
  attemptId: string;
  batchId: string;
  stream: MediaStream | null;
  /** P-09: ID card photo, selfie and the matcher from the camera check. Memory only. */
  face?: FaceStart | null;
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
  stop: () => void;
};

/**
 * Opens the proctoring session for an attempt, starts the engine with the camera
 * stream, sends heartbeats and polls warnings. Nothing here is stored in the browser.
 */
export function useProctoring({ attemptId, batchId, stream, face }: Input): ProctoringView {
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [status, setStatus] = useState<ProctorStatus>({ state: "starting" });
  const [warnings, setWarnings] = useState<ProctorWarning[]>([]);
  const [notices, setNotices] = useState<NoticeState>(NO_NOTICES);
  const cooldownMs = useRef(15000);
  const seen = useRef(new Set<string>());
  const engine = useRef<ProctorEngine | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const stopped = useRef(false);
  const faceRef = useRef<FaceStart | null>(face ?? null);
  const faceTransport = useRef<ReturnType<typeof createTransport> | null>(null);

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
        setUnavailable("Proctoring is unavailable right now. You can carry on with the exam.");
        setStatus({ state: "degraded", message: "Proctoring unavailable" });
        return;
      }
      if (!live || stopped.current) return;

      const faceStart = faceRef.current;
      if (faceStart) {
        // The exam does not wait for this and never stops if it fails.
        const transport = createTransport();
        faceTransport.current = transport;
        void submitFaceEvidence(faceStart, { sessionId: session.id, attemptId, batchId }, { transport })
          .then((sent) => {
            if (!sent && live && !stopped.current) setUnavailable((cur) => cur ?? FACE_EVIDENCE_NOTICE);
          })
          .catch(() => {});
      }

      timers.current.push(
        setInterval(() => {
          void sendHeartbeat(session.id).catch(() => {});
        }, HEARTBEAT_MS),
        setInterval(() => void poll(session.id), WARNING_POLL_MS),
      );

      if (!stream) {
        clearMatcher();
        setStatus({ state: "degraded", message: "Camera not available" });
        return;
      }
      cooldownMs.current = Math.max(0, session.config.flagCooldownSeconds) * 1000;
      const next = getProctorEngine();
      engine.current = next;
      try {
        await next.start({
          stream,
          sessionId: session.id,
          attemptId,
          batchId,
          config: session.config,
          faceMatcher: faceStart?.matcher ?? undefined,
          onFlag: (flag) => {
            if (live && !stopped.current) {
              const at = Date.now();
              setNotices((cur) => addNotice(cur, flag.type, at, cooldownMs.current));
            }
          },
          onStatus: (s) => {
            if (live && !stopped.current) setStatus(s);
          },
        });
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
  }, [attemptId, batchId, stream, stop, clearMatcher]);

  const acknowledge = useCallback((id: string) => {
    setWarnings((current) => current.filter((row) => row.id !== id));
  }, []);

  const dismiss = useCallback(() => setNotices((cur) => dismissNotice(cur)), []);

  return { unavailable, status, warnings, acknowledge, notice: notices.queue[0] ?? null, dismissNotice: dismiss, stop };
}
