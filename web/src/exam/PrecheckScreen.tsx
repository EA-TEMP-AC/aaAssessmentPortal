import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  checkBrowser,
  checkNetwork,
  FRAME_CHECK_ATTEMPTS,
  FRAME_CHECK_INTERVAL_MS,
  isBlackFrame,
  sampleVideoFrame,
  stopStream,
  type NetworkCheck,
} from "./precheck";
import {
  captureIdCard,
  capturePrecheckReference,
  DEFAULT_FACE_CONFIG,
  FaceApiMatcher,
  toJpegBlob,
  verifyIdAgainstReference,
  type CameraDeps,
  type FaceConfig,
  type IdFaceMatcher,
} from "../proctoring/face";
import type { FaceStart } from "./faceEvidence";
import { holdScreen, releaseHeldScreen, requestScreen } from "./screenShare";

export type FrameCheckOptions = {
  sample?: (video: HTMLVideoElement) => Uint8ClampedArray | null;
  attempts?: number;
  intervalMs?: number;
};

type CameraState =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "checking" }
  | { state: "passed" }
  | { state: "failed"; message: string };

/** Tries before the by-hand fallback is offered (ID card or selfie). */
export const MAX_FACE_TRIES = 3;

export const ID_STEP_MESSAGES = {
  match: "The photo on the card and your face look alike.",
  mismatch:
    "The photo on the card and your face do not look alike. You can continue, and a proctor will review.",
  unreadable:
    "We could not read the photo on the card. Hold the card flat, close to the camera, with the photo in focus, then select Retry.",
  modelFailed:
    "The face check could not run on this device. You can continue; a proctor will check your ID by hand.",
} as const;

export const LOCATION_NOTICE =
  "This exam records your location with flag photos.";

export const FALLBACK_LABEL = "Continue; a proctor will check your ID by hand";

/** Tests swap the matcher, the camera helpers and the numbers; the page uses the real ones. */
export type FaceCheckOptions = {
  createMatcher?: () => IdFaceMatcher;
  deps?: CameraDeps;
  config?: FaceConfig;
  /** Turns a still into the JPEG kept for upload. Default: the canvas helper. */
  toJpeg?: (frame: ImageBitmap) => Promise<Blob>;
};

type IdResult = "pending" | "match" | "mismatch" | "unreadable";
type FaceModel = "idle" | "loading" | "ready" | "failed";

type MicState = "idle" | "requesting" | "ok" | "denied" | "unavailable";
type ScreenState = "idle" | "requesting" | "ok" | "denied" | "unavailable" | "not_entire" | "ended";

type Props = {
  heading: string;
  /** X-07: the batch records the location with flag photos. Shows a line in the notice. */
  captureLocation?: boolean;
  /** X-21: the batch requires the candidate to share the whole screen. */
  requireScreenShare?: boolean;
  starting: boolean;
  startError: string | null;
  /** Gets the live camera stream. The exam keeps it for proctoring and stops it at the end. */
  onStart: (stream: MediaStream, face: FaceStart) => void;
  onCancel: () => void;
  /** Text of the leave button. The exam window says "Close this window". */
  cancelLabel?: string;
  frameCheck?: FrameCheckOptions;
  faceChecks?: FaceCheckOptions;
};

function cameraError(error: unknown): string {
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was refused. Allow the camera in your browser's site settings, then select Check camera again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. Connect a camera, then select Check camera again.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close that app, then select Check camera again.";
  }
  return "The camera could not be started. Select Check camera to try again.";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function networkText(check: NetworkCheck | null, busy: boolean): string {
  if (busy || !check) return "Checking the connection…";
  if (check.state === "ok")
    return `Connected to the exam server (${check.ms} ms).`;
  if (check.state === "slow")
    return `Connected, but slow (${check.ms} ms). Answers may take longer to save.`;
  if (check.state === "offline")
    return "You are offline. Connect to the internet before you start.";
  return "The exam server could not be reached. Check your connection and try again.";
}

export function PrecheckScreen({
  heading,
  captureLocation,
  requireScreenShare = false,
  starting,
  startError,
  onStart,
  onCancel,
  cancelLabel = "Back to my exams",
  frameCheck,
  faceChecks,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null);
  const panelHeadingRefs = [
    useRef<HTMLHeadingElement>(null),
    useRef<HTMLHeadingElement>(null),
  ];
  const tabRefs = [
    useRef<HTMLButtonElement>(null),
    useRef<HTMLButtonElement>(null),
  ];
  const movedTab = useRef(false);
  const [step, setStep] = useState<0 | 1>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const handedOff = useRef(false);
  const runId = useRef(0);
  const [camera, setCamera] = useState<CameraState>({ state: "idle" });
  const [hasPreview, setHasPreview] = useState(false);
  const [mic, setMic] = useState<MicState>("idle");
  const [screen, setScreen] = useState<ScreenState>("idle");
  const [network, setNetwork] = useState<NetworkCheck | null>(null);
  const [networkBusy, setNetworkBusy] = useState(true);
  const [consent, setConsent] = useState(false);
  const [browser, setBrowser] = useState(checkBrowser);
  const faceConfig = faceChecks?.config ?? DEFAULT_FACE_CONFIG;
  const matcherRef = useRef<IdFaceMatcher | null>(null);
  const idFrameRef = useRef<ImageBitmap | null>(null);
  const idJpegRef = useRef<Blob | null>(null);
  const selfieJpegRef = useRef<Blob | null>(null);
  const idDistanceRef = useRef<number | undefined>(undefined);
  const [faceModel, setFaceModel] = useState<FaceModel>("idle");
  const [faceBusy, setFaceBusy] = useState<"id" | "selfie" | null>(null);
  const [idCaptured, setIdCaptured] = useState(false);
  const [selfieDone, setSelfieDone] = useState(false);
  const [idResult, setIdResult] = useState<IdResult>("pending");
  const [idFailures, setIdFailures] = useState(0);
  const [selfieFailures, setSelfieFailures] = useState(0);
  const [faceMessage, setFaceMessage] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const consentId = useId();
  const blockedId = useId();
  const nextHintId = useId();
  const tabsId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    void checkNetwork().then((result) => {
      if (!live) return;
      setNetwork(result);
      setNetworkBusy(false);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      runId.current += 1;
      if (!handedOff.current) {
        stopStream(streamRef.current);
        // Nothing from the face checks outlives this screen unless the exam took it over.
        matcherRef.current?.clear();
        idFrameRef.current?.close();
        idFrameRef.current = null;
        idJpegRef.current = null;
        selfieJpegRef.current = null;
      }
    },
    [],
  );

  function jpegOf(frame: ImageBitmap): Promise<Blob> {
    return faceChecks?.toJpeg
      ? faceChecks.toJpeg(frame)
      : toJpegBlob(frame, faceConfig);
  }

  function getMatcher(): IdFaceMatcher {
    if (!matcherRef.current)
      matcherRef.current = (
        faceChecks?.createMatcher ?? (() => new FaceApiMatcher(faceConfig))
      )();
    return matcherRef.current;
  }

  // Load the face model once the camera works, so the ID and selfie steps are ready when needed.
  useEffect(() => {
    if (camera.state !== "passed" || faceModel !== "idle") return;
    setFaceModel("loading");
    let live = true;
    getMatcher()
      .load()
      .then(() => live && setFaceModel("ready"))
      .catch(() => live && setFaceModel("failed"));
    return () => {
      live = false;
    };
    // The matcher is created once; only the camera state starts the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.state, faceModel]);

  function previewRef(target: { current: HTMLVideoElement | null }) {
    return (element: HTMLVideoElement | null) => {
      target.current = element;
      if (
        element &&
        streamRef.current &&
        element.srcObject !== streamRef.current
      ) {
        element.srcObject = streamRef.current;
        void Promise.resolve(element.play()).catch(() => {});
      }
    };
  }

  async function verifyId() {
    const frame = idFrameRef.current;
    const matcher = matcherRef.current;
    if (!frame || !matcher) return;
    let check;
    try {
      check = await verifyIdAgainstReference(frame, matcher, faceConfig);
    } catch {
      check = { result: "id_no_face" } as const;
    }
    frame.close();
    idFrameRef.current = null;
    setIdCaptured(false);
    if (check.result === "match" || check.result === "mismatch") {
      idDistanceRef.current = check.distance;
      setIdResult(check.result);
      setFaceMessage(null);
    } else if (check.result === "selfie_no_face") {
      setSelfieDone(false);
      setIdResult("pending");
      setFaceMessage(
        "Take the selfie again first: we need one clear view of your face.",
      );
    } else {
      setIdFailures((n) => n + 1);
      setIdResult("unreadable");
      setFaceMessage(null);
    }
  }

  async function captureId() {
    const video = idVideoRef.current;
    if (!video || faceBusy) return;
    setFaceBusy("id");
    setFaceMessage(null);
    const result = await captureIdCard(video, faceChecks?.deps);
    if (!result.ok) {
      setFaceMessage(result.message);
      setFaceBusy(null);
      return;
    }
    idFrameRef.current?.close();
    idFrameRef.current = result.frame;
    try {
      idJpegRef.current = await jpegOf(result.frame);
    } catch {
      idJpegRef.current = null;
    }
    setIdCaptured(true);
    setIdResult("pending");
    if (matcherRef.current?.hasReference()) await verifyId();
    setFaceBusy(null);
  }

  async function takeSelfie() {
    const video = selfieVideoRef.current;
    if (!video || faceBusy) return;
    setFaceBusy("selfie");
    setFaceMessage(null);
    const result = await capturePrecheckReference(
      video,
      getMatcher(),
      faceConfig,
      faceChecks?.deps,
    );
    if (!result.ok) {
      setSelfieFailures((n) => n + 1);
      setFaceMessage(result.message);
      setFaceBusy(null);
      return;
    }
    try {
      selfieJpegRef.current = await jpegOf(result.frame);
    } catch {
      selfieJpegRef.current = null;
    }
    result.frame.close();
    setSelfieDone(true);
    if (idFrameRef.current) await verifyId();
    setFaceBusy(null);
  }

  async function rerunNetwork() {
    setNetworkBusy(true);
    setNetwork(await checkNetwork());
    setNetworkBusy(false);
  }

  async function runCameraCheck() {
    const run = ++runId.current;
    stopStream(streamRef.current);
    streamRef.current = null;
    setHasPreview(false);
    setCamera({ state: "requesting" });

    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    } catch (error) {
      if (run === runId.current)
        setCamera({ state: "failed", message: cameraError(error) });
      return;
    }
    if (run !== runId.current) {
      stopStream(stream);
      return;
    }
    streamRef.current = stream;
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (streamRef.current !== stream || handedOff.current) return;
        setCamera({
          state: "failed",
          message:
            "The camera was turned off or its permission was removed. Select Check camera again.",
        });
      });
    });

    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay is muted, so this only fails in odd browsers; the frame check still runs.
      }
    }
    setHasPreview(true);
    setCamera({ state: "checking" });

    const sample = frameCheck?.sample ?? sampleVideoFrame;
    const attempts = frameCheck?.attempts ?? FRAME_CHECK_ATTEMPTS;
    const interval = frameCheck?.intervalMs ?? FRAME_CHECK_INTERVAL_MS;
    let sawFrame = false;
    for (let i = 0; i < attempts; i += 1) {
      if (run !== runId.current) return;
      const pixels = video ? sample(video) : null;
      if (pixels) {
        sawFrame = true;
        if (!isBlackFrame(pixels)) {
          setCamera({ state: "passed" });
          return;
        }
      }
      if (i < attempts - 1) await wait(interval);
    }
    if (run !== runId.current) return;
    setCamera({
      state: "failed",
      message: sawFrame
        ? "The camera picture is black. Uncover the camera, turn on a light, and select Check camera again."
        : "No picture came from the camera. Select Check camera again.",
    });
  }

  async function runScreenCheck() {
    setScreen("requesting");
    const outcome = await requestScreen();
    if (outcome.state !== "ok") {
      holdScreen(null);
      setScreen(outcome.state);
      return;
    }
    holdScreen(outcome.stream);
    for (const track of outcome.stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        // Stopped before the exam started: ask again.
        releaseHeldScreen();
        setScreen("ended");
      });
    }
    setScreen("ok");
  }

  // Leaving without starting stops the share. Once the exam has the stream, it is the exam's.
  useEffect(
    () => () => {
      if (!handedOff.current) releaseHeldScreen();
    },
    [],
  );

  async function runMicCheck() {
    setMic("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      // Only the permission is checked. Nothing is recorded.
      stopStream(stream);
      setMic("ok");
    } catch (error) {
      const name =
        error instanceof DOMException || error instanceof Error
          ? error.name
          : "";
      setMic(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : "unavailable",
      );
    }
  }

  const idChecked =
    selfieDone && (idResult === "match" || idResult === "mismatch");
  const canFallback =
    idFailures >= MAX_FACE_TRIES ||
    selfieFailures >= MAX_FACE_TRIES ||
    faceModel === "failed";
  const faceDone = idChecked || fallback;

  function start() {
    const stream = streamRef.current;
    if (
      !stream ||
      camera.state !== "passed" ||
      !consent ||
      !faceDone ||
      starting
    )
      return;
    const matcher = matcherRef.current;
    handedOff.current = true;
    // Called inside the click: the page asks for full screen before it awaits anything.
    onStart(stream, {
      matcher: matcher && matcher.hasReference() ? matcher : null,
      idJpeg: idJpegRef.current,
      selfieJpeg: selfieJpegRef.current,
      idOutcome: idChecked ? (idResult as "match" | "mismatch") : "unreadable",
      idDistance: idChecked ? idDistanceRef.current : undefined,
    });
  }

  // A failed start hands the stream back so the candidate can try again.
  useEffect(() => {
    if (startError) handedOff.current = false;
  }, [startError]);

  const networkOk = network?.state === "ok" || network?.state === "slow";
  const required: { ok: boolean; todo: string }[] = [
    ...browser
      .filter((item) => item.required)
      .map((item) => ({ ok: item.ok, todo: item.label.toLowerCase() })),
    { ok: camera.state === "passed", todo: "camera access" },
    { ok: !networkBusy && networkOk, todo: "network speed" },
    ...(requireScreenShare ? [{ ok: screen === "ok", todo: "screen sharing" }] : []),
  ];
  const step1Ok = required.every((row) => row.ok);
  const step1Todo = required.filter((row) => !row.ok).map((row) => row.todo);

  function goTo(next: 0 | 1) {
    if (next === 1 && !step1Ok) return;
    movedTab.current = true;
    setStep(next);
  }

  // Move focus to the new panel's heading after a tab change, never on the first render.
  useEffect(() => {
    if (!movedTab.current) return;
    movedTab.current = false;
    panelHeadingRefs[step].current?.focus();
    // The refs are stable; only the step moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function onTabKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    let next: 0 | 1 | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft")
      next = step === 0 ? 1 : 0;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    if (next === null) return;
    event.preventDefault();
    if (next === 1 && !step1Ok) return;
    goTo(next);
    tabRefs[next].current?.focus();
  }

  const missing: string[] = [];
  if (!step1Ok) missing.push("pass the browser checks");
  if (!faceDone) missing.push("show your ID card and take a selfie");
  if (!consent) missing.push("agree to the proctoring notice");
  const canStart = missing.length === 0 && !starting;

  const tabs = ["Browser checks", "Photo ID and photo"] as const;
  const progress = step === 0 ? (step1Ok ? 1 : 0) : faceDone && consent ? 2 : 1;

  return (
    <section className="exam-precheck" aria-labelledby="precheck-heading">
      <h1 id="precheck-heading" ref={headingRef} tabIndex={-1}>
        Before you start: {heading}
      </h1>
      <p>The exam timer starts only when you select Start exam.</p>

      <div
        className="exam-progress"
        role="progressbar"
        aria-label="Pre-exam check progress"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={progress}
        aria-valuetext={`Step ${step + 1} of 2: ${tabs[step]}`}
      >
        <div
          className="exam-progress-bar"
          style={{ width: `${(progress / 2) * 100}%` }}
        />
      </div>
      <p className="exam-progress-text" aria-hidden="true">
        Step {step + 1} of 2: {tabs[step]}
      </p>

      <div
        role="tablist"
        aria-label="Pre-exam check steps"
        className="exam-tabs"
      >
        {tabs.map((name, index) => {
          const done = index === 0 && step1Ok && step === 1;
          const locked = index === 1 && !step1Ok;
          return (
            <button
              key={name}
              ref={tabRefs[index]}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${index}`}
              aria-selected={step === index}
              aria-controls={`${tabsId}-panel-${index}`}
              tabIndex={step === index ? 0 : -1}
              disabled={locked}
              className="exam-tab"
              onClick={() => goTo(index as 0 | 1)}
              onKeyDown={onTabKey}
            >
              {index + 1}. {name}
              {done ? <span className="visually-hidden"> (done)</span> : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-panel-0`}
        aria-labelledby={`${tabsId}-tab-0`}
        hidden={step !== 0}
        className="exam-tabpanel"
      >
        <h2 ref={panelHeadingRefs[0]} tabIndex={-1}>
          Browser checks
        </h2>
        <ul className="exam-checks">
          {browser.map((item) => (
            <CheckRow
              key={item.id}
              label={item.label}
              state={item.ok ? "pass" : "fail"}
              reason={
                item.ok
                  ? item.id === "secure"
                    ? "The connection to this page is secure."
                    : "Your browser can run the exam."
                  : item.help
              }
              buttonLabel={`Retry ${item.label.toLowerCase()} check`}
              onRetry={() => setBrowser(checkBrowser())}
              disabled={starting}
            />
          ))}
          <CheckRow
            label="Camera access"
            state={
              camera.state === "passed"
                ? "pass"
                : camera.state === "failed"
                  ? "fail"
                  : camera.state === "idle"
                    ? "idle"
                    : "busy"
            }
            reason={cameraReason(camera)}
            buttonLabel={
              camera.state === "idle" ? "Check camera" : "Retry camera check"
            }
            onRetry={() => void runCameraCheck()}
            disabled={
              camera.state === "requesting" ||
              camera.state === "checking" ||
              starting
            }
          />
          <CheckRow
            label="Microphone"
            optional
            state={
              mic === "ok"
                ? "pass"
                : mic === "denied" || mic === "unavailable"
                  ? "fail"
                  : mic === "idle"
                    ? "idle"
                    : "busy"
            }
            reason={micReason(mic)}
            buttonLabel={
              mic === "idle" ? "Check microphone" : "Retry microphone check"
            }
            onRetry={() => void runMicCheck()}
            disabled={mic === "requesting" || starting}
          />
          {requireScreenShare ? (
            <CheckRow
              label="Screen sharing"
              state={
                screen === "ok"
                  ? "pass"
                  : screen === "idle"
                    ? "idle"
                    : screen === "requesting"
                      ? "busy"
                      : "fail"
              }
              reason={screenReason(screen)}
              buttonLabel={screen === "idle" ? "Share screen" : "Share screen again"}
              onRetry={() => void runScreenCheck()}
              disabled={screen === "requesting" || starting}
            />
          ) : null}
          <CheckRow
            label="Network speed"
            state={
              networkBusy || !network ? "busy" : networkOk ? "pass" : "fail"
            }
            reason={networkText(network, networkBusy)}
            buttonLabel="Retry network check"
            onRetry={() => void rerunNetwork()}
            disabled={networkBusy || starting}
          />
        </ul>

        <div className="exam-camera">
          <video
            ref={videoRef}
            className="exam-preview"
            aria-label="Camera preview"
            muted
            playsInline
            autoPlay
            hidden={!hasPreview}
          />
          {!hasPreview ? (
            <p className="field-hint">Your camera preview appears here.</p>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => goTo(1)}
            disabled={!step1Ok || starting}
            aria-describedby={step1Ok ? undefined : nextHintId}
          >
            Next: photo ID and photo
          </button>
          <button type="button" onClick={onCancel} disabled={starting}>
            {cancelLabel}
          </button>
        </div>
        {!step1Ok ? (
          <p id={nextHintId} className="field-hint">
            To continue, pass: {step1Todo.join(", ")}.
          </p>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-panel-1`}
        aria-labelledby={`${tabsId}-tab-1`}
        hidden={step !== 1}
        className="exam-tabpanel"
      >
        <h2 ref={panelHeadingRefs[1]} tabIndex={-1}>
          Photo ID and photo
        </h2>
        {camera.state !== "passed" ? (
          <div role="alert" className="form-error">
            <p>
              The camera is not working. Go back to the browser checks and retry
              the camera check.
            </p>
            <button type="button" onClick={() => goTo(0)}>
              Back to browser checks
            </button>
          </div>
        ) : null}

        <h3>Show your ID card</h3>
        <p className="field-hint">
          Hold your ID card in front of the camera so the photo on it is flat
          and in focus. The page does not read the card's text or number.
        </p>
        {hasPreview ? (
          <video
            className="exam-preview"
            aria-label="ID card preview"
            muted
            playsInline
            autoPlay
            ref={previewRef(idVideoRef)}
          />
        ) : null}
        <button
          type="button"
          onClick={() => void captureId()}
          disabled={
            camera.state !== "passed" ||
            faceBusy !== null ||
            starting ||
            faceModel === "failed"
          }
        >
          {idResult === "unreadable" ? "Retry" : "Capture ID card"}
        </button>
        <p role="status">
          {camera.state === "passed" &&
            faceModel === "loading" &&
            "Loading the face check…"}
          {faceModel === "failed" && ID_STEP_MESSAGES.modelFailed}
          {faceModel !== "failed" &&
            idCaptured &&
            idResult === "pending" &&
            !selfieDone &&
            "ID card captured. Now take a selfie."}
          {idResult === "match" && ID_STEP_MESSAGES.match}
          {idResult === "mismatch" && ID_STEP_MESSAGES.mismatch}
          {idResult === "unreadable" && ID_STEP_MESSAGES.unreadable}
        </p>

        <h3>Take a selfie</h3>
        <p className="field-hint">
          Look straight at the camera, alone in the picture, with your face well
          lit.
        </p>
        {hasPreview ? (
          <video
            className="exam-preview"
            aria-label="Selfie preview"
            muted
            playsInline
            autoPlay
            ref={previewRef(selfieVideoRef)}
          />
        ) : null}
        <button
          type="button"
          onClick={() => void takeSelfie()}
          disabled={
            camera.state !== "passed" ||
            faceBusy !== null ||
            starting ||
            faceModel === "failed"
          }
        >
          {selfieDone ? "Take selfie again" : "Take selfie"}
        </button>
        <p role="status">
          {selfieDone
            ? "Selfie taken."
            : camera.state === "passed"
              ? "No selfie yet."
              : ""}
        </p>
        {faceMessage ? (
          <p role="alert" className="form-error">
            {faceMessage}
          </p>
        ) : null}
        {canFallback && !faceDone ? (
          <button
            type="button"
            onClick={() => setFallback(true)}
            disabled={starting}
          >
            {FALLBACK_LABEL}
          </button>
        ) : null}
        {fallback && !idChecked ? (
          <p role="status">
            A proctor will check your ID by hand. You can start the exam.
          </p>
        ) : null}

        <h3>Proctoring notice</h3>
        <div className="exam-consent" id={consentId}>
          <p>Your camera is used for proctoring while the exam is open.</p>
          <ul>
            <li>No video is uploaded or recorded.</li>
            <li>
              The exam software looks for things like your face leaving the
              camera, another person, or a phone, and records a flag when it
              sees one. It may also take an occasional snapshot.
            </li>
            <li>
              The face on your ID card is compared with your selfie, and your
              face is compared with that selfie during the exam. No government
              record is checked. The comparison happens in your browser.
            </li>
            <li>
              Nothing is sent except flags and a few photos, including the photo
              of your ID card and your selfie.
            </li>
            {captureLocation ? (
              <li>
                {LOCATION_NOTICE} Your browser asks for permission first. If you
                refuse, the exam carries on and the photos say the location was
                not shared.
              </li>
            ) : null}
            <li>
              A person reviews every flag. Nothing is decided against you
              automatically.
            </li>
            <li>
              The exam opens in its own window. Switching to another tab or
              window during the exam is recorded as a flag.
            </li>
          </ul>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            aria-describedby={consentId}
            disabled={starting}
          />
          I have read the proctoring notice and agree to the camera being used
          during the exam.
        </label>

        {startError ? (
          <p role="alert" className="form-error">
            {startError}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            aria-describedby={canStart ? undefined : blockedId}
          >
            {starting ? "Starting…" : "Start exam"}
          </button>
          <button type="button" onClick={() => goTo(0)} disabled={starting}>
            Back to browser checks
          </button>
          <button type="button" onClick={onCancel} disabled={starting}>
            {cancelLabel}
          </button>
        </div>
        {!canStart && !starting ? (
          <p id={blockedId} className="field-hint">
            To start, {missing.join(" and ")}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function cameraReason(camera: CameraState): string {
  switch (camera.state) {
    case "failed":
      return camera.message;
    case "passed":
      return "The camera works.";
    case "requesting":
      return "Asking for camera permission…";
    case "checking":
      return "Checking the camera picture…";
    default:
      return "Select Check camera and allow the camera when your browser asks.";
  }
}

function screenReason(screen: ScreenState): string {
  switch (screen) {
    case "ok":
      return "Your whole screen is being shared. Keep sharing until the exam ends.";
    case "denied":
      return "Screen sharing was refused. This exam needs it. Select Share screen and allow it.";
    case "unavailable":
      return "This browser cannot share the screen. Use a recent Chrome or Edge on a computer.";
    case "not_entire":
      return "You shared a window or a tab. Choose Entire screen, then select Share screen again.";
    case "ended":
      return "Sharing was stopped. Select Share screen again.";
    case "requesting":
      return "Waiting for you to choose the screen to share…";
    default:
      return "This exam needs your whole screen shared. Nothing from the screen is recorded or sent; a flag is recorded if you stop sharing.";
  }
}

function micReason(mic: MicState): string {
  switch (mic) {
    case "ok":
      return "Microphone permission is allowed.";
    case "denied":
      return "Microphone permission was refused. You can still take the exam.";
    case "unavailable":
      return "No microphone was found. You can still take the exam.";
    case "requesting":
      return "Asking for microphone permission…";
    default:
      return "Checks only that your browser allows the microphone. Nothing is recorded.";
  }
}

type CheckState = "pass" | "fail" | "busy" | "idle";

function CheckRow({
  label,
  optional = false,
  state,
  reason,
  buttonLabel,
  onRetry,
  disabled,
}: {
  label: string;
  optional?: boolean;
  state: CheckState;
  reason: string;
  buttonLabel: string;
  onRetry: () => void;
  disabled: boolean;
}) {
  const word =
    state === "pass"
      ? "Pass"
      : state === "busy"
        ? "Checking"
        : state === "idle"
          ? "Not checked"
          : optional
            ? "Not available"
            : "Fail";
  const blocking = state === "fail" && !optional;
  return (
    <li className="exam-check-row">
      <strong>
        {label}
        {optional ? " (optional)" : ""}
      </strong>{" "}
      <span
        className={
          state === "pass"
            ? "exam-check-ok"
            : blocking
              ? "form-error-text"
              : undefined
        }
      >
        {word}.
      </span>{" "}
      <span className="exam-check-reason" role={blocking ? "alert" : undefined}>
        {reason}
      </span>{" "}
      <button type="button" onClick={onRetry} disabled={disabled}>
        {buttonLabel}
      </button>
    </li>
  );
}
