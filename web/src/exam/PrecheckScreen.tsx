import { useEffect, useId, useRef, useState } from "react";
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

type MicState = "idle" | "requesting" | "ok" | "denied" | "unavailable";

type Props = {
  heading: string;
  starting: boolean;
  startError: string | null;
  /** Gets the live camera stream. The exam keeps it for proctoring and stops it at the end. */
  onStart: (stream: MediaStream) => void;
  onCancel: () => void;
  frameCheck?: FrameCheckOptions;
};

function cameraError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
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
  if (check.state === "ok") return `Connected to the exam server (${check.ms} ms).`;
  if (check.state === "slow") return `Connected, but slow (${check.ms} ms). Answers may take longer to save.`;
  if (check.state === "offline") return "You are offline. Connect to the internet before you start.";
  return "The exam server could not be reached. Check your connection and try again.";
}

export function PrecheckScreen({ heading, starting, startError, onStart, onCancel, frameCheck }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handedOff = useRef(false);
  const runId = useRef(0);
  const [camera, setCamera] = useState<CameraState>({ state: "idle" });
  const [hasPreview, setHasPreview] = useState(false);
  const [mic, setMic] = useState<MicState>("idle");
  const [network, setNetwork] = useState<NetworkCheck | null>(null);
  const [networkBusy, setNetworkBusy] = useState(true);
  const [consent, setConsent] = useState(false);
  const [browser] = useState(checkBrowser);
  const consentId = useId();
  const blockedId = useId();

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
      if (!handedOff.current) stopStream(streamRef.current);
    },
    [],
  );

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
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (error) {
      if (run === runId.current) setCamera({ state: "failed", message: cameraError(error) });
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
          message: "The camera was turned off or its permission was removed. Select Check camera again.",
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

  async function runMicCheck() {
    setMic("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // Only the permission is checked. Nothing is recorded.
      stopStream(stream);
      setMic("ok");
    } catch (error) {
      const name = error instanceof DOMException || error instanceof Error ? error.name : "";
      setMic(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }

  function start() {
    const stream = streamRef.current;
    if (!stream || camera.state !== "passed" || !consent || starting) return;
    handedOff.current = true;
    onStart(stream);
  }

  // A failed start hands the stream back so the candidate can try again.
  useEffect(() => {
    if (startError) handedOff.current = false;
  }, [startError]);

  const browserBlocked = browser.some((item) => item.required && !item.ok);
  const missing: string[] = [];
  if (camera.state !== "passed") missing.push("pass the camera check");
  if (!consent) missing.push("agree to the proctoring notice");
  const canStart = missing.length === 0 && !starting;

  return (
    <section className="exam-precheck" aria-labelledby="precheck-heading">
      <h1 id="precheck-heading" ref={headingRef} tabIndex={-1}>
        Before you start: {heading}
      </h1>
      <p>The exam timer starts only when you select Start exam.</p>

      <h2>1. Camera</h2>
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
        {!hasPreview ? <p className="field-hint">Your camera preview appears here.</p> : null}
      </div>
      <p role="status" className={camera.state === "passed" ? "exam-check-ok" : undefined}>
        {camera.state === "idle" && "The camera has not been checked yet."}
        {camera.state === "requesting" && "Asking for camera permission…"}
        {camera.state === "checking" && "Checking the camera picture…"}
        {camera.state === "passed" && "Camera check passed."}
      </p>
      {camera.state === "failed" ? (
        <p role="alert" className="form-error">
          {camera.message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void runCameraCheck()}
        disabled={camera.state === "requesting" || camera.state === "checking" || starting}
      >
        {camera.state === "passed" ? "Check camera again" : "Check camera"}
      </button>

      <h2>2. Microphone (optional)</h2>
      <p className="field-hint">Checks only that your browser allows the microphone. Nothing is recorded.</p>
      <p role="status">
        {mic === "idle" && "The microphone has not been checked."}
        {mic === "requesting" && "Asking for microphone permission…"}
        {mic === "ok" && "Microphone permission is allowed."}
        {mic === "denied" && "Microphone permission was refused. You can still take the exam."}
        {mic === "unavailable" && "No microphone was found. You can still take the exam."}
      </p>
      <button type="button" onClick={() => void runMicCheck()} disabled={mic === "requesting" || starting}>
        Check microphone
      </button>

      <h2>3. Browser and network</h2>
      <ul className="exam-checklist">
        {browser.map((item) => (
          <li key={item.id}>
            <span className={item.ok ? "exam-check-ok" : "form-error-text"}>
              {item.label}: {item.ok ? "OK" : item.required ? "Not available" : "Not available (optional)"}
            </span>
            {!item.ok ? <span className="field-hint"> {item.help}</span> : null}
          </li>
        ))}
        <li>
          <span role="status">Network: {networkText(network, networkBusy)}</span>{" "}
          {!networkBusy ? (
            <button type="button" onClick={() => void rerunNetwork()}>
              Check network again
            </button>
          ) : null}
        </li>
      </ul>
      {browserBlocked ? (
        <p role="alert" className="form-error">
          This browser is missing something the exam needs. Open the portal in a recent browser over https.
        </p>
      ) : null}

      <h2>4. Proctoring notice</h2>
      <div className="exam-consent" id={consentId}>
        <p>Your camera is used for proctoring while the exam is open.</p>
        <ul>
          <li>No video is uploaded or recorded.</li>
          <li>
            The exam software looks for things like your face leaving the camera, another person, or a phone, and
            records a flag when it sees one. It may also take an occasional snapshot.
          </li>
          <li>Only those flags and snapshots are sent to the assessment agency.</li>
          <li>A person reviews every flag. Nothing is decided against you automatically.</li>
          <li>The exam opens in full screen. Leaving full screen or switching tabs is recorded as a flag.</li>
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
        I have read the proctoring notice and agree to the camera being used during the exam.
      </label>

      {startError ? (
        <p role="alert" className="form-error">
          {startError}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button type="button" onClick={start} disabled={!canStart} aria-describedby={canStart ? undefined : blockedId}>
          {starting ? "Starting…" : "Start exam"}
        </button>
        <button type="button" onClick={onCancel} disabled={starting}>
          Back to my exams
        </button>
      </div>
      {!canStart && !starting ? (
        <p id={blockedId} className="field-hint">
          To start, {missing.join(" and ")}.
        </p>
      ) : null}
    </section>
  );
}
