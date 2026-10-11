import { useEffect, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BATCH_PAGE_SIZE_DEFAULT,
  BATCH_PAGE_SIZE_OPTIONS,
  BATCH_STATUSES,
  isBatchPageSize,
  isBatchStatusValue,
  listBatches,
  type BatchListPage as BatchPage,
  type BatchPageSize,
  type BatchStatus,
} from "../../api/batches";
import { errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { canCreateBatch } from "./access";
import { BATCH_STATUS_LABELS } from "./labels";
import { SlaColumn } from "./SlaCountdown";
import { StatusBadge } from "./StatusBadge";
import { useNow } from "./useNow";

type Filters = {
  status: BatchStatus | "";
  from: string;
  to: string;
  tpId: string;
  pageSize: BatchPageSize;
};

const EMPTY_FILTERS: Filters = {
  status: "",
  from: "",
  to: "",
  tpId: "",
  pageSize: BATCH_PAGE_SIZE_DEFAULT,
};

function pageCount(total: number, pageSize: number): number {
  if (pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

function summary(data: BatchPage): string {
  const pages = pageCount(data.total, data.pageSize);
  const noun = data.total === 1 ? "batch" : "batches";
  return `Page ${data.page} of ${pages}. ${data.pageSize} per page. ${data.total} ${noun}.`;
}

function filtersAreActive(filters: Filters): boolean {
  return Boolean(filters.status || filters.from || filters.to || filters.tpId);
}

export function BatchListPage() {
  const session = useSession();
  const now = useNow();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const batches = useQuery({
    queryKey: ["batches", applied, page],
    enabled: Boolean(session),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listBatches(
        {
          status: applied.status || undefined,
          from: applied.from || undefined,
          to: applied.to || undefined,
          tpId: applied.tpId || undefined,
          page,
          pageSize: applied.pageSize,
        },
        signal,
      ),
  });

  useEffect(() => {
    if (batches.isError) errorRef.current?.focus();
  }, [batches.isError]);

  if (!session) return null;

  const result = batches.isError ? undefined : batches.data;
  const emptyMessage = filtersAreActive(applied) ? "No batches match these filters." : "No batches are available.";
  const hasNext = result ? result.page * result.pageSize < result.total : false;

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      return;
    }
    const pageSize = isBatchPageSize(draft.pageSize) ? draft.pageSize : BATCH_PAGE_SIZE_DEFAULT;
    const next = { ...draft, pageSize };
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  const dateOrderError = Boolean(draft.from && draft.to && draft.from > draft.to);

  return (
    <div className="batches-page">
      <h1>Batches</h1>
      <p>
        The list is whatever the server returned for this account. Filters are status, assessment start date range, and
        training partner id.
      </p>
      {canCreateBatch(session.user.role) ? (
        <p>
          <Link to="/batches/new">Create batch</Link>
        </p>
      ) : null}
      <form role="search" aria-label="Filter batches" onSubmit={applyFilters}>
        <div className="batches-filters">
          <div className="field">
            <label htmlFor="batch-filter-status">Status</label>
            <select
              id="batch-filter-status"
              name="status"
              value={draft.status}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  status: value && isBatchStatusValue(value) ? value : "",
                }));
              }}
            >
              <option value="">Any status</option>
              {BATCH_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {BATCH_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="batch-filter-from">From assessment date</label>
            <input
              id="batch-filter-from"
              name="from"
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="batch-filter-to">To assessment date</label>
            <input
              id="batch-filter-to"
              name="to"
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="batch-filter-tp">Training partner id</label>
            <input
              id="batch-filter-tp"
              name="tpId"
              value={draft.tpId}
              onChange={(event) => setDraft((current) => ({ ...current, tpId: event.target.value.trim() }))}
            />
          </div>
          <div className="field">
            <label htmlFor="batch-filter-pagesize">Per page</label>
            <select
              id="batch-filter-pagesize"
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
      {batches.isError ? (
        <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {errorMessage(batches.error)}
        </p>
      ) : null}
      <p className="batches-summary" role="status">
        {batches.isFetching ? "Loading batches." : result ? summary(result) : ""}
      </p>
      <div className="table-scroll">
        <table className="batches-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Status</th>
              <th>Type</th>
              <th>Assessment dates</th>
              <th>Training partner</th>
              <th>SLA</th>
            </tr>
          </thead>
          <tbody>
            {result?.items.map((batch) => (
              <tr key={batch.id}>
                <td>
                  <Link to={`/batches/${batch.id}`}>{batch.id}</Link>
                </td>
                <td>
                  <StatusBadge status={batch.status} />
                </td>
                <td>{batch.type}</td>
                <td>
                  {batch.assessmentStartDate} to {batch.assessmentEndDate}
                </td>
                <td>{batch.tpId}</td>
                <td>
                  <SlaColumn batch={batch} now={now} />
                </td>
              </tr>
            ))}
            {result && result.items.length === 0 ? (
              <tr>
                <td colSpan={6}>{emptyMessage}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="batches-pager">
        <button type="button" disabled={!result || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Previous page
        </button>
        <button type="button" disabled={!hasNext} onClick={() => setPage((current) => current + 1)}>
          Next page
        </button>
      </div>
    </div>
  );
}
