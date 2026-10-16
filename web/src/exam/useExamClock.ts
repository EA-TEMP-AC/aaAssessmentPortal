import { useEffect, useRef, useState } from "react";

export const WARN_SECONDS = [300, 60] as const;

/**
 * Remaining time from the server deadline. The gap between the server clock and
 * this device is measured once from `serverTime`, so a wrong device clock does
 * not change the time left.
 */
export function useExamClock(deadlineAt: string, serverTime: string | null, held = false) {
  const offset = useRef<number | null>(null);
  if (offset.current === null) {
    const server = serverTime ? Date.parse(serverTime) : Number.NaN;
    offset.current = Number.isFinite(server) ? server - Date.now() : 0;
  }
  const deadline = Date.parse(deadlineAt);
  const compute = () => Math.max(0, Math.ceil((deadline - (Date.now() + (offset.current ?? 0))) / 1000));
  const [remaining, setRemaining] = useState(compute);

  useEffect(() => {
    // X-12: while the batch holds the clock during a pause, the countdown stands still.
    if (held) return undefined;
    setRemaining(compute());
    const id = setInterval(() => setRemaining(compute()), 1000);
    return () => clearInterval(id);
    // compute depends only on deadline and the fixed offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, held]);

  return remaining;
}

export function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Words for screen readers, for example "1 hour 5 minutes". */
export function spokenRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m > 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  if (parts.length === 0) return "less than a minute";
  return parts.join(" ");
}
