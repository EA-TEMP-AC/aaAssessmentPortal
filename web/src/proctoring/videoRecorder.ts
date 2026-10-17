/**
 * X-27. Records the camera (with the microphone, when allowed) and the shared screen in the
 * browser and sends each short piece to the server as it is made, so a crash loses seconds, not
 * the whole exam. Nothing is kept in browser storage; a piece that cannot be sent after a few
 * tries is dropped and `onFailure` is told once per track. Needs MediaRecorder (Chrome, Edge,
 * Firefox).
 */
export type VideoTrack = "camera" | "screen";

export type VideoRecorderOptions = {
  camera: MediaStream;
  audio?: MediaStream | null;
  screen: MediaStream | null;
  chunkSeconds: number;
  send: (track: VideoTrack, seq: number, piece: Blob) => Promise<void>;
  /** Called once per track when it could not be recorded or sent. */
  onFailure: (track: VideoTrack, reason: string) => void;
  /** Tests inject these. */
  recorderFactory?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  wait?: (ms: number) => Promise<void>;
};

export type VideoRecorder = { stop: () => Promise<void> };

const RETRY_DELAYS_MS = [1000, 3000, 8000];
const MIME_CHOICES = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"];

/** Waits for `promise`, but never longer than `ms` (the timer is cleared when it finishes first). */
async function within(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && MIME_CHOICES.some((m) => MediaRecorder.isTypeSupported?.(m));
}

function pickMime(): string | undefined {
  return typeof MediaRecorder === "undefined"
    ? undefined
    : MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported?.(m));
}

export function startVideoRecorder(options: VideoRecorderOptions): VideoRecorder {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const make =
    options.recorderFactory ?? ((stream: MediaStream, o: MediaRecorderOptions) => new MediaRecorder(stream, o));
  const mimeType = pickMime();
  const stoppers: Array<() => Promise<void>> = [];

  function run(track: VideoTrack, stream: MediaStream, bitrate: number) {
    let seq = 0;
    let failed = false;
    let chain: Promise<void> = Promise.resolve();
    const fail = (reason: string) => {
      if (failed) return;
      failed = true;
      options.onFailure(track, reason);
    };
    let recorder: MediaRecorder;
    try {
      recorder = make(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: bitrate });
    } catch {
      fail("could not start");
      return;
    }
    recorder.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return;
      const piece = event.data;
      const number = seq++;
      chain = chain.then(async () => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            await options.send(track, number, piece);
            return;
          } catch {
            if (attempt >= RETRY_DELAYS_MS.length) {
              fail("could not send");
              return;
            }
            await wait(RETRY_DELAYS_MS[attempt] ?? 1000);
          }
        }
      });
    };
    recorder.onerror = () => fail("recorder error");
    try {
      recorder.start(Math.max(1, options.chunkSeconds) * 1000);
    } catch {
      fail("could not start");
      return;
    }
    stoppers.push(async () => {
      try {
        if (recorder.state !== "inactive") {
          const stopped = new Promise<void>((resolve) => {
            recorder.addEventListener("stop", () => resolve(), { once: true });
          });
          recorder.stop();
          await within(stopped, 3000);
        }
      } catch {
        // Stopping a recorder that already ended is fine.
      }
      await within(chain, 8000);
    });
  }

  const cameraStream = options.audio
    ? new MediaStream([...options.camera.getVideoTracks(), ...options.audio.getAudioTracks()])
    : options.camera;
  run("camera", cameraStream, 400_000);
  if (options.screen) run("screen", options.screen, 600_000);
  else options.onFailure("screen", "no screen");

  return {
    async stop() {
      await Promise.all(stoppers.map((stop) => stop()));
    },
  };
}
