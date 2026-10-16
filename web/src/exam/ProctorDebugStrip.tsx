import { useSyncExternalStore } from "react";
import { proctorDebug } from "../proctoring/debug";
import type { ProctorStatus } from "./proctorBridge";

/** X-06: what the proctoring engine is doing, for whoever sets up or tests the exam. */
export function ProctorDebugStrip({ status }: { status: ProctorStatus }) {
  const d = useSyncExternalStore(proctorDebug.subscribe, proctorDebug.get);
  return (
    <aside className="field-hint exam-proctor-debug" aria-label="Proctoring debug (development only)">
      <strong>Proctoring debug.</strong> Engine: {status.state}
      {status.message ? ` (${status.message})` : ""}. Last tick: {d.lastTickMs === null ? "none yet" : `${d.lastTickMs} ms`}.
      Flags sent: {d.flagsSent} (failed {d.flagsFailed}). Snapshots uploaded: {d.snapshotsUploaded} (failed{" "}
      {d.snapshotsFailed}). Last error: {d.lastError ?? "none"}.
    </aside>
  );
}
