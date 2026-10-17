/**
 * X-21. Screen sharing for batches that require it. The candidate shares the whole screen on the
 * check screen; the stream is kept here, in memory, until the exam starts. The exam only watches
 * that the share keeps going (a flag if it stops). No screen picture is read, kept or sent.
 */

export type ScreenOutcome =
  | { state: "ok"; stream: MediaStream }
  | { state: "not_entire" }
  | { state: "denied" }
  | { state: "unavailable" };

type GetDisplay = (options: DisplayMediaStreamOptions) => Promise<MediaStream>;

export async function requestScreen(getDisplay?: GetDisplay): Promise<ScreenOutcome> {
  const ask =
    getDisplay ??
    (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function"
      ? (options: DisplayMediaStreamOptions) => navigator.mediaDevices.getDisplayMedia(options)
      : null);
  if (!ask) return { state: "unavailable" };
  let stream: MediaStream;
  try {
    stream = await ask({ video: { displaySurface: "monitor" } as MediaTrackConstraints, audio: false });
  } catch {
    return { state: "denied" };
  }
  // Where the browser tells us what was shared, only a whole screen counts. Unknown counts as fine.
  const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)
    ?.displaySurface;
  if (surface !== undefined && surface !== "monitor") {
    stopScreen(stream);
    return { state: "not_entire" };
  }
  return { state: "ok", stream };
}

export function stopScreen(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

let held: MediaStream | null = null;

/** Keeps the shared screen between the check screen and the exam. Replaces (and stops) an older one. */
export function holdScreen(stream: MediaStream | null): void {
  if (held && held !== stream) stopScreen(held);
  held = stream;
}

/** Hands the shared screen to the exam; it is then the exam's to stop. */
export function takeHeldScreen(): MediaStream | null {
  const stream = held;
  held = null;
  return stream;
}

/** The candidate left before starting: stop sharing. */
export function releaseHeldScreen(): void {
  stopScreen(held);
  held = null;
}
