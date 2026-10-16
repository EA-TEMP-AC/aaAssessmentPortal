import { PROCTOR_THRESHOLDS, type ProctorThresholds } from "./config";
import type { DetectorFactory } from "./detector";
import { createFrameSampler, createSnapshotTaker, type FrameSampler, type SnapshotTaker } from "./frame";
import { createMediaPipeDetector } from "./mediapipeDetector";
import { createRulesState, evaluateEvent, evaluateFrame, frameStats, type RulesState } from "./rules";
import { createTransport } from "./transport";
import type {
  Detection,
  Detector,
  FlagBody,
  FlagDetail,
  ProctorConfig,
  ProctorEngine,
  ProctorFlagType,
  ProctorStatus,
  ProctorTransport,
  RaisedFlag,
} from "./types";

/**
 * In-browser proctoring engine. Runs detection on the candidate's camera stream, applies the
 * rules, and sends flags and JPEG snapshots. Video is never uploaded or stored.
 *
 * The caller owns the MediaStream: stop() releases everything the engine made (timers,
 * listeners, the hidden video element, the model) but does not stop the camera tracks.
 */

export type EngineOptions = {
  detectorFactory?: DetectorFactory;
  transport?: ProctorTransport;
  thresholds?: ProctorThresholds;
  now?: () => number;
  /** Builds the brightness/freeze sampler. Default reads a 32x24 canvas. */
  samplerFactory?: () => { sample: FrameSampler; release: () => void };
  takeSnapshot?: SnapshotTaker;
  /** Whether the video has a frame the model can read. Default: readyState >= 2. */
  isFrameReady?: (video: HTMLVideoElement) => boolean;
  /** For the demo page: what the model saw this cycle (null when degraded). */
  onDetections?: (detections: Detection[] | null, stats: { brightness: number | null; identical: boolean | null }) => void;
  /** For the demo page: every flag the rules raised, with the body sent. */
  onFlag?: (flag: RaisedFlag, body: FlagBody) => void;
  /** For the demo page: every snapshot taken. */
  onSnapshot?: (reason: "interval" | ProctorFlagType, evidenceId: string | null) => void;
};

type Run = {
  sessionId: string;
  attemptId: string;
  batchId: string;
  config: ProctorConfig;
  onStatus: (s: ProctorStatus) => void;
  video: HTMLVideoElement;
  tracks: MediaStreamTrack[];
  detector: Detector | null;
  sampler: { sample: FrameSampler; release: () => void };
  previous: Uint8ClampedArray | null;
  rules: RulesState;
  busy: boolean;
  timers: ReturnType<typeof setInterval>[];
  cleanups: (() => void)[];
  wasFullscreen: boolean;
  seq: number;
  status: ProctorStatus["state"];
  degradedReason: string | null;
  transport: ProctorTransport;
};

function randomPart(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function createEngine(options: EngineOptions = {}): ProctorEngine {
  const thresholds = options.thresholds ?? PROCTOR_THRESHOLDS;
  const now = options.now ?? (() => Date.now());
  const detectorFactory = options.detectorFactory ?? createMediaPipeDetector;
  const samplerFactory = options.samplerFactory ?? (() => createFrameSampler(thresholds));
  const takeSnapshot = options.takeSnapshot ?? createSnapshotTaker(thresholds);
  const isFrameReady = options.isFrameReady ?? ((video: HTMLVideoElement) => video.readyState >= 2);

  let run: Run | null = null;

  function setStatus(r: Run, state: ProctorStatus["state"], message?: string) {
    if (r.status === state && state !== "degraded") return;
    r.status = state;
    r.onStatus(message ? { state, message } : { state });
  }

  function eventId(r: Run, prefix: string): string {
    r.seq += 1;
    return `${r.attemptId.slice(0, 60)}-${prefix}${r.seq}-${randomPart()}`.slice(0, 200);
  }

  async function snapshot(r: Run, reason: "interval" | ProctorFlagType): Promise<string | null> {
    let evidenceId: string | null = null;
    try {
      const blob = await takeSnapshot(r.video);
      if (blob && run === r) {
        evidenceId = await r.transport.uploadSnapshot({
          batchId: r.batchId,
          sessionId: r.sessionId,
          clientEventId: eventId(r, "s"),
          capturedAt: new Date(now()).toISOString(),
          blob,
        });
      }
    } catch {
      evidenceId = null;
    }
    if (run === r) options.onSnapshot?.(reason, evidenceId);
    return evidenceId;
  }

  async function send(r: Run, flag: RaisedFlag) {
    const capturedAt = new Date(flag.at).toISOString();
    const clientEventId = eventId(r, "f");
    const evidenceId = await snapshot(r, flag.type);
    if (run !== r) return;
    const body: FlagBody = { clientEventId, type: flag.type, capturedAt };
    if (flag.detail) body.detail = flag.detail;
    if (evidenceId) body.evidenceId = evidenceId;
    options.onFlag?.(flag, body);
    await r.transport.sendFlag(r.sessionId, body);
  }

  function raiseEvent(r: Run, type: ProctorFlagType, detail?: FlagDetail) {
    if (run !== r) return;
    const result = evaluateEvent(r.rules, type, now(), r.config, detail);
    r.rules = result.state;
    if (result.flag) void send(r, result.flag);
  }

  async function tick(r: Run) {
    if (r.busy || run !== r) return;
    r.busy = true;
    try {
      const gray = r.sampler.sample(r.video);
      const stats = gray ? frameStats(gray, r.previous, thresholds) : { brightness: null, identical: null };
      r.previous = gray;

      let detections: Detection[] | null = null;
      if (r.detector && isFrameReady(r.video)) {
        try {
          detections = await r.detector.detect(r.video);
          if (r.degradedReason === "detect") {
            r.degradedReason = null;
            setStatus(r, "running");
          }
        } catch {
          detections = null;
          if (r.degradedReason !== "detect") {
            r.degradedReason = "detect";
            setStatus(r, "degraded", "Detection failed on this frame; browser checks still run.");
          }
        }
      }
      if (run !== r) return;
      options.onDetections?.(detections, stats);
      const result = evaluateFrame(r.rules, { detections, ...stats }, now(), r.config, thresholds);
      r.rules = result.state;
      for (const flag of result.flags) void send(r, flag);
    } finally {
      r.busy = false;
    }
  }

  function listen(r: Run, target: EventTarget, name: string, handler: () => void) {
    target.addEventListener(name, handler);
    r.cleanups.push(() => target.removeEventListener(name, handler));
  }

  function stop() {
    const r = run;
    if (!r) return;
    run = null;
    for (const t of r.timers) clearInterval(t);
    for (const c of r.cleanups) c();
    try {
      r.detector?.close?.();
    } catch {
      // A model that fails to close has nothing more to release.
    }
    r.sampler.release();
    try {
      r.video.pause();
    } catch {
      // jsdom and some browsers throw on pause of an unplayed element.
    }
    r.video.srcObject = null;
    r.video.remove();
    // A transport the caller passed in is theirs to dispose.
    if (!options.transport) r.transport.dispose();
    setStatus(r, "stopped");
  }

  async function start(o: Parameters<ProctorEngine["start"]>[0]) {
    stop();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("aria-hidden", "true");
    video.style.position = "fixed";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.srcObject = o.stream;
    document.body.appendChild(video);

    const r: Run = {
      sessionId: o.sessionId,
      attemptId: o.attemptId,
      batchId: o.batchId,
      config: o.config,
      onStatus: o.onStatus,
      video,
      tracks: o.stream.getVideoTracks(),
      detector: null,
      sampler: samplerFactory(),
      previous: null,
      rules: createRulesState(),
      busy: false,
      timers: [],
      cleanups: [],
      wasFullscreen: Boolean(document.fullscreenElement),
      seq: 0,
      status: "stopped",
      degradedReason: null,
      transport: options.transport ?? createTransport(),
    };
    run = r;
    setStatus(r, "starting");

    // Browser-event checks start first and keep running even without a model.
    listen(r, document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") raiseEvent(r, "tab_hidden");
    });
    listen(r, window, "blur", () => raiseEvent(r, "window_blur"));
    listen(r, document, "fullscreenchange", () => {
      const isFull = Boolean(document.fullscreenElement);
      if (r.wasFullscreen && !isFull) raiseEvent(r, "fullscreen_exit");
      r.wasFullscreen = isFull;
    });
    const cameraLost = (reason: string) => {
      raiseEvent(r, "permission_revoked", { label: reason, count: 1, confidence: 1 });
      if (run === r) {
        r.degradedReason = "camera";
        setStatus(r, "degraded", "The camera stopped sending video.");
      }
    };
    for (const track of r.tracks) {
      listen(r, track, "ended", () => cameraLost("track ended"));
      listen(r, track, "mute", () => cameraLost("track muted"));
      listen(r, track, "unmute", () => {
        if (run === r && r.degradedReason === "camera") {
          r.degradedReason = null;
          setStatus(r, r.detector ? "running" : "degraded", r.detector ? undefined : "Detection model not loaded.");
        }
      });
    }

    try {
      await video.play();
    } catch {
      // Autoplay of a muted stream normally works; if not, frames simply are not ready yet.
    }
    if (run !== r) return;

    try {
      const detector = await detectorFactory();
      if (run !== r) {
        detector.close?.();
        return;
      }
      r.detector = detector;
      setStatus(r, "running");
    } catch {
      if (run !== r) return;
      r.degradedReason = "model";
      setStatus(r, "degraded", "Detection model could not be loaded; browser checks still run.");
    }

    if (r.tracks.length === 0 || r.tracks.some((t) => t.readyState === "ended")) cameraLost("no live track");

    r.timers.push(setInterval(() => void tick(r), Math.max(50, r.config.detectionIntervalMs)));
    if (r.config.snapshotIntervalSeconds > 0) {
      r.timers.push(setInterval(() => void snapshot(r, "interval"), r.config.snapshotIntervalSeconds * 1000));
    }
  }

  return { start, stop };
}
