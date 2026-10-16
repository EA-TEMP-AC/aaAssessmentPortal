import { useEffect, useRef, useState } from "react";
import { DEMO_CONFIG, PROCTOR_THRESHOLDS } from "../proctoring/config";
import { createEngine } from "../proctoring/engine";
import type { Detection, FlagBody, ProctorEngine, ProctorStatus, ProctorTransport } from "../proctoring/types";

/**
 * Dev-only page (aa_admin) to show the proctoring engine on its own. Nothing is sent to the
 * server: flags and snapshots stay on this page and are gone when it closes.
 */

type ShownFlag = FlagBody & { shownAt: string };
type Stats = { brightness: number | null; identical: boolean | null };

const MAX_SHOWN_FLAGS = 30;

function localTransport(onFlag: (body: FlagBody) => void, onSnapshot: () => void): ProctorTransport {
  let n = 0;
  return {
    async sendFlag(_sessionId, body) {
      onFlag(body);
    },
    async uploadSnapshot() {
      n += 1;
      onSnapshot();
      return `local-snapshot-${n}`;
    },
    dispose() {},
  };
}

function timeIst(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

export function ProctoringDemoPage() {
  const [status, setStatus] = useState<ProctorStatus>({ state: "stopped" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [stats, setStats] = useState<Stats>({ brightness: null, identical: null });
  const [flags, setFlags] = useState<ShownFlag[]>([]);
  const [snapshots, setSnapshots] = useState(0);
  const [ticks, setTicks] = useState({ count: 0, totalMs: 0 });
  const engineRef = useRef<ProctorEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  function release() {
    engineRef.current?.stop();
    engineRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  useEffect(() => release, []);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open a camera here. Use a current browser over https or localhost.");
      return;
    }
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(() => {});
      }
      setFlags([]);
      setSnapshots(0);
      setTicks({ count: 0, totalMs: 0 });
      const transport = localTransport(
        (body) =>
          setFlags((list) => [{ ...body, shownAt: new Date().toISOString() }, ...list].slice(0, MAX_SHOWN_FLAGS)),
        () => setSnapshots((n) => n + 1),
      );
      const engine = createEngine({
        transport,
        onTick: (ms) => setTicks((t) => ({ count: t.count + 1, totalMs: t.totalMs + ms })),
        onDetections: (d, s) => {
          setDetections(d);
          setStats(s);
        },
      });
      engineRef.current = engine;
      await engine.start({
        stream,
        sessionId: "demo-session",
        attemptId: "demo",
        batchId: "demo-batch",
        config: DEMO_CONFIG,
        onStatus: setStatus,
      });
    } catch (err) {
      release();
      setStatus({ state: "stopped" });
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission was refused. Allow the camera in the browser and try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : "The camera could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    release();
    setStatus({ state: "stopped" });
    setDetections(null);
    setStats({ brightness: null, identical: null });
  }

  const running = status.state !== "stopped";

  return (
    <>
      <h1>Proctoring engine demo</h1>
      <p>
        Development only. Opens your camera and runs the in-browser checks with a local config. Nothing is
        sent to the server and no video is recorded.
      </p>

      <div className="row-actions">
        <button type="button" onClick={() => void start()} disabled={running || busy}>
          {busy ? "Opening camera…" : "Start camera"}
        </button>
        <button type="button" className="button-quiet" onClick={stop} disabled={!running}>
          Stop
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <p role="status">
        Engine: <strong>{status.state}</strong>
        {status.message ? ` — ${status.message}` : ""}
      </p>

      <video
        ref={previewRef}
        muted
        playsInline
        aria-label="Camera preview"
        style={{ width: "100%", maxWidth: 480, background: "#000", display: running ? "block" : "none" }}
      />

      <h2>Live checks</h2>
      {!running ? (
        <p>Start the camera to see live detections.</p>
      ) : (
        <dl className="snapshot-list">
          <dt>Brightness</dt>
          <dd>{stats.brightness === null ? "not read" : Math.round(stats.brightness)}</dd>
          <dt>Frame unchanged</dt>
          <dd>{stats.identical === null ? "not known" : stats.identical ? "yes" : "no"}</dd>
          <dt>Model sees</dt>
          <dd>
            {detections === null
              ? "model not loaded"
              : detections.length === 0
                ? "nothing"
                : detections.map((d) => `${d.label} ${Math.round(d.confidence * 100)}%`).join(", ")}
          </dd>
          <dt>Average time per check</dt>
          <dd>
            {ticks.count === 0
              ? "no checks yet"
              : `${(ticks.totalMs / ticks.count).toFixed(1)} ms over ${ticks.count} ${ticks.count === 1 ? "check" : "checks"}`}
          </dd>
          <dt>Snapshots taken</dt>
          <dd>{snapshots}</dd>
        </dl>
      )}

      <h2>Raised flags</h2>
      <div aria-live="polite">
        {flags.length === 0 ? (
          <p>No flags yet.</p>
        ) : (
          <ul>
            {flags.map((f) => (
              <li key={f.clientEventId}>
                {timeIst(f.capturedAt)} IST — <strong>{f.type}</strong>
                {f.detail ? ` (${f.detail.label}, count ${f.detail.count})` : ""}
                {f.evidenceId ? " with snapshot" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="field-hint">
        Config: faces every {Math.min(DEMO_CONFIG.detectionIntervalMs, PROCTOR_THRESHOLDS.faceDetectionIntervalMs)} ms, objects every {PROCTOR_THRESHOLDS.objectDetectionIntervalMs / 1000} s, snapshot every{" "}
        {DEMO_CONFIG.snapshotIntervalSeconds} s, cooldown {DEMO_CONFIG.flagCooldownSeconds} s per flag type.
      </p>
    </>
  );
}
