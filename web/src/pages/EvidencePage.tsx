import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { localDayBound } from "../api/audit";
import { errorMessage } from "../api/client";
import {
  EVIDENCE_KINDS,
  fetchEvidenceFile,
  KIND_LABELS,
  listEvidence,
  verifyEvidence,
  type EvidenceRow,
  type Verification,
} from "../api/evidence";
import { useSession } from "../api/session";
import { isRole, ROLE_LABELS } from "../routing/access";

type Filters = {
  batchId: string;
  candidateId: string;
  kind: string;
  uploaderId: string;
  from: string;
  to: string;
  hasLocation: "" | "true" | "false";
};

const EMPTY: Filters = { batchId: "", candidateId: "", kind: "", uploaderId: "", from: "", to: "", hasLocation: "" };
const COLUMNS = ["Kind", "Uploader", "Captured", "Uploaded", "Size", "Checksum", "Location", "Details"] as const;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const text = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${text} IST`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function kindLabel(kind: string): string {
  return (KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

function uploaderLabel(row: EvidenceRow): string {
  const role = isRole(row.uploaderRole) ? ROLE_LABELS[row.uploaderRole] : row.uploaderRole || "Unknown role";
  return `${role} (${row.uploaderId})`;
}

function locationLabel(row: EvidenceRow): string {
  if (row.locationStatus === "captured") return "Captured";
  if (row.locationStatus === "unavailable") return "Unavailable";
  return "Not provided";
}

function locationSummary(row: EvidenceRow): string {
  if (row.locationStatus === "captured" && row.latitude !== null && row.longitude !== null) {
    const accuracy = row.accuracy !== null ? `, accuracy about ${row.accuracy} metres` : ", accuracy not recorded";
    return `Latitude ${row.latitude}, longitude ${row.longitude}${accuracy}.`;
  }
  if (row.locationStatus === "unavailable") {
    return `The device could not give a location. Reason: ${row.locationUnavailableReason ?? "not recorded"}.`;
  }
  return "No location was sent with this file.";
}

function rangeError(filters: Filters): string | null {
  if (filters.from && !localDayBound(filters.from, "start")) return "Enter a valid From date.";
  if (filters.to && !localDayBound(filters.to, "end")) return "Enter a valid To date.";
  if (filters.from && filters.to && filters.from > filters.to) return "The From date must be on or before the To date.";
  return null;
}

function VerificationResult({ verification }: { verification: Verification }) {
  const when = formatTime(verification.at);
  if (verification.result === "ok") {
    return (
      <p role="status" className="evidence-verify evidence-verify-ok">
        <strong>Verified: OK.</strong> The stored file matches its recorded checksum and size. Checked {when}.
      </p>
    );
  }
  if (verification.result === "mismatch") {
    return (
      <div role="alert" className="evidence-verify evidence-verify-bad">
        <p>
          <strong>Mismatch.</strong> The stored file no longer matches its recorded checksum. Checked {when}.
        </p>
        <dl className="snapshot-list">
          <div>
            <dt>Recorded checksum</dt>
            <dd>{verification.expectedSha256 ?? "Not given"}</dd>
          </div>
          <div>
            <dt>Checksum now</dt>
            <dd>{verification.actualSha256 ?? "Not given"}</dd>
          </div>
          <div>
            <dt>Size now</dt>
            <dd>{verification.actualSize !== null ? formatSize(verification.actualSize) : "Not given"}</dd>
          </div>
        </dl>
      </div>
    );
  }
  return (
    <p role="alert" className="evidence-verify evidence-verify-bad">
      <strong>Missing.</strong> The stored file could not be found. Checked {when}.
    </p>
  );
}

type Preview = { type: "image" | "pdf"; src: string; blobUrl: boolean };

function EvidenceDetail({
  row,
  canVerify,
  verification,
  verifyCount,
  onVerified,
  onClose,
}: {
  row: EvidenceRow;
  canVerify: boolean;
  verification: Verification | null;
  verifyCount: number;
  onVerified: (id: string, verification: Verification, verifyCount: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<Preview | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | "verify" | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const previewable =
    row.contentType === "image/jpeg" || row.contentType === "image/png" || row.contentType === "application/pdf";

  function clearPreview() {
    if (previewRef.current?.blobUrl) URL.revokeObjectURL(previewRef.current.src);
    previewRef.current = null;
    setPreview(null);
  }

  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      if (previewRef.current?.blobUrl) URL.revokeObjectURL(previewRef.current.src);
      previewRef.current = null;
    };
  }, []);

  async function openPreview() {
    setBusy("preview");
    setFileError(null);
    setNotice("");
    try {
      const file = await fetchEvidenceFile(row);
      clearPreview();
      const type = row.contentType === "application/pdf" ? "pdf" : "image";
      const next: Preview =
        file.mode === "link"
          ? { type, src: file.url, blobUrl: false }
          : { type, src: URL.createObjectURL(file.blob), blobUrl: true };
      previewRef.current = next;
      setPreview(next);
    } catch (error) {
      setFileError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    setFileError(null);
    setNotice("");
    try {
      const file = await fetchEvidenceFile(row);
      const href = file.mode === "link" ? file.url : URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `evidence-${row.id}.${EXTENSIONS[row.contentType] ?? "bin"}`;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (file.mode === "bytes") setTimeout(() => URL.revokeObjectURL(href), 0);
      setNotice("Download started.");
    } catch (error) {
      setFileError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("verify");
    setVerifyError(null);
    try {
      const result = await verifyEvidence(row.id);
      onVerified(row.id, result.verification, result.verifyCount);
    } catch (error) {
      setVerifyError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const headingId = `evidence-detail-${row.id}`;
  return (
    <div
      ref={panelRef}
      id={`evidence-detail-panel-${row.id}`}
      role="region"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="evidence-detail"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <h2 id={headingId}>Evidence detail</h2>
      <dl className="snapshot-list">
        <div>
          <dt>Evidence id</dt>
          <dd>{row.id}</dd>
        </div>
        <div>
          <dt>Kind</dt>
          <dd>{kindLabel(row.kind)}</dd>
        </div>
        <div>
          <dt>File type</dt>
          <dd>{row.contentType}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatSize(row.size)}</dd>
        </div>
        <div>
          <dt>Batch</dt>
          <dd>{row.batchId}</dd>
        </div>
        <div>
          <dt>Candidate</dt>
          <dd>{row.candidateId ?? "None"}</dd>
        </div>
        <div>
          <dt>Uploader</dt>
          <dd>{uploaderLabel(row)}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd>{row.deviceId ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{formatTime(row.capturedAt)}</dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd>{formatTime(row.uploadedAt)}</dd>
        </div>
        <div>
          <dt>Checksum (SHA-256)</dt>
          <dd>{row.sha256}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            {locationLabel(row)}. {locationSummary(row)}
          </dd>
        </div>
      </dl>

      <div className="row-actions">
        {previewable ? (
          <button type="button" disabled={busy !== null} onClick={() => void openPreview()}>
            {busy === "preview" ? "Loading preview…" : "Preview"}
          </button>
        ) : null}
        <button type="button" disabled={busy !== null} onClick={() => void download()}>
          {busy === "download" ? "Preparing download…" : "Download"}
        </button>
        {canVerify ? (
          <button type="button" disabled={busy !== null} onClick={() => void verify()}>
            {busy === "verify" ? "Verifying…" : "Verify"}
          </button>
        ) : null}
        <button type="button" className="button-quiet" onClick={onClose}>
          Close detail
        </button>
      </div>
      {previewable ? null : <p className="field-hint">No preview for this file type. Download it to view it.</p>}
      <p className="field-hint">Each preview or download is recorded in the access log.</p>

      {notice ? <p role="status">{notice}</p> : null}
      {fileError ? (
        <p className="form-error" role="alert">
          {fileError}
        </p>
      ) : null}

      {preview ? (
        <div className="evidence-preview">
          {preview.type === "image" ? (
            <img
              src={preview.src}
              alt={`Preview of ${kindLabel(row.kind).toLowerCase()} evidence ${row.id}`}
              referrerPolicy="no-referrer"
              onError={() => {
                clearPreview();
                setFileError("The preview could not be shown. Ask for the file again.");
              }}
            />
          ) : (
            <object data={preview.src} type="application/pdf" aria-label={`PDF preview of evidence ${row.id}`}>
              <p>This browser cannot show the PDF here. Use Download instead.</p>
            </object>
          )}
          <button type="button" className="button-quiet" onClick={clearPreview}>
            Hide preview
          </button>
        </div>
      ) : null}

      <h3>Integrity check</h3>
      {verifyError ? (
        <p className="form-error" role="alert">
          {verifyError}
        </p>
      ) : null}
      {verification ? (
        <>
          <VerificationResult verification={verification} />
          <p className="field-hint">
            Checked {verifyCount} {verifyCount === 1 ? "time" : "times"} so far.
          </p>
        </>
      ) : (
        <p>Not checked yet.{canVerify ? "" : " Only an AA admin can run a check."}</p>
      )}
    </div>
  );
}

function ChecksumCell({ hash }: { hash: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <>
      <code title={hash}>{shortHash(hash)}</code>{" "}
      <button
        type="button"
        className="button-quiet"
        aria-label={`Copy checksum ${shortHash(hash)}`}
        onClick={() => void copy()}
      >
        Copy
      </button>
      <span role="status" className="visually-hidden">
        {state === "copied" ? "Checksum copied." : state === "failed" ? "Could not copy the checksum." : ""}
      </span>
    </>
  );
}

export function EvidencePage() {
  const session = useSession();
  const canVerify = session?.user.role === "aa_admin";
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, { verification: Verification; verifyCount: number }>>({});
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const list = useQuery({
    queryKey: ["evidence", applied, page],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listEvidence(
        {
          batchId: applied.batchId,
          candidateId: applied.candidateId,
          kind: applied.kind,
          uploaderId: applied.uploaderId,
          from: applied.from ? (localDayBound(applied.from, "start") ?? undefined) : undefined,
          to: applied.to ? (localDayBound(applied.to, "end") ?? undefined) : undefined,
          hasLocation: applied.hasLocation,
          page,
        },
        signal,
      ),
  });

  const result = list.isError ? undefined : list.data;
  const active = Object.values(applied).some(Boolean);
  const selected = result?.items.find((item) => item.id === selectedId) ?? null;
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const hasNext = result ? result.page * result.pageSize < result.total : false;

  function set(patch: Partial<Filters>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFilterError(null);
  }

  function closeDetail() {
    setSelectedId(null);
    openerRef.current?.focus();
  }

  function goToPage(next: (current: number) => number) {
    setPage(next);
    setSelectedId(null);
  }

  return (
    <div className="audit-page">
      <h1>Evidence</h1>
      <p>
        Photos, videos and documents uploaded for batches. This list includes only the files your account is allowed to
        read.
      </p>
      <form
        role="search"
        aria-label="Filter evidence"
        onSubmit={(event) => {
          event.preventDefault();
          const next: Filters = {
            ...draft,
            batchId: draft.batchId.trim(),
            candidateId: draft.candidateId.trim(),
            uploaderId: draft.uploaderId.trim(),
          };
          const error = rangeError(next);
          if (error) {
            setFilterError(error);
            return;
          }
          setDraft(next);
          setApplied(next);
          setPage(1);
          setSelectedId(null);
          setFilterError(null);
        }}
      >
        <div className="audit-filters">
          <div className="field">
            <label htmlFor="ev-batch">Batch id</label>
            <input
              id="ev-batch"
              type="text"
              value={draft.batchId}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ batchId: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ev-candidate">Candidate id</label>
            <input
              id="ev-candidate"
              type="text"
              value={draft.candidateId}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ candidateId: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ev-uploader">Uploader id</label>
            <input
              id="ev-uploader"
              type="text"
              value={draft.uploaderId}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ uploaderId: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ev-kind">Kind</label>
            <select id="ev-kind" value={draft.kind} onChange={(e) => set({ kind: e.target.value })}>
              <option value="">All kinds</option>
              {EVIDENCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ev-location">Has location</label>
            <select
              id="ev-location"
              value={draft.hasLocation}
              onChange={(e) => set({ hasLocation: e.target.value as Filters["hasLocation"] })}
            >
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ev-from">Captured from</label>
            <input
              id="ev-from"
              type="date"
              value={draft.from}
              aria-invalid={filterError ? true : undefined}
              aria-describedby={filterError ? "ev-filter-error" : undefined}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ev-to">Captured to</label>
            <input
              id="ev-to"
              type="date"
              value={draft.to}
              aria-invalid={filterError ? true : undefined}
              aria-describedby={filterError ? "ev-filter-error" : undefined}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
        </div>
        {filterError ? (
          <p id="ev-filter-error" className="form-error" role="alert">
            {filterError}
          </p>
        ) : null}
        <div className="audit-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
              setPage(1);
              setSelectedId(null);
              setFilterError(null);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>

      {list.isError && !list.isFetching ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(list.error)}</p>
          <button type="button" onClick={() => void list.refetch()}>
            Try again
          </button>
        </div>
      ) : null}

      <p className="audit-summary" role="status">
        {list.isFetching
          ? "Loading evidence."
          : result
            ? `Page ${result.page} of ${pages}. ${result.pageSize} per page. ${result.total} ${result.total === 1 ? "file" : "files"}.`
            : ""}
      </p>

      {result ? (
        <>
          <div className="table-scroll">
            <table className="audit-table" aria-busy={list.isFetching}>
              <caption className="visually-hidden">Evidence files</caption>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.items.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length}>
                      {active ? "No evidence matches these filters." : "No evidence has been uploaded yet."}
                    </td>
                  </tr>
                ) : (
                  result.items.map((item) => (
                    <tr key={item.id}>
                      <td>{kindLabel(item.kind)}</td>
                      <td>{uploaderLabel(item)}</td>
                      <td>
                        <time dateTime={item.capturedAt}>{formatTime(item.capturedAt)}</time>
                      </td>
                      <td>
                        <time dateTime={item.uploadedAt}>{formatTime(item.uploadedAt)}</time>
                      </td>
                      <td>{formatSize(item.size)}</td>
                      <td>
                        <ChecksumCell hash={item.sha256} />
                      </td>
                      <td>{locationLabel(item)}</td>
                      <td>
                        <button
                          type="button"
                          className="button-quiet"
                          aria-expanded={item.id === selectedId}
                          aria-controls={item.id === selectedId ? `evidence-detail-panel-${item.id}` : undefined}
                          aria-label={`Details for ${kindLabel(item.kind)} uploaded ${formatTime(item.uploadedAt)}`}
                          onClick={(event) => {
                            openerRef.current = event.currentTarget;
                            setSelectedId(item.id === selectedId ? null : item.id);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <nav className="audit-pager" aria-label="Evidence pages">
            <button type="button" onClick={() => goToPage((p) => Math.max(1, p - 1))} disabled={result.page <= 1 || list.isFetching}>
              Previous page
            </button>
            <button type="button" onClick={() => goToPage((p) => p + 1)} disabled={!hasNext || list.isFetching}>
              Next page
            </button>
          </nav>
        </>
      ) : null}

      {selected ? (
        <EvidenceDetail
          key={selected.id}
          row={selected}
          canVerify={canVerify}
          verification={checked[selected.id]?.verification ?? selected.verification}
          verifyCount={checked[selected.id]?.verifyCount ?? selected.verifyCount}
          onVerified={(id, verification, verifyCount) =>
            setChecked((current) => ({ ...current, [id]: { verification, verifyCount } }))
          }
          onClose={closeDetail}
        />
      ) : null}
    </div>
  );
}
