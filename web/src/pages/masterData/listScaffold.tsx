import { useEffect, useRef, type FormEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { MASTER_PAGE_SIZE_OPTIONS, type MasterPageSize } from "../../api/masterData";
import { formatMasterDataError } from "./formatApiError";
import type { Banner } from "./useMasterDialog";

export function PageSizeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: MasterPageSize;
  onChange: (value: MasterPageSize) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Page size</label>
      <select
        id={id}
        name="pageSize"
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (MASTER_PAGE_SIZE_OPTIONS.includes(next as MasterPageSize)) onChange(next as MasterPageSize);
        }}
      >
        {MASTER_PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ActiveFilterField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: "" | "true" | "false";
  onChange: (value: "" | "true" | "false") => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Status</label>
      <select
        id={id}
        name="active"
        value={value}
        onChange={(event) => onChange(event.target.value as "" | "true" | "false")}
      >
        <option value="">Any status</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </div>
  );
}

export function ListScaffold({
  title,
  lede,
  notes,
  canWrite,
  createLabel,
  onCreate,
  filterLabel,
  filters,
  onApply,
  onClear,
  filterError,
  isError,
  isFetching,
  error,
  onRetry,
  summary,
  columns,
  caption,
  rows,
  showTable,
  page,
  hasNext,
  onPrevious,
  onNext,
  pagerLabel,
  pageRef,
  notice,
  noticeRef,
  dialog,
}: {
  title: string;
  lede: string;
  notes: readonly string[];
  canWrite: boolean;
  createLabel: string;
  onCreate: (event: MouseEvent<HTMLButtonElement>) => void;
  filterLabel: string;
  filters: ReactNode;
  onApply: () => void;
  onClear: () => void;
  filterError: string | null;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  summary: string;
  columns: readonly string[];
  caption: string;
  rows: ReactNode;
  showTable: boolean;
  page: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pagerLabel: string;
  pageRef: RefObject<HTMLDivElement>;
  notice: Banner | null;
  noticeRef: RefObject<HTMLParagraphElement>;
  dialog: ReactNode;
}) {
  const filterErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (filterError) filterErrorRef.current?.focus();
  }, [filterError]);

  return (
    <div className="master-page">
      <div ref={pageRef}>
        <h1>{title}</h1>
        <p>{lede}</p>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        {notice ? (
          <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
            {notice.message}
          </p>
        ) : null}
        {canWrite ? (
          <p>
            <button type="button" onClick={onCreate}>
              {createLabel}
            </button>
          </p>
        ) : null}
        <form
          role="search"
          aria-label={filterLabel}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onApply();
          }}
        >
          {/* List endpoints have no text search. See DECISIONS.md open question 62. */}
          {filterError ? (
            <p ref={filterErrorRef} tabIndex={-1} className="form-error" role="alert">
              {filterError}
            </p>
          ) : null}
          <div className="master-filters">{filters}</div>
          <div className="master-filter-actions">
            <button type="submit">Apply filters</button>
            <button type="button" className="button-quiet" onClick={onClear}>
              Clear filters
            </button>
          </div>
        </form>
        {isError && !isFetching ? (
          <div className="form-error" role="alert">
            <p>{formatMasterDataError(error).message}</p>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
        {summary ? (
          <p className="master-summary" role="status">
            {summary}
          </p>
        ) : null}
        {showTable ? (
          <>
            <div className="table-scroll">
              <table className="master-table" aria-busy={isFetching || undefined}>
                <caption className="visually-hidden">{caption}</caption>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column} scope="col">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{rows}</tbody>
              </table>
            </div>
            <nav className="master-pager" aria-label={pagerLabel}>
              <button type="button" onClick={onPrevious} disabled={page <= 1 || isFetching}>
                Previous page
              </button>
              <button type="button" onClick={onNext} disabled={!hasNext || isFetching}>
                Next page
              </button>
            </nav>
          </>
        ) : null}
      </div>
      {dialog}
    </div>
  );
}
