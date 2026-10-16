import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import { fetchEvidenceFile, type EvidenceRow } from "../../api/evidence";
import { Dialog } from "../masterData/dialog";
import { formatKb, formatTime, kindLabel } from "./format";

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; src: string };

/**
 * Loads one snapshot through GET /evidence/:id/file, which checks the role and writes the access
 * log. The picture is held as a blob address in memory and released when the component goes.
 */
function useEvidenceImage(evidenceId: string): { image: Loaded; retry: () => void } {
  const [image, setImage] = useState<Loaded>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let blobUrl: string | null = null;
    setImage({ state: "loading" });
    fetchEvidenceFile({ id: evidenceId, contentType: "image/jpeg" })
      .then((file) => {
        if (!live) return;
        if (file.mode === "link") {
          setImage({ state: "ready", src: file.url });
        } else {
          blobUrl = URL.createObjectURL(file.blob);
          setImage({ state: "ready", src: blobUrl });
        }
      })
      .catch((err: unknown) => {
        if (live) setImage({ state: "error", message: errorMessage(err) });
      });
    return () => {
      live = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [evidenceId, attempt]);

  return { image, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

export type Dimensions = { width: number; height: number };
export type DetailsState = "loading" | "error" | "ready";

/** Captured time, size, resolution and kind. The picture's own numbers, nothing personal. */
export function SnapshotMeta({
  row,
  detailsState,
  dimensions,
}: {
  row: EvidenceRow | undefined;
  detailsState: DetailsState;
  dimensions: Dimensions | null;
}) {
  if (!row) {
    return (
      <p className="field-hint">
        {detailsState === "loading" ? "Loading photo details…" : "Photo details are not available."}
      </p>
    );
  }
  return (
    <dl className="snapshot-list proctor-photo-meta">
      <div>
        <dt>Captured</dt>
        <dd>{formatTime(row.capturedAt)}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>{formatKb(row.size)}</dd>
      </div>
      <div>
        <dt>Resolution</dt>
        <dd>{dimensions ? `${dimensions.width} × ${dimensions.height} px` : "Not known yet"}</dd>
      </div>
      <div>
        <dt>Kind</dt>
        <dd>{kindLabel(row.kind)}</dd>
      </div>
    </dl>
  );
}

/**
 * A thumbnail that opens a larger view in a dialog. `description` says what the photo is for
 * ("Phone detected at 20 Nov, 10:30:00 IST") and becomes the dialog title and the alt text.
 */
export function EvidenceImage({
  evidenceId,
  description,
  row,
  detailsState,
  showMeta,
}: {
  evidenceId: string;
  description: string;
  row: EvidenceRow | undefined;
  detailsState: DetailsState;
  /** Show the metadata next to the thumbnail (flags). The strip shows a short caption instead. */
  showMeta: boolean;
}) {
  const { image, retry } = useEvidenceImage(evidenceId);
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    openerRef.current?.focus();
  }

  const failed = image.state === "error" || imageFailed;
  const failMessage = image.state === "error" ? image.message : "The photo could not be shown.";
  const meta = <SnapshotMeta row={row} detailsState={detailsState} dimensions={dimensions} />;

  return (
    <div className={showMeta ? "proctor-photo" : "proctor-photo proctor-photo-compact"}>
      <div className="proctor-photo-view">
        {image.state === "loading" ? (
          <p role="status" className="field-hint">
            Loading photo…
          </p>
        ) : null}
        {failed ? (
          <div className="form-error" role="alert">
            <p>{failMessage}</p>
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                setImageFailed(false);
                retry();
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
        {image.state === "ready" && !imageFailed ? (
          <button
            type="button"
            ref={openerRef}
            className="proctor-thumb"
            aria-label={`Enlarge photo: ${description}`}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <img
              src={image.src}
              alt=""
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0) setDimensions({ width: naturalWidth, height: naturalHeight });
              }}
              onError={() => setImageFailed(true)}
            />
          </button>
        ) : null}
      </div>
      {showMeta ? (
        meta
      ) : row ? (
        <p className="field-hint">
          <time dateTime={row.capturedAt}>{formatTime(row.capturedAt)}</time>, {formatKb(row.size)}
        </p>
      ) : null}

      {open && image.state === "ready" ? (
        <Dialog title={description} wide onCancel={close}>
          <img
            className="proctor-photo-large"
            src={image.src}
            alt={`Camera photo: ${description}`}
            referrerPolicy="no-referrer"
          />
          {meta}
          <div className="row-actions">
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
