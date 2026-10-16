/**
 * Counters for the exam page's debug strip (?debug=1, development builds only). Numbers and short
 * error text only: no image, no token, no response body. Nothing is stored in the browser.
 */

export type ProctorDebug = {
  /** Time one detection cycle took, in ms. Null before the first cycle. */
  lastTickMs: number | null;
  flagsSent: number;
  flagsFailed: number;
  snapshotsUploaded: number;
  snapshotsFailed: number;
  lastError: string | null;
};

const EMPTY: ProctorDebug = {
  lastTickMs: null,
  flagsSent: 0,
  flagsFailed: 0,
  snapshotsUploaded: 0,
  snapshotsFailed: 0,
  lastError: null,
};

let state: ProctorDebug = EMPTY;
const listeners = new Set<() => void>();

function update(patch: Partial<ProctorDebug>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export const proctorDebug = {
  get: (): ProctorDebug => state,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset() {
    update({ ...EMPTY });
  },
  tick(ms: number) {
    update({ lastTickMs: Math.round(ms) });
  },
  flagSent() {
    update({ flagsSent: state.flagsSent + 1 });
  },
  flagFailed(error: string) {
    update({ flagsFailed: state.flagsFailed + 1, lastError: `flag: ${error}` });
  },
  snapshotUploaded() {
    update({ snapshotsUploaded: state.snapshotsUploaded + 1 });
  },
  snapshotFailed(error: string) {
    update({ snapshotsFailed: state.snapshotsFailed + 1, lastError: `snapshot: ${error}` });
  },
};

/** Short text for a failed call: status and code for the server's errors, the name otherwise. */
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { status, code, name } = error as { status?: unknown; code?: unknown; name?: unknown };
    if (typeof status === "number") return `${status} ${typeof code === "string" ? code : ""}`.trim();
    if (typeof name === "string") return name;
  }
  return "unknown error";
}

/** Only in a development build, and only when the address has ?debug=1. */
export function debugStripWanted(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}
