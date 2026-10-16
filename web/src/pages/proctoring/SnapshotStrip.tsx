import { useState } from "react";
import { errorMessage } from "../../api/client";
import type { EvidenceRow } from "../../api/evidence";
import { EvidenceImage } from "./EvidenceImage";
import { formatTime } from "./format";

export const STRIP_PAGE = 12;

/**
 * The session's snapshots that no flag points at, newest first. Photos load as they are shown, so
 * a long session does not fetch (and log) every photo at once.
 */
export function SnapshotStrip({
  rows,
  state,
  error,
  onRetry,
}: {
  rows: EvidenceRow[];
  state: "loading" | "error" | "ready";
  error: unknown;
  onRetry: () => void;
}) {
  const [shown, setShown] = useState(STRIP_PAGE);
  const visible = rows.slice(0, shown);
  return (
    <section aria-labelledby="proctor-snapshots-heading">
      <h3 id="proctor-snapshots-heading">Snapshots</h3>
      <p className="field-hint">Photos the browser took on a timer that have no flag. Newest first.</p>
      {state === "loading" ? <p role="status">Loading snapshots…</p> : null}
      {state === "error" ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(error)}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {state === "ready" && rows.length === 0 ? <p>No snapshots without a flag in this session.</p> : null}
      {visible.length > 0 ? (
        <ul className="proctor-strip" aria-label="Snapshots without a flag">
          {visible.map((row) => (
            <li key={row.id}>
              <EvidenceImage
                evidenceId={row.id}
                description={`Snapshot taken at ${formatTime(row.capturedAt)}`}
                row={row}
                detailsState="ready"
                showMeta={false}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length > shown ? (
        <button type="button" className="button-quiet" onClick={() => setShown((n) => n + STRIP_PAGE)}>
          Show {Math.min(STRIP_PAGE, rows.length - shown)} more ({rows.length - shown} not shown)
        </button>
      ) : null}
    </section>
  );
}
