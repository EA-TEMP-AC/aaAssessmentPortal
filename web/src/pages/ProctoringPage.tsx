import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../api/client";
import type { EvidenceRow } from "../api/evidence";
import {
  DECISION_LABELS,
  FLAG_TYPE_LABELS,
  getFlagCapture,
  getProctoringSession,
  listSessionSnapshots,
  listProctoringSessions,
  reviewProctoringFlag,
  SESSION_STATUSES,
  unlockProctoringSession,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUS_LABELS,
  type Decision,
  type Flag,
  type FlagCounts,
  type SessionDetail,
  type SessionItem,
  type Severity,
} from "../api/proctoring";
import { useSession } from "../api/session";
import { isRole, ROLE_LABELS } from "../routing/access";
import { EvidenceImage } from "./proctoring/EvidenceImage";
import { FlagCaptureDetails } from "./proctoring/FlagCaptureDetails";
import { formatTime } from "./proctoring/format";
import { SnapshotStrip } from "./proctoring/SnapshotStrip";

/** The list and the open session refresh this often (task P-01). */
export const PROCTORING_REFRESH_MS = 10_000;

type Filters = { batchId: string; status: string; minSeverity: string };
const EMPTY: Filters = { batchId: "", status: "", minSeverity: "" };
const COLUMNS = ["Candidate", "Batch", "Status", "Last seen", "Flags", "To review", "Details"] as const;

function typeLabel(type: string): string {
  return FLAG_TYPE_LABELS[type] ?? type;
}

function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}

function candidateLabel(item: SessionItem): string {
  return item.candidateName ?? `Candidate ${item.candidateId}`;
}

/** Severity is always written out, so colour is never the only signal. */
function SeverityTag({ severity }: { severity: Severity }) {
  return <span className={`severity-tag severity-${severity}`}>{SEVERITY_LABELS[severity]}</span>;
}

function StatusTag({ item }: { item: SessionItem }) {
  return (
    <>
      <span className={`session-status session-${item.status}`}>{STATUS_LABELS[item.status]}</span>
      {item.paused ? <span className="session-flagged"> Exam paused</span> : null}
      {item.invalidationRecommended ? <span className="session-flagged"> Invalidation recommended</span> : null}
    </>
  );
}

function countsText(counts: FlagCounts): string {
  return SEVERITIES.map((s) => `${SEVERITY_LABELS[s]} ${counts[s]}`).join(", ");
}

function ReviewControls({
  flag,
  canRecommend,
  onDone,
}: {
  flag: Flag;
  canRecommend: boolean;
  onDone: (decision: Decision) => void;
}) {
  const [mode, setMode] = useState<"idle" | "warn" | "confirm">("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLTextAreaElement | HTMLButtonElement | null>(null);

  useEffect(() => {
    if (mode !== "idle") focusRef.current?.focus();
  }, [mode]);

  async function decide(decision: Decision) {
    setBusy(true);
    setError(null);
    try {
      await reviewProctoringFlag(flag.id, decision, decision === "warn" ? message : undefined);
      setMode("idle");
      onDone(decision);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = `${typeLabel(flag.type)} at ${formatTime(flag.capturedAt)}`;
  const messageId = `warn-${flag.id}`;
  return (
    <div className="proctor-review">
      {mode === "idle" ? (
        <div className="row-actions" role="group" aria-label={`Review ${label}`}>
          <button type="button" onClick={() => decide("dismiss")} disabled={busy}>
            Dismiss
          </button>
          <button type="button" onClick={() => setMode("warn")} disabled={busy}>
            Warn
          </button>
          {canRecommend ? (
            <button type="button" className="button-danger" onClick={() => setMode("confirm")} disabled={busy}>
              Recommend invalidation
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "warn" ? (
        <form
          className="proctor-warn"
          onSubmit={(event) => {
            event.preventDefault();
            void decide("warn");
          }}
        >
          <div className="field">
            <label htmlFor={messageId}>Warning message for the candidate</label>
            <textarea
              id={messageId}
              ref={(el) => {
                focusRef.current = el;
              }}
              value={message}
              maxLength={300}
              rows={2}
              aria-describedby={`${messageId}-hint`}
              onChange={(event) => setMessage(event.target.value)}
            />
            <p id={`${messageId}-hint`} className="field-hint">
              Short and polite, up to 300 characters. Leave it empty to send the standard message.
            </p>
          </div>
          <div className="row-actions">
            <button type="submit" disabled={busy} aria-busy={busy}>
              Send warning
            </button>
            <button type="button" className="button-quiet" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mode === "confirm" ? (
        <div className="proctor-confirm" role="group" aria-labelledby={`confirm-${flag.id}`}>
          <p id={`confirm-${flag.id}`}>
            Recommend invalidation for this session? This only marks the session for a decision. It does not change the
            attempt or the result.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="button-danger"
              ref={(el) => {
                focusRef.current = el;
              }}
              onClick={() => decide("invalidate_recommended")}
              disabled={busy}
              aria-busy={busy}
            >
              Confirm recommendation
            </button>
            <button type="button" className="button-quiet" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FlagEntry({
  flag,
  evidence,
  detailsState,
  canReview,
  canRecommend,
  onDecided,
}: {
  flag: Flag;
  evidence: EvidenceRow | undefined;
  detailsState: "loading" | "error" | "ready";
  canReview: boolean;
  canRecommend: boolean;
  onDecided: (flag: Flag, decision: Decision) => void;
}) {
  const detail = flag.detail;
  const detailParts = detail
    ? [
        detail.label ? `label ${detail.label}` : null,
        detail.count !== undefined ? `count ${detail.count}` : null,
        detail.confidence !== undefined ? `confidence ${Math.round(detail.confidence * 100)}%` : null,
      ].filter(Boolean)
    : [];
  return (
    <li className={`proctor-flag proctor-flag-${flag.severity}`}>
      <p className="proctor-flag-head">
        <time dateTime={flag.capturedAt}>{formatTime(flag.capturedAt)}</time>
        {" · "}
        <strong>{typeLabel(flag.type)}</strong>
        {" · "}
        <span>
          Severity: <SeverityTag severity={flag.severity} />
        </span>
      </p>
      {flag.sustainedSeconds !== null ? (
        <p className="field-hint">Raised after the condition lasted at least {flag.sustainedSeconds} seconds.</p>
      ) : null}
      {detailParts.length > 0 ? <p className="field-hint">Sent by the browser: {detailParts.join(", ")}</p> : null}
      <div className="proctor-flag-capture">
        {flag.evidenceId ? (
          <EvidenceImage
            evidenceId={flag.evidenceId}
            description={`${typeLabel(flag.type)} at ${formatTime(flag.capturedAt)}`}
            row={evidence}
            detailsState={detailsState}
            showMeta
          />
        ) : (
          <p className="field-hint">No image for this flag</p>
        )}
        <FlagCaptureDetails flagId={flag.id} load={getFlagCapture} />
      </div>
      {flag.review ? (
        <p className="proctor-decision">
          Decision: {DECISION_LABELS[flag.review.decision]} by {roleLabel(flag.review.decidedByRole)}
          {flag.review.decidedAt ? `, ${formatTime(flag.review.decidedAt)}` : ""}
          {flag.review.note ? `. Note: ${flag.review.note}` : ""}
        </p>
      ) : canReview ? (
        <ReviewControls flag={flag} canRecommend={canRecommend} onDone={(d) => onDecided(flag, d)} />
      ) : (
        <p className="field-hint">Not reviewed yet.</p>
      )}
    </li>
  );
}

/** B-20. Shows whether the flag policy has paused the exam, and lets aa_admin or the proctor unlock it. */
function LockSection({
  sessionId,
  lock,
  canUnlock,
  onUnlocked,
}: {
  sessionId: string;
  lock: NonNullable<SessionDetail["lock"]>;
  canUnlock: boolean;
  onUnlocked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policyText =
    lock.policy.action === "pause"
      ? `Pause after ${lock.policy.pauseAfterFlags} ${lock.policy.countSeverities.join(" and ")} flags`
      : "Record only: flags never pause the exam";

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      await unlockProctoringSession(sessionId);
      onUnlocked();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`lock-heading-${sessionId}`}>
      <h3 id={`lock-heading-${sessionId}`}>Exam lock</h3>
      <p role="status">
        {lock.paused
          ? `The exam is paused${lock.pausedAt ? ` since ${formatTime(lock.pausedAt)}` : ""}. The candidate sees: Your test is paused. Please contact your proctor.`
          : "The exam is not paused."}
      </p>
      <p className="field-hint">
        {policyText}. Counted flags now: {lock.countedFlags}. The clock keeps running while paused, and unlocking
        starts the count again from zero.
      </p>
      {lock.paused && canUnlock ? (
        <button type="button" onClick={() => void unlock()} disabled={busy}>
          {busy ? "Unlocking…" : "Unlock exam"}
        </button>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SessionPanel({
  id,
  canReview,
  canRecommend,
  onClose,
}: {
  id: string;
  canReview: boolean;
  canRecommend: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const detail = useQuery({
    queryKey: ["proctoring-session", id],
    queryFn: ({ signal }) => getProctoringSession(id, signal),
    refetchInterval: PROCTORING_REFRESH_MS,
  });

  const snapshots = useQuery({
    queryKey: ["proctoring-snapshots", id],
    queryFn: ({ signal }) => listSessionSnapshots(id, signal),
    refetchInterval: PROCTORING_REFRESH_MS,
  });
  const snapshotState = snapshots.isError ? "error" : snapshots.isPending ? "loading" : "ready";
  const snapshotRows = snapshots.data ?? [];
  const byId = new Map(snapshotRows.map((row) => [row.id, row]));

  useEffect(() => {
    panelRef.current?.focus();
  }, [id]);

  function decided(flag: Flag, decision: Decision) {
    setNotice(`Decision saved for ${typeLabel(flag.type).toLowerCase()}: ${DECISION_LABELS[decision]}.`);
    void queryClient.invalidateQueries({ queryKey: ["proctoring-session", id] });
    void queryClient.invalidateQueries({ queryKey: ["proctoring-sessions"] });
  }

  const data = detail.data;
  function unlocked() {
    setNotice("The exam was unlocked. The candidate can carry on.");
    void queryClient.invalidateQueries({ queryKey: ["proctoring-session", id] });
    void queryClient.invalidateQueries({ queryKey: ["proctoring-sessions"] });
  }
  const headingId = `proctoring-session-${id}`;
  return (
    <div
      ref={panelRef}
      role="region"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="evidence-detail"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
    >
      <h2 id={headingId}>{data ? `Session of ${candidateLabel(data)}` : "Session"}</h2>
      <button type="button" className="button-quiet" onClick={onClose}>
        Close session
      </button>
      <p role="status" className="proctor-notice">
        {notice}
      </p>

      {detail.isPending ? <p role="status">Loading session…</p> : null}
      {detail.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(detail.error)}</p>
          <button type="button" onClick={() => void detail.refetch()}>
            Try again
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          <dl className="snapshot-list">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusTag item={data} />
              </dd>
            </div>
            <div>
              <dt>Batch</dt>
              <dd>{data.batchLabel ?? data.batchId}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatTime(data.startedAt)}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{formatTime(data.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Flags</dt>
              <dd>{countsText(data.flagCounts)}</dd>
            </div>
            <div>
              <dt>Warnings sent</dt>
              <dd>{data.warnings.length}</dd>
            </div>
          </dl>
          {data.lock ? (
            <LockSection sessionId={id} lock={data.lock} canUnlock={canReview} onUnlocked={unlocked} />
          ) : null}
          <p className="field-hint">
            Flags only record what the browser saw. Nothing is decided automatically; each flag waits for a person.
          </p>

          <h3>Flag timeline</h3>
          {data.flags.length === 0 ? (
            <p>No flags in this session.</p>
          ) : (
            <ol className="proctor-timeline" aria-label="Flag timeline">
              {data.flags.map((flag) => (
                <FlagEntry
                  key={flag.id}
                  flag={flag}
                  evidence={flag.evidenceId ? byId.get(flag.evidenceId) : undefined}
                  detailsState={snapshotState}
                  canReview={canReview}
                  canRecommend={canRecommend}
                  onDecided={decided}
                />
              ))}
            </ol>
          )}

          <SnapshotStrip
            rows={snapshotRows.filter((row) => !data.flags.some((f) => f.evidenceId === row.id))}
            state={snapshotState}
            error={snapshots.error}
            onRetry={() => void snapshots.refetch()}
          />

          {data.warnings.length > 0 ? (
            <>
              <h3>Warnings sent to the candidate</h3>
              <ul>
                {data.warnings.map((w) => (
                  <li key={w.id}>
                    <time dateTime={w.createdAt}>{formatTime(w.createdAt)}</time>: {w.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ProctoringPage() {
  const session = useSession();
  const role = session?.user.role;
  const canReview = role === "aa_admin" || role === "proctor";
  const canRecommend = role === "aa_admin";
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const list = useQuery({
    queryKey: ["proctoring-sessions", applied],
    queryFn: ({ signal }) => listProctoringSessions(applied, signal),
    placeholderData: keepPreviousData,
    refetchInterval: PROCTORING_REFRESH_MS,
  });

  const result = list.isError ? undefined : list.data;
  const active = Object.values(applied).some(Boolean);

  function closePanel() {
    setSelectedId(null);
    openerRef.current?.focus();
  }

  return (
    <div className="audit-page">
      <h1>Proctoring</h1>
      <p>
        Proctored online attempts and the flags raised during them. The list refreshes every 10 seconds.
        {canReview ? " Review each flag: dismiss it, warn the candidate" : ""}
        {canReview && canRecommend ? ", or recommend invalidation." : canReview ? "." : ""}
        {canReview ? "" : " Your access is read only."}
      </p>

      <form
        role="search"
        aria-label="Filter proctoring sessions"
        onSubmit={(event) => {
          event.preventDefault();
          const next = { ...draft, batchId: draft.batchId.trim() };
          setDraft(next);
          setApplied(next);
          setSelectedId(null);
        }}
      >
        <div className="audit-filters">
          <div className="field">
            <label htmlFor="pr-batch">Batch ID</label>
            <input
              id="pr-batch"
              value={draft.batchId}
              onChange={(event) => setDraft({ ...draft, batchId: event.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="pr-status">Status</label>
            <select
              id="pr-status"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
            >
              <option value="">Any status</option>
              {SESSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pr-severity">Lowest severity</label>
            <select
              id="pr-severity"
              value={draft.minSeverity}
              onChange={(event) => setDraft({ ...draft, minSeverity: event.target.value })}
            >
              <option value="">Any, including no flags</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                  {s === "high" ? " only" : " or higher"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="audit-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="button-quiet"
            disabled={!active}
            onClick={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
              setSelectedId(null);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>

      {list.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(list.error)}</p>
          <button type="button" onClick={() => void list.refetch()}>
            Try again
          </button>
        </div>
      ) : null}

      <p className="audit-summary" role="status">
        {list.isPending
          ? "Loading sessions…"
          : result
            ? `${result.total} ${result.total === 1 ? "session" : "sessions"}${active ? " match the filters" : ""}.`
            : ""}
      </p>

      {result && result.items.length === 0 ? (
        <p>{active ? "No sessions match these filters." : "No proctoring sessions yet."}</p>
      ) : null}

      {result && result.items.length > 0 ? (
        <div className="table-scroll">
          <table className="audit-table" aria-busy={list.isFetching}>
            <caption className="visually-hidden">Proctoring sessions</caption>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td>{candidateLabel(item)}</td>
                  <td>{item.batchLabel ?? item.batchId}</td>
                  <td>
                    <StatusTag item={item} />
                  </td>
                  <td>{formatTime(item.lastSeenAt)}</td>
                  <td>{countsText(item.flagCounts)}</td>
                  <td>{item.unreviewedCount}</td>
                  <td>
                    <button
                      type="button"
                      className="button-quiet"
                      aria-label={`Open session of ${candidateLabel(item)}`}
                      onClick={(event) => {
                        openerRef.current = event.currentTarget;
                        setSelectedId(item.id);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selectedId ? (
        <SessionPanel
          key={selectedId}
          id={selectedId}
          canReview={canReview}
          canRecommend={canRecommend}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}
