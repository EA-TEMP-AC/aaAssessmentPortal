import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../../api/client";
import { SEVERITY_LABELS, type FlagCapture } from "../../api/proctoring";
import { CLOCK_GAP_WARNING_SECONDS, clockGapSeconds, formatTime } from "./format";

function locationText(capture: FlagCapture): string {
  if (!capture.locationVisible) {
    return capture.locationStatus === "captured"
      ? "Saved, but your role cannot see the coordinates"
      : "Location not shared";
  }
  if (!capture.location) return "Location not shared";
  const { latitude, longitude, accuracy } = capture.location;
  const spread = accuracy === null ? "accuracy not known" : `accuracy ${Math.round(accuracy)} m`;
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)} (${spread})`;
}

/**
 * What the server saved about one flag photo (X-07), shown beside the picture. The words and
 * times drawn on the photo come from the candidate's browser and could be changed; these come
 * from the server. The browser time and the server time are side by side so a gap is visible.
 */
export function FlagCaptureDetails({
  flagId,
  load,
}: {
  flagId: string;
  load: (flagId: string, signal?: AbortSignal) => Promise<FlagCapture>;
}) {
  const query = useQuery({
    queryKey: ["proctoring-flag-capture", flagId],
    queryFn: ({ signal }) => load(flagId, signal),
    staleTime: 60_000,
  });

  if (query.isPending) {
    return (
      <p role="status" className="field-hint">
        Loading saved details…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div className="form-error" role="alert">
        <p>The saved details for this photo could not be loaded. {errorMessage(query.error)}</p>
        <button type="button" className="button-quiet" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  const capture = query.data;
  const gap = clockGapSeconds(capture);
  return (
    <div className="proctor-capture-meta">
      <dl className="snapshot-list">
        <div>
          <dt>Saved by the server</dt>
          <dd>{capture.reason}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{SEVERITY_LABELS[capture.severity]}</dd>
        </div>
        <div>
          <dt>Server time</dt>
          <dd>
            <time dateTime={capture.receivedAt}>{formatTime(capture.receivedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Browser time (drawn on the photo)</dt>
          <dd>
            <time dateTime={capture.capturedAt}>{formatTime(capture.capturedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{locationText(capture)}</dd>
        </div>
      </dl>
      {gap > CLOCK_GAP_WARNING_SECONDS ? (
        <p role="alert" className="form-error">
          The browser time and the server time are {Math.round(gap / 60)} minutes apart. Check the clock on the
          candidate&apos;s device before relying on the time drawn on the photo.
        </p>
      ) : null}
    </div>
  );
}
