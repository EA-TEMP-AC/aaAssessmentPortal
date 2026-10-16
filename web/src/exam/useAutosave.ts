import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { saveAnswers } from "../api/attempts";

export const AUTOSAVE_DEBOUNCE_MS = 1500;

export type SaveState = "idle" | "saving" | "saved" | "error";

export type ClosedReason = "time_up" | "closed";

type Options = {
  debounceMs?: number;
  /** The server says the attempt is over (ATTEMPT_TIME_UP or ATTEMPT_CLOSED). */
  onClosed: (reason: ClosedReason) => void;
  /** B-20: the server refused the save because the flag policy paused the attempt. The answers stay queued. */
  onPaused?: () => void;
};

/**
 * Debounced answer saving. Changed answers wait in a queue and go up in one
 * PUT. A failed save keeps the queue, shows an error, and is sent again on
 * Retry or on the next change. Answers live only in memory.
 */
export function useAutosave(attemptId: string, { debounceMs = AUTOSAVE_DEBOUNCE_MS, onClosed, onPaused }: Options) {
  const pending = useRef(new Map<string, string | null>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const closed = useRef(false);
  const onClosedRef = useRef(onClosed);
  const onPausedRef = useRef(onPaused);
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    onClosedRef.current = onClosed;
    onPausedRef.current = onPaused;
  }, [onClosed, onPaused]);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const send = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      await inFlight.current;
    }
    if (closed.current) return false;
    if (pending.current.size === 0) return true;

    const batch = new Map(pending.current);
    pending.current.clear();
    setState("saving");

    const run = (async () => {
      try {
        const result = await saveAnswers(
          attemptId,
          [...batch].map(([questionId, answer]) => ({ questionId, answer })),
        );
        setSavedAt(result.savedAt);
        setState(pending.current.size > 0 ? "saving" : "saved");
        return true;
      } catch (error) {
        // Put the rows back unless a newer edit replaced them.
        for (const [questionId, answer] of batch) {
          if (!pending.current.has(questionId)) pending.current.set(questionId, answer);
        }
        if (error instanceof ApiError && (error.code === "ATTEMPT_TIME_UP" || error.code === "ATTEMPT_CLOSED")) {
          closed.current = true;
          onClosedRef.current(error.code === "ATTEMPT_TIME_UP" ? "time_up" : "closed");
        }
        if (error instanceof ApiError && error.code === "ATTEMPT_PAUSED") onPausedRef.current?.();
        setState("error");
        return false;
      }
    })();
    inFlight.current = run;
    const ok = await run;
    inFlight.current = null;
    if (ok && pending.current.size > 0 && !timer.current) {
      return send();
    }
    return ok;
  }, [attemptId]);

  const queue = useCallback(
    (questionId: string, answer: string) => {
      if (closed.current) return;
      pending.current.set(questionId, answer.trim() === "" ? null : answer);
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        void send();
      }, debounceMs);
    },
    [debounceMs, send],
  );

  /** Sends whatever is waiting now. Resolves true when nothing is left unsaved. */
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    const ok = await send();
    return ok && pending.current.size === 0;
  }, [send]);

  /** Stops further saves (after submit or time up). */
  const close = useCallback(() => {
    closed.current = true;
    clearTimer();
  }, []);

  useEffect(() => clearTimer, []);

  return { state, savedAt, queue, flush, close, hasPending: () => pending.current.size > 0 };
}
