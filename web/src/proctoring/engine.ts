import { bannerFor, type BannerInput } from "./banner";
import { PROCTOR_THRESHOLDS, type ProctorThresholds } from "./config";
import type { DetectorFactory } from "./detector";
import {
  createDetectionFramer,
  createFrameSampler,
  createSnapshotTaker,
  type DetectionFrame,
  type FrameSampler,
  type SnapshotTaker,
} from "./frame";
import {
  faceConfig,
  evaluateIdentity,
  INITIAL_IDENTITY_STATE,
  type FaceConfig,
  type FaceFlag,
  type FaceMatcher,
  type IdentityState,
} from "./face";
import { describeError, proctorDebug } from "./debug";
import { createLocationProvider, type LocationProvider, type PhotoLocation } from "./location";
import { createVoiceMeter, type VoiceMeter } from "./audio";
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
  /** X-07: where the browser is. Used only when start() is told the batch captures location. */
  locationProvider?: LocationProvider;
  /** Builds the scaled-down frame the detector reads. Default: at most `detectionMaxWidth` wide. */
  framerFactory?: () => { make: (video: HTMLVideoElement) => Promise<DetectionFrame>; release: () => void };
  /** High-resolution clock for timing a check. Default performance.now. */
  perfNow?: () => number;
  /** For the demo page: how long each check took, in ms. Checks that were skipped are not counted. */
  onTick?: (ms: number) => void;
  /** Whether the video has a frame the model can read. Default: readyState >= 2. */
  isFrameReady?: (video: HTMLVideoElement) => boolean;
  /** X-14: builds the loudness meter for a microphone stream. Default: Web Audio. */
  voiceMeterFactory?: (stream: MediaStream) => VoiceMeter | null;
  /** Face check numbers (mismatch samples, hold time, cooldown). Default: face/config.ts. */
  faceConfig?: FaceConfig;
  /** For the demo page: what the model saw this cycle (null when degraded). */
  onDetections?: (
    detections: Detection[] | null,
    stats: { brightness: number | null; identical: boolean | null },
  ) => void;
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
  framer: { make: (video: HTMLVideoElement) => Promise<DetectionFrame>; release: () => void };
  onFlag?: (flag: RaisedFlag) => void;
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
  /** The caller's matcher. Always cleared on stop, even when it is not used for comparing. */
  faceMatcher: FaceMatcher | null;
  /** True when the matcher is loaded and compared every cycle. */
  faceActive: boolean;
  identity: IdentityState;
  /** X-07: null when the batch does not capture location. */
  location: LocationProvider | null;
  /** X-14: null when there is no microphone. Loudness only; no sound is kept. */
  voice: VoiceMeter | null;
};

export const FACE_MODEL_MESSAGE = "The face check could not load; the other browser checks still run.";

/**
 * Server detail shape is { label, count, confidence } (letters, digits, space, _ and - in label).
 * label carries the distance in hundredths ("distance_71"), count the mismatched samples, and
 * confidence is left out: a distance is not a confidence. See docs/PROCTORING_ENGINE.md.
 */
export function faceFlagDetail(flag: FaceFlag): FlagDetail {
  const { samples, distance } = flag.detail;
  const label = typeof distance === "number" ? `distance_${Math.round(distance * 100)}` : flag.type;
  return { label, count: samples } as FlagDetail;
}

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
  const framerFactory = options.framerFactory ?? (() => createDetectionFramer(thresholds));
  const perfNow = options.perfNow ?? (() => performance.now());
  const takeSnapshot = options.takeSnapshot ?? createSnapshotTaker(thresholds);
  const isFrameReady = options.isFrameReady ?? ((video: HTMLVideoElement) => video.readyState >= 2);
  const faceCfg = options.faceConfig ?? faceConfig();
  const voiceMeterFactory = options.voiceMeterFactory ?? ((stream: MediaStream) => createVoiceMeter(stream, thresholds));

  let run: Run | null = null;

  function setStatus(r: Run, state: ProctorStatus["state"], message?: string) {
    if (r.status === state && state !== "degraded") return;
    r.status = state;
    r.onStatus(message ? { state, message } : { state });
  }

  /** Where the engine stands when nothing else is wrong: running, or degraded if the face model failed. */
  function settle(r: Run) {
    if (r.faceMatcher && !r.faceActive) setStatus(r, "degraded", FACE_MODEL_MESSAGE);
    else setStatus(r, "running");
  }

  function eventId(r: Run, prefix: string): string {
    r.seq += 1;
    return `${r.attemptId.slice(0, 60)}-${prefix}${r.seq}-${randomPart()}`.slice(0, 200);
  }

  async function snapshot(
    r: Run,
    reason: "interval" | ProctorFlagType,
    banner?: Promise<BannerInput>,
  ): Promise<string | null> {
    let evidenceId: string | null = null;
    try {
      const blob = await takeSnapshot(r.video, banner);
      if (!blob) proctorDebug.snapshotFailed("no image from the camera");
      if (blob && run === r) {
        evidenceId = await r.transport.uploadSnapshot({
          batchId: r.batchId,
          sessionId: r.sessionId,
          clientEventId: eventId(r, "s"),
          capturedAt: new Date(now()).toISOString(),
          blob,
        });
      }
    } catch (error) {
      evidenceId = null;
      proctorDebug.snapshotFailed(describeError(error));
    }
    if (run === r) options.onSnapshot?.(reason, evidenceId);
    return evidenceId;
  }

  async function send(r: Run, flag: RaisedFlag) {
    try {
      r.onFlag?.(flag);
    } catch {
      // The page's notice must never stop the flag from being sent.
    }
    const capturedAt = new Date(flag.at).toISOString();
    const clientEventId = eventId(r, "f");
    // X-07: the photo is taken at once; the banner waits for the location (cached, never tracked).
    const where: Promise<PhotoLocation | null> = r.location
      ? r.location.get().catch(() => null)
      : Promise.resolve(null);
    const banner = where.then((location) => bannerFor(flag, r.config, r.attemptId, location));
    const evidenceId = await snapshot(r, flag.type, banner);
    const location = await where;
    if (run !== r) return;
    const body: FlagBody = { clientEventId, type: flag.type, capturedAt };
    if (flag.detail) body.detail = flag.detail;
    if (evidenceId) body.evidenceId = evidenceId;
    if (location) {
      body.location = {
        latitude: location.latitude,
        longitude: location.longitude,
        ...(location.accuracy === null ? {} : { accuracy: location.accuracy }),
      };
    }
    options.onFlag?.(flag, body);
    await r.transport.sendFlag(r.sessionId, body);
  }

  function raiseEvent(r: Run, type: ProctorFlagType, detail?: FlagDetail) {
    if (run !== r) return;
    const result = evaluateEvent(r.rules, type, now(), r.config, detail);
    r.rules = result.state;
    if (result.flag) void send(r, result.flag);
  }

  /** Compares the live face with the selfie. A flag needs the rules; one frame never raises it. */
  async function checkIdentity(r: Run) {
    const matcher = r.faceMatcher;
    if (!matcher || !r.faceActive || !isFrameReady(r.video)) return;
    let sample;
    try {
      sample = await matcher.compare(r.video);
    } catch {
      return;
    }
    if (run !== r) return;
    const step = evaluateIdentity(sample, r.identity, faceCfg, now());
    r.identity = step.state;
    if (step.flag) {
      void send(r, {
        type: step.flag.type,
        at: step.flag.at,
        detail: faceFlagDetail(step.flag),
      });
    }
  }

  async function tick(r: Run) {
    // One check at a time, and none while the tab is hidden (nothing useful to see, and it saves power).
    if (r.busy || run !== r || document.visibilityState === "hidden") return;
    r.busy = true;
    const startedAt = perfNow();
    try {
      const gray = r.sampler.sample(r.video);
      const stats = gray ? frameStats(gray, r.previous, thresholds) : { brightness: null, identical: null };
      r.previous = gray;

      let detections: Detection[] | null = null;
      if (r.detector && isFrameReady(r.video)) {
        try {
          const frame = await r.framer.make(r.video);
          try {
            detections = await r.detector.detect(frame);
          } finally {
            if (frame !== r.video) (frame as ImageBitmap).close?.();
          }
          if (r.degradedReason === "detect") {
            r.degradedReason = null;
            settle(r);
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
      let voiceLevel: number | null = null;
      try {
        voiceLevel = r.voice ? r.voice.read() : null;
      } catch {
        voiceLevel = null;
      }
      const result = evaluateFrame(r.rules, { detections, ...stats, voiceLevel }, now(), r.config, thresholds);
      r.rules = result.state;
      for (const flag of result.flags) void send(r, flag);
      await checkIdentity(r);
      proctorDebug.tick(perfNow() - startedAt);
    } finally {
      r.busy = false;
      if (run === r) options.onTick?.(perfNow() - startedAt);
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
    r.framer.release();
    try {
      r.voice?.release();
    } catch {
      // A meter that fails to release has nothing more to free.
    }
    try {
      r.video.pause();
    } catch {
      // jsdom and some browsers throw on pause of an unplayed element.
    }
    r.video.srcObject = null;
    r.video.remove();
    // The selfie reference lives only in memory, and only for the exam.
    try {
      r.faceMatcher?.clear();
    } catch {
      // Nothing more can be done with a matcher that fails to clear.
    }
    // A transport the caller passed in is theirs to dispose.
    if (!options.transport) r.transport.dispose();
    setStatus(r, "stopped");
  }

  async function start(o: Parameters<ProctorEngine["start"]>[0]) {
    stop();
    proctorDebug.reset();
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
      framer: framerFactory(),
      onFlag: o.onFlag,
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
      faceMatcher: o.faceMatcher ?? null,
      faceActive: false,
      identity: INITIAL_IDENTITY_STATE,
      location: o.captureLocation ? (options.locationProvider ?? createLocationProvider()) : null,
      voice:
        o.audioStream && !o.config.disabledFlags?.includes("voice_detected")
          ? voiceMeterFactory(o.audioStream)
          : null,
    };
    run = r;
    setStatus(r, "starting");

    // Browser-event checks start first and keep running even without a model.
    listen(r, document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") raiseEvent(r, "tab_hidden");
    });
    listen(r, window, "blur", () => raiseEvent(r, "window_blur"));
    if (o.watchFullscreen !== false) {
      listen(r, document, "fullscreenchange", () => {
        const isFull = Boolean(document.fullscreenElement);
        if (r.wasFullscreen && !isFull) raiseEvent(r, "fullscreen_exit");
        r.wasFullscreen = isFull;
      });
    }
    const cameraLost = (reason: string) => {
      raiseEvent(r, "permission_revoked", {
        label: reason,
        count: 1,
        confidence: 1,
      });
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
          if (r.detector) settle(r);
          else setStatus(r, "degraded", "Detection model not loaded.");
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

    // The face model is separate: if it fails, only the face comparison is lost.
    if (r.faceMatcher) {
      try {
        await r.faceMatcher.load();
        if (run !== r) return;
        r.faceActive = true;
      } catch {
        if (run !== r) return;
        r.faceActive = false;
        if (r.degradedReason === null) setStatus(r, "degraded", FACE_MODEL_MESSAGE);
      }
    }

    if (r.tracks.length === 0 || r.tracks.some((t) => t.readyState === "ended")) cameraLost("no live track");

    r.timers.push(setInterval(() => void tick(r), Math.max(50, Math.min(r.config.detectionIntervalMs, thresholds.faceDetectionIntervalMs))));
    if (r.config.snapshotIntervalSeconds > 0) {
      r.timers.push(setInterval(() => void snapshot(r, "interval"), r.config.snapshotIntervalSeconds * 1000));
    }
  }

  return { start, stop };
}
