import { clearSession, getSnapshot, setSession, subscribe } from "../api/session";
import type { ClientSession } from "../api/types";

/**
 * X-08: the exam runs in its own browser window, opened from the dashboard click.
 *
 * The session lives in memory only (no tokens in storage), so a new window starts signed out.
 * The two windows are the same origin, so the new window asks the one that opened it for the
 * session, and from then on the two keep each other up to date (a token refresh in one window
 * would otherwise leave the other holding a used refresh token). Nothing goes through storage,
 * the URL or the network.
 */

export const EXAM_WINDOW_NAME = "ncvet-exam-window";

export function examWindowPath(batchId: string, paperId: string): string {
  return `/exam/window/${encodeURIComponent(batchId)}/${encodeURIComponent(paperId)}`;
}

/** Window features: the whole available screen area from 0,0, no toolbar or address bar. */
export function examWindowFeatures(): string {
  const width = window.screen?.availWidth || 1280;
  const height = window.screen?.availHeight || 800;
  return [
    "popup=yes",
    "left=0",
    "top=0",
    `width=${width}`,
    `height=${height}`,
    "toolbar=no",
    "location=no",
    "menubar=no",
    "status=no",
    "scrollbars=yes",
    "resizable=yes",
  ].join(",");
}

/**
 * Must run straight from the click (before anything is awaited) or the browser blocks it.
 * Returns null when the browser blocked the pop-up. Not opened with noopener: the new window
 * needs window.opener for the session hand-over and to refresh the dashboard at the end.
 */
export function openExamWindow(batchId: string, paperId: string): Window | null {
  let opened: Window | null = null;
  try {
    opened = window.open(examWindowPath(batchId, paperId), EXAM_WINDOW_NAME, examWindowFeatures());
  } catch {
    opened = null;
  }
  if (!opened || opened.closed) return null;
  try {
    opened.moveTo?.(0, 0);
    opened.resizeTo?.(window.screen?.availWidth || 1280, window.screen?.availHeight || 800);
  } catch {
    // Some browsers refuse to move a window. The features above already asked for the size.
  }
  return opened;
}

type Bridge = {
  getSession: () => ClientSession | null;
  /** The other window pushes a newer session (or null for a sign-out) here. */
  pushSession: (session: ClientSession | null) => void;
  /** Dashboard only: reload the list of exams. */
  refreshExams?: () => void;
};

type BridgeWindow = Window & { __ncvetExamBridge?: Bridge };

function bridgeOf(target: Window | null | undefined): Bridge | null {
  try {
    return (target as BridgeWindow | null | undefined)?.__ncvetExamBridge ?? null;
  } catch {
    return null;
  }
}

function sameSession(a: ClientSession | null, b: ClientSession | null): boolean {
  return a?.accessToken === b?.accessToken && a?.refreshToken === b?.refreshToken;
}

/**
 * Starts the two-way session sync with `peer()` (the opener, or the exam window).
 * Returns a function that undoes it.
 */
function installBridge(peer: () => Window | null, refreshExams?: () => void): () => void {
  const own = window as BridgeWindow;
  own.__ncvetExamBridge = {
    getSession: () => getSnapshot(),
    pushSession: (session) => {
      if (sameSession(getSnapshot(), session)) return;
      if (session) setSession(session);
      else clearSession();
    },
    refreshExams,
  };
  const stop = subscribe(() => {
    const other = bridgeOf(peer());
    const mine = getSnapshot();
    if (other && !sameSession(other.getSession(), mine)) other.pushSession(mine);
  });
  return () => {
    stop();
    delete own.__ncvetExamBridge;
  };
}

/** Dashboard: lets the exam window read the session and ask for a refresh. */
export function installDashboardBridge(getExamWindow: () => Window | null, refreshExams: () => void): () => void {
  return installBridge(getExamWindow, refreshExams);
}

/**
 * Exam window, step 1: takes the session from the window that opened it. Runs before the first
 * render of the exam route, so the sign-in guard sees the session. Does nothing when this window
 * already has a session or was not opened by the dashboard.
 */
export function adoptOpenerSession(): void {
  if (getSnapshot()) return;
  const session = bridgeOf(window.opener as Window | null)?.getSession();
  if (session) setSession(session);
}

/** Exam window, step 2 (in an effect): keeps the session in step with the dashboard. */
export function connectToOpener(): () => void {
  return installBridge(() => (window.opener as Window | null) ?? null);
}

/** True when this window was opened by the dashboard and the dashboard is still there. */
export function hasLiveOpener(): boolean {
  const opener = window.opener as Window | null;
  return Boolean(opener && !opener.closed && bridgeOf(opener));
}

/** Ask the dashboard to reload its list, then close this window. */
export function closeExamWindow(): void {
  bridgeOf(window.opener as Window | null)?.refreshExams?.();
  window.close();
}
