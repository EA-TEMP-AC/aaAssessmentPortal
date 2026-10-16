import { useEffect, useRef } from "react";
import type { ProctorStatus } from "./proctorBridge";

type Props = {
  status: ProctorStatus;
  /** Set when no proctoring session could be created. */
  unavailable: string | null;
  stream: MediaStream | null;
};

type Chip = { label: "Camera on" | "Checking" | "Camera problem"; tone: "ok" | "wait" | "problem"; reason: string | null };

function chipFor(status: ProctorStatus, unavailable: string | null): Chip {
  // The page already explains an unavailable session in its own notice.
  if (unavailable) return { label: "Camera problem", tone: "problem", reason: null };
  if (status.state === "running") return { label: "Camera on", tone: "ok", reason: null };
  if (status.state === "starting") return { label: "Checking", tone: "wait", reason: null };
  return { label: "Camera problem", tone: "problem", reason: status.message ?? null };
}

/** Status chip and a small mirrored view of the candidate's own camera. Nothing is recorded here. */
export function ProctorStatusChip({ status, unavailable, stream }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const chip = chipFor(status, unavailable);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.srcObject = stream;
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <aside className="exam-corner" aria-label="Camera status">
      <p className={`exam-chip exam-chip-${chip.tone}`} role="status">
        <span aria-hidden="true">{chip.tone === "ok" ? "●" : chip.tone === "wait" ? "◌" : "▲"}</span> {chip.label}
        {chip.reason ? <span className="exam-chip-reason">{chip.reason}</span> : null}
      </p>
      {stream ? (
        <video
          ref={video}
          className="exam-self-view"
          width={160}
          height={120}
          muted
          playsInline
          autoPlay
          aria-label="Your camera, shown as a mirror"
        />
      ) : null}
    </aside>
  );
}
