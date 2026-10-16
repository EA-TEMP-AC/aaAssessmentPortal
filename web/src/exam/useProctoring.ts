import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProctoringSession,
  listWarnings,
  sendHeartbeat,
  type ProctorWarning,
} from "../api/proctoringSession";
import { getProctorEngine, type ProctorEngine, type ProctorStatus } from "./proctorBridge";

export const HEARTBEAT_MS = 15000;
export const WARNING_POLL_MS = 15000;

type Input = { attemptId: string; batchId: string; stream: MediaStream | null };

export type ProctoringView = {
  /** Set when no session could be created. The exam carries on. */
  unavailable: string | null;
  status: ProctorStatus;
  /** Warnings the candidate has not acknowledged yet, oldest first. */
  warnings: ProctorWarning[];
  acknowledge: (id: string) => void;
  stop: () => void;
};

/**
 * Opens the proctoring session for an attempt, starts the engine with the camera
 * stream, sends heartbeats and polls warnings. Nothing here is stored in the browser.
 */
export function useProctoring({ attemptId, batchId, stream }: Input): ProctoringView {
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [status, setStatus] = useState<ProctorStatus>({ state: "starting" });
  const [warnings, setWarnings] = useState<ProctorWarning[]>([]);
  const seen = useRef(new Set<string>());
  const engine = useRef<ProctorEngine | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const stopped = useRef(false);

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
        setUnavailable("Proctoring is unavailable right now. You can carry on with the exam.");
        setStatus({ state: "degraded", message: "Proctoring unavailable" });
        return;
      }
      if (!live || stopped.current) return;

      timers.current.push(
        setInterval(() => {
          void sendHeartbeat(session.id).catch(() => {});
        }, HEARTBEAT_MS),
        setInterval(() => void poll(session.id), WARNING_POLL_MS),
      );

      if (!stream) {
        setStatus({ state: "degraded", message: "Camera not available" });
        return;
      }
      const next = getProctorEngine();
      engine.current = next;
      try {
        await next.start({
          stream,
          sessionId: session.id,
          attemptId,
          batchId,
          config: session.config,
          onStatus: (s) => {
            if (live && !stopped.current) setStatus(s);
          },
        });
      } catch {
        if (live && !stopped.current) setStatus({ state: "degraded", message: "The proctoring engine did not start" });
      }
    })();

    return () => {
      live = false;
      stop();
    };
  }, [attemptId, batchId, stream, stop]);

  const acknowledge = useCallback((id: string) => {
    setWarnings((current) => current.filter((row) => row.id !== id));
  }, []);

  return { unavailable, status, warnings, acknowledge, stop };
}
