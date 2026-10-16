import { useEffect, useRef, useState } from "react";
import {
  captureIdCard,
  capturePrecheckReference,
  evaluateIdentity,
  evidenceJpegs,
  FaceApiMatcher,
  faceConfig,
  idCheckOutcome,
  INITIAL_IDENTITY_STATE,
  verifyIdAgainstReference,
  wouldRaiseOnNextMismatch,
  type CompareResult,
  type FaceFlag,
  type IdCheckOutcome,
  type IdCheckResult,
  type IdentityState,
} from "../proctoring/face";

/**
 * Dev-only page (aa_admin) for the 1:1 face checks. Works without the server: nothing is
 * uploaded, the selfie descriptor stays in memory and is wiped on Stop or when the page closes.
 */

const CONFIG = faceConfig();
const MAX_SHOWN_FLAGS = 20;

type Step = "camera" | "id" | "selfie" | "live";
type IdShown = { check: IdCheckResult; outcome: IdCheckOutcome };
type Live = { sample: CompareResult; identity: IdentityState; wouldRaise: boolean };

function timeIst(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function FaceMatchDemoPage() {
  const [step, setStep] = useState<Step>("camera");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idShown, setIdShown] = useState<IdShown | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [running, setRunning] = useState(false);
  const [flags, setFlags] = useState<FaceFlag[]>([]);
  const [jpegSizes, setJpegSizes] = useState<{ idCard: number; selfie: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const matcherRef = useRef<FaceApiMatcher | null>(null);
  const idFrameRef = useRef<ImageBitmap | null>(null);
  const selfieFrameRef = useRef<ImageBitmap | null>(null);
  const timerRef = useRef<number | null>(null);
  const identityRef = useRef<IdentityState>(INITIAL_IDENTITY_STATE);
  const sampling = useRef(false);

  function stopLive() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRunning(false);
  }

  function release() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    matcherRef.current?.clear();
    matcherRef.current = null;
    idFrameRef.current?.close();
    idFrameRef.current = null;
    selfieFrameRef.current?.close();
    selfieFrameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => release, []);

  async function startCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open a camera here. Use a current browser over https or localhost.");
      return;
    }
    setBusy("Opening camera and loading the face model…");
    let cameraOpened = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      cameraOpened = true;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
      const matcher = new FaceApiMatcher(CONFIG);
      matcherRef.current = matcher;
      await matcher.load();
      setStep("id");
    } catch (err) {
      release();
      const name = err instanceof DOMException ? err.name : "";
      setError(
        cameraOpened
          ? "The face model could not be loaded. Check that /models/face is served."
          : name === "NotAllowedError"
            ? "Camera permission was refused. Allow the camera in the browser and try again."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : "The camera could not be opened.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function verifyId() {
    const matcher = matcherRef.current;
    if (!matcher || !idFrameRef.current) return;
    const check = await verifyIdAgainstReference(idFrameRef.current, matcher, CONFIG);
    const outcome = idCheckOutcome(check, Date.now());
    setIdShown({ check, outcome });
    if (outcome.flag) {
      const flag = outcome.flag;
      setFlags((list) => [flag, ...list].slice(0, MAX_SHOWN_FLAGS));
    }
  }

  async function takeIdCard() {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setBusy("Capturing the ID card…");
    try {
      const result = await captureIdCard(video);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      idFrameRef.current?.close();
      idFrameRef.current = result.frame;
      setJpegSizes(null);
      if (step === "id") setStep("selfie");
      else await verifyId();
    } finally {
      setBusy(null);
    }
  }

  async function takeSelfie() {
    const video = videoRef.current;
    const matcher = matcherRef.current;
    if (!video || !matcher) return;
    setError(null);
    setBusy("Looking for one clear face…");
    try {
      const result = await capturePrecheckReference(video, matcher, CONFIG);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      selfieFrameRef.current?.close();
      selfieFrameRef.current = result.frame;
      setJpegSizes(null);
      await verifyId();
      setStep("live");
    } finally {
      setBusy(null);
    }
  }

  async function sample() {
    const video = videoRef.current;
    const matcher = matcherRef.current;
    if (!video || !matcher || sampling.current) return;
    sampling.current = true;
    try {
      const result = await matcher.compare(video);
      const now = Date.now();
      const step = evaluateIdentity(result, identityRef.current, CONFIG, now);
      identityRef.current = step.state;
      const flag = step.flag;
      if (flag) setFlags((list) => [flag, ...list].slice(0, MAX_SHOWN_FLAGS));
      setLive({
        sample: result,
        identity: step.state,
        wouldRaise: wouldRaiseOnNextMismatch(step.state, CONFIG, now + CONFIG.sampleIntervalMs),
      });
    } finally {
      sampling.current = false;
    }
  }

  function startLive() {
    identityRef.current = INITIAL_IDENTITY_STATE;
    setLive(null);
    setRunning(true);
    void sample();
    timerRef.current = window.setInterval(() => void sample(), CONFIG.sampleIntervalMs);
  }

  async function prepareJpegs() {
    if (!idFrameRef.current || !selfieFrameRef.current) return;
    setError(null);
    try {
      const out = await evidenceJpegs({ idCard: idFrameRef.current, selfie: selfieFrameRef.current }, CONFIG);
      setJpegSizes({ idCard: out.idCard.size, selfie: out.selfie.size });
    } catch {
      setError("The JPEG copies could not be made in this browser.");
    }
  }

  function stopAll() {
    release();
    setRunning(false);
    setStep("camera");
    setIdShown(null);
    setLive(null);
    setJpegSizes(null);
    identityRef.current = INITIAL_IDENTITY_STATE;
  }

  const cameraOn = step !== "camera";

  return (
    <>
      <h1>Face match demo</h1>
      <p>
        Development only. Compares the photo on an ID card with a selfie, then the live face with the selfie.
        It answers only “are these the same person?”; no government record is used. Nothing is sent to the
        server and nothing is stored. Flags are for a human to review.
      </p>

      <div className="row-actions">
        <button type="button" onClick={() => void startCamera()} disabled={cameraOn || busy !== null}>
          Start camera
        </button>
        <button type="button" className="button-quiet" onClick={stopAll} disabled={!cameraOn}>
          Stop and clear
        </button>
      </div>

      {busy ? <p role="status">{busy}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Camera preview"
        style={{ width: "100%", maxWidth: 480, background: "#000", display: cameraOn ? "block" : "none" }}
      />

      <ol>
        <li aria-current={step === "id" ? "step" : undefined}>
          <h2>Step 1: Show ID card</h2>
          <p>Hold the card flat, close to the camera, with the photo in focus.</p>
          <button type="button" onClick={() => void takeIdCard()} disabled={step !== "id" || busy !== null}>
            Capture ID card
          </button>
        </li>
        <li aria-current={step === "selfie" ? "step" : undefined}>
          <h2>Step 2: Take selfie</h2>
          <p>Only you in view, facing the camera, with light in front of you.</p>
          <button type="button" onClick={() => void takeSelfie()} disabled={step !== "selfie" || busy !== null}>
            Take selfie
          </button>
        </li>
      </ol>

      {idShown ? (
        <section aria-labelledby="id-result">
          <h2 id="id-result">ID card result</h2>
          <p>
            Result: <strong>{idShown.check.result}</strong>
            {"distance" in idShown.check ? ` (distance ${idShown.check.distance.toFixed(3)}, ID threshold ${CONFIG.idDistanceThreshold})` : ""}
          </p>
          <p>{idShown.outcome.message}</p>
          {idShown.outcome.flag ? <p>Would raise flag: id_mismatch (once).</p> : null}
          {idShown.outcome.needsManualReview ? <p>Not a mismatch. A proctor can resolve this by hand.</p> : null}
          {idShown.outcome.canRetry && idShown.check.result === "id_no_face" ? (
            <button type="button" onClick={() => void takeIdCard()} disabled={busy !== null}>
              Retake ID card
            </button>
          ) : null}
        </section>
      ) : null}

      {step === "live" ? (
        <section aria-labelledby="live-check">
          <h2 id="live-check">Step 3: Live same-person check</h2>
          <div className="row-actions">
            <button type="button" onClick={startLive} disabled={running}>
              Start live check
            </button>
            <button type="button" className="button-quiet" onClick={stopLive} disabled={!running}>
              Pause
            </button>
            <button type="button" className="button-quiet" onClick={() => void prepareJpegs()}>
              Prepare JPEG copies
            </button>
          </div>
          {jpegSizes ? (
            <p>
              JPEG copies ready, not uploaded: ID card {kb(jpegSizes.idCard)}, selfie {kb(jpegSizes.selfie)}.
            </p>
          ) : null}
          <dl aria-live="polite">
            <dt>State</dt>
            <dd>{live ? live.sample.state : running ? "waiting for first sample" : "not running"}</dd>
            <dt>Distance</dt>
            <dd>
              {live?.sample.distance !== undefined ? live.sample.distance.toFixed(3) : "—"} (threshold{" "}
              {CONFIG.distanceThreshold})
            </dd>
            <dt>Mismatches in a row</dt>
            <dd>
              {live ? live.identity.streak : 0} of {CONFIG.mismatchSamples}, held {CONFIG.mismatchHoldMs / 1000} s
            </dd>
            <dt>Would raise face_mismatch</dt>
            <dd>{live?.wouldRaise ? "Yes, on the next mismatch" : "No"}</dd>
          </dl>
        </section>
      ) : null}

      <h2>Flags (this page only)</h2>
      {flags.length === 0 ? (
        <p>No flags yet.</p>
      ) : (
        <ul>
          {flags.map((f) => (
            <li key={`${f.type}-${f.at}`}>
              {timeIst(f.at)} IST — {f.type}
              {f.detail.distance !== undefined ? `, distance ${f.detail.distance}` : ""}, samples {f.detail.samples}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
