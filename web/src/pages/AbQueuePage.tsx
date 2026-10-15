import { useEffect, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import {
  BATCH_PAGE_SIZE_DEFAULT,
  BATCH_PAGE_SIZE_OPTIONS,
  isBatchPageSize,
  listBatches,
  type BatchListPage,
  type BatchPageSize,
  type BatchRecord,
  type BatchStatus,
} from "../api/batches";
import { errorMessage } from "../api/client";
import { listQualifications, listTrainingPartners } from "../api/masterData";
import { getAccessSettings } from "../api/settings";
import { useSession } from "../api/session";
import { BATCH_STATUS_LABELS } from "./batches/labels";
import { formatInstant } from "./batches/sla";
import { StatusBadge } from "./batches/StatusBadge";

/** The two statuses a reviewer acts on. API_CONTRACT: validate, then publish. */
export const QUEUE_STATUSES = ["result_submitted", "ab_validated"] as const satisfies readonly BatchStatus[];
type QueueStatus = (typeof QUEUE_STATUSES)[number];

type Filters = {
  status: QueueStatus | "";
  from: string;
  to: string;
  pageSize: BatchPageSize;
};

const EMPTY_FILTERS: Filters = { status: "", from: "", to: "", pageSize: BATCH_PAGE_SIZE_DEFAULT };

function isQueueStatus(value: string): value is QueueStatus {
  return (QUEUE_STATUSES as readonly string[]).includes(value);
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Soonest result due date first. Rows with no date go last. */
function byResultDue(a: BatchRecord, b: BatchRecord): number {
  const left = a.sla.resultDueAt ? Date.parse(a.sla.resultDueAt) : Number.POSITIVE_INFINITY;
  const right = b.sla.resultDueAt ? Date.parse(b.sla.resultDueAt) : Number.POSITIVE_INFINITY;
  return left - right;
}

export function AbQueuePage() {
  const session = useSession();
  const role = session?.user.role;
  const isNcvet = role === "ncvet_viewer";

  const accessQuery = useQuery({
    queryKey: ["settings", "access"],
    queryFn: ({ signal }) => getAccessSettings(signal),
    enabled: Boolean(session) && isNcvet,
    retry: false,
  });

  const canAccess = !isNcvet || accessQuery.data?.ncvetViewerCanSeeAbQueue === true;

  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const statuses: readonly QueueStatus[] = applied.status ? [applied.status] : QUEUE_STATUSES;

  // The batch list takes one status per call, so "both" is one call per status.
  const queues = useQueries({
    queries: statuses.map((status) => ({
      queryKey: ["ab-queue", status, applied.from, applied.to, page, applied.pageSize],
      enabled: Boolean(session) && canAccess,
      placeholderData: keepPreviousData,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listBatches(
          {
            status,
            from: applied.from || undefined,
            to: applied.to || undefined,
            page,
            pageSize: applied.pageSize,
          },
          signal,
        ),
    })),
  });

  // Names are a convenience. A lookup the role may not make falls back to the id.
  const qualifications = useQuery({
    queryKey: ["ab-queue-qualifications"],
    enabled: Boolean(session) && canAccess,
    retry: false,
    queryFn: ({ signal }) => listQualifications({ page: 1, pageSize: 100 }, signal),
  });
  const canNameTps = role === "aa_admin" || role === "mis" || role === "ncvet_viewer";
  const partners = useQuery({
    queryKey: ["ab-queue-training-partners"],
    enabled: Boolean(session) && canAccess && canNameTps,
    retry: false,
    queryFn: ({ signal }) => listTrainingPartners({ page: 1, pageSize: 100 }, signal),
  });

  const failed = queues.find((query) => query.isError);
  useEffect(() => {
    if (failed) errorRef.current?.focus();
  }, [failed]);

  if (!session) return null;

  if (isNcvet) {
    if (accessQuery.isPending) {
      return <p role="status">Loading the queue.</p>;
    }
    if (accessQuery.isError || !accessQuery.data?.ncvetViewerCanSeeAbQueue) {
      return <Navigate to="/home" replace />;
    }
  }

  const qualificationNames = new Map((qualifications.data?.items ?? []).map((row) => [row.id, row.name]));
  const partnerNames = new Map((partners.data?.items ?? []).map((row) => [row.id, row.name]));

  const loaded = queues.map((query) => query.data).filter((data): data is BatchListPage => Boolean(data));
  const items = loaded.flatMap((data) => data.items).sort(byResultDue);
  const total = loaded.reduce((sum, data) => sum + data.total, 0);
  const pages = Math.max(1, ...loaded.map((data) => pageCount(data.total, data.pageSize)));
  const hasNext = loaded.some((data) => data.page * data.pageSize < data.total);
  const fetching = queues.some((query) => query.isFetching);
  const ready = !failed && loaded.length === queues.length;
  const filtered = Boolean(applied.status || applied.from || applied.to);
  const dateOrderError = Boolean(draft.from && draft.to && draft.from > draft.to);
  const readOnly = role !== "ab_reviewer";

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (dateOrderError) return;
    const pageSize = isBatchPageSize(draft.pageSize) ? draft.pageSize : BATCH_PAGE_SIZE_DEFAULT;
    const next = { ...draft, pageSize };
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  return (
    <div className="batches-page">
      <h1>AB queue</h1>
      <p>
        Batches with a result waiting for validation or publication. Open a batch to validate, publish, or return its
        result for correction.
      </p>
      {readOnly ? (
        <p role="note">
          Read only. This view shows every awarding body. Validation, publication, and return for correction are done by
          the awarding body reviewer.
        </p>
      ) : (
        <p role="note">Only batches of your awarding body are listed.</p>
      )}
      <form role="search" aria-label="Filter the queue" onSubmit={applyFilters}>
        <div className="batches-filters">
          <div className="field">
            <label htmlFor="queue-filter-status">Status</label>
            <select
              id="queue-filter-status"
              name="status"
              value={draft.status}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({ ...current, status: isQueueStatus(value) ? value : "" }));
              }}
            >
              <option value="">Result submitted and AB validated</option>
              {QUEUE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {BATCH_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="queue-filter-from">From assessment date</label>
            <input
              id="queue-filter-from"
              name="from"
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="queue-filter-to">To assessment date</label>
            <input
              id="queue-filter-to"
              name="to"
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="queue-filter-pagesize">Per page</label>
            <select
              id="queue-filter-pagesize"
              name="pageSize"
              value={draft.pageSize}
              onChange={(event) => {
                const next = Number(event.target.value);
                setDraft((current) => ({
                  ...current,
                  pageSize: isBatchPageSize(next) ? next : BATCH_PAGE_SIZE_DEFAULT,
                }));
              }}
            >
              {BATCH_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
        {dateOrderError ? (
          <p className="form-error" role="alert">
            From must be on or before to.
          </p>
        ) : null}
        <div className="batches-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>
      {failed ? (
        <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {errorMessage(failed.error)}
        </p>
      ) : null}
      <p className="batches-summary" role="status">
        {fetching
          ? "Loading the queue."
          : ready
            ? `Page ${page} of ${pages}. Up to ${applied.pageSize} per status. ${total} ${total === 1 ? "batch" : "batches"}.`
            : ""}
      </p>
      <div className="table-scroll">
        <table className="batches-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Qualification</th>
              <th>Training partner</th>
              <th>Assessment dates</th>
              <th>Status</th>
              <th>Result due</th>
            </tr>
          </thead>
          <tbody>
            {items.map((batch) => (
              <tr key={batch.id}>
                <td>
                  <Link to={`/batches/${batch.id}`}>{batch.id}</Link>
                </td>
                <td>{qualificationNames.get(batch.qualificationId) ?? batch.qualificationId}</td>
                <td>{partnerNames.get(batch.tpId) ?? batch.tpId}</td>
                <td>
                  {batch.assessmentStartDate} to {batch.assessmentEndDate}
                </td>
                <td>
                  <StatusBadge status={batch.status} />
                </td>
                <td>{formatInstant(batch.sla.resultDueAt)}</td>
              </tr>
            ))}
            {ready && items.length === 0 ? (
              <tr>
                <td colSpan={6}>{filtered ? "No batches match these filters." : "No results are waiting."}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="batches-pager">
        <button type="button" disabled={!ready || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Previous page
        </button>
        <button type="button" disabled={!ready || !hasNext} onClick={() => setPage((current) => current + 1)}>
          Next page
        </button>
      </div>
    </div>
  );
}
