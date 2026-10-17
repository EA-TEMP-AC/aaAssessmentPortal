import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAuditLogs, localDayBound, type AuditLogItem, type AuditLogPage } from "../api/audit";
import { errorMessage } from "../api/client";
import { isRole, ROLE_LABELS } from "../routing/access";

const COLUMNS = ["When", "Actor", "Action", "Entity", "Entity id", "Changes"] as const;

type DraftFilters = {
  entity: string;
  entityId: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: DraftFilters = {
  entity: "",
  entityId: "",
  from: "",
  to: "",
};

function filtersAreActive(filters: DraftFilters): boolean {
  return Boolean(filters.entity || filters.entityId || filters.from || filters.to);
}

function rangeError(filters: DraftFilters): string | null {
  if (filters.from && !localDayBound(filters.from, "start")) return "Enter a valid From date.";
  if (filters.to && !localDayBound(filters.to, "end")) return "Enter a valid To date.";
  if (filters.from && filters.to && filters.from > filters.to) {
    return "The From date must be on or before the To date.";
  }
  return null;
}

function pageCount(total: number, pageSize: number): number {
  if (pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

function summary(data: AuditLogPage): string {
  const pages = pageCount(data.total, data.pageSize);
  const noun = data.total === 1 ? "entry" : "entries";
  return `Page ${data.page} of ${pages}. ${data.pageSize} per page. ${data.total} ${noun}.`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatActor(item: AuditLogItem): string {
  if (!item.actorId && !item.actorRole) return "Not recorded";
  const role =
    item.actorRole && isRole(item.actorRole) ? ROLE_LABELS[item.actorRole] : (item.actorRole ?? "Unknown role");
  return `${role} (${item.actorName ?? item.actorId ?? "Unknown id"})`;
}

function entryTarget(item: AuditLogItem): string {
  const label = item.entityLabel ?? item.entityId;
  return label ? `${item.entity} ${label}` : item.entity;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSnapshotValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function changedFieldNames(before: unknown, after: unknown): string[] | null {
  if (!isPlainRecord(before) || !isPlainRecord(after)) return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function RecordValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p>None</p>;
  if (!isPlainRecord(value)) return <pre className="snapshot-value">{formatSnapshotValue(value)}</pre>;
  const entries = Object.entries(value);
  if (entries.length === 0) return <p>None</p>;
  return (
    <dl className="snapshot-list">
      {entries.map(([key, entry]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{formatSnapshotValue(entry)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SnapshotCompare({ before, after }: { before: unknown; after: unknown }) {
  const changed = changedFieldNames(before, after);
  return (
    <>
      {changed ? (
        <p>{changed.length > 0 ? `Changed fields: ${changed.join(", ")}` : "No field changes."}</p>
      ) : null}
      <div className="snapshot-pair">
        <div>
          <p>
            <strong>Before</strong>
          </p>
          <RecordValue value={before} />
        </div>
        <div>
          <p>
            <strong>After</strong>
          </p>
          <RecordValue value={after} />
        </div>
      </div>
    </>
  );
}

function AuditRow({ item }: { item: AuditLogItem }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `audit-changes-${item.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const changesName = `Before and after for ${item.action} on ${entryTarget(item)}`;

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function closePanel() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <tr>
        <td>
          <time dateTime={item.createdAt}>{formatWhen(item.createdAt)}</time>
        </td>
        <td>{formatActor(item)}</td>
        <td>{item.action}</td>
        <td>{item.entity}</td>
        <td>
          {item.entityLabel ?? item.entityId ?? "None"}
          {item.entityLabel && item.entityId ? <span className="field-hint"> ({item.entityId})</span> : null}
          {item.batchLabel && item.entity !== "batch" ? <span className="field-hint"> Batch: {item.batchLabel}</span> : null}
        </td>
        <td>
          <button
            ref={buttonRef}
            type="button"
            className="button-quiet"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={changesName}
            onClick={() => setOpen((current) => !current)}
          >
            Before and after
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="audit-changes">
          <td colSpan={COLUMNS.length}>
            <div
              id={panelId}
              ref={panelRef}
              role="region"
              tabIndex={-1}
              aria-label={changesName}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closePanel();
                }
              }}
            >
              <p>Redacted secrets are shown as ***.</p>
              <SnapshotCompare before={item.before} after={item.after} />
              {item.meta !== null ? (
                <div>
                  <p>
                    <strong>Meta</strong>
                  </p>
                  <RecordValue value={item.meta} />
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function AuditLogPage() {
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState<string | null>(null);

  const logs = useQuery({
    queryKey: ["audit-logs", applied, page],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listAuditLogs(
        {
          entity: applied.entity,
          entityId: applied.entityId,
          from: applied.from ? (localDayBound(applied.from, "start") ?? undefined) : undefined,
          to: applied.to ? (localDayBound(applied.to, "end") ?? undefined) : undefined,
          page,
        },
        signal,
      ),
  });

  const result = logs.isError ? undefined : logs.data;
  const statusText = logs.isFetching ? "Loading audit log." : result ? summary(result) : "";
  const emptyMessage = filtersAreActive(applied)
    ? "No audit entries match these filters."
    : "No audit entries are available.";
  const hasNext = result ? result.page * result.pageSize < result.total : false;

  function updateDraft(patch: Partial<DraftFilters>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFilterError(null);
  }

  return (
    <div className="audit-page">
      <h1>Audit log</h1>
      <p>
        This list includes only the audit entries your account is allowed to read. It may not include every entry in
        the system.
      </p>
      <form
        role="search"
        aria-label="Filter audit log"
        onSubmit={(event) => {
          event.preventDefault();
          const next = {
            entity: draft.entity.trim(),
            entityId: draft.entityId.trim(),
            from: draft.from,
            to: draft.to,
          };
          const error = rangeError(next);
          if (error) {
            setFilterError(error);
            return;
          }
          setDraft(next);
          setApplied(next);
          setPage(1);
          setFilterError(null);
        }}
      >
        <div className="audit-filters">
          <div className="field">
            <label htmlFor="audit-entity">Entity</label>
            <input
              id="audit-entity"
              name="entity"
              type="text"
              value={draft.entity}
              autoComplete="off"
              onChange={(event) => updateDraft({ entity: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="audit-entity-id">Entity id</label>
            <input
              id="audit-entity-id"
              name="entityId"
              type="text"
              value={draft.entityId}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => updateDraft({ entityId: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="audit-from">From date</label>
            <input
              id="audit-from"
              name="from"
              type="date"
              value={draft.from}
              aria-invalid={filterError ? true : undefined}
              aria-describedby={filterError ? "audit-filter-error" : undefined}
              onChange={(event) => updateDraft({ from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="audit-to">To date</label>
            <input
              id="audit-to"
              name="to"
              type="date"
              value={draft.to}
              aria-invalid={filterError ? true : undefined}
              aria-describedby={filterError ? "audit-filter-error" : undefined}
              onChange={(event) => updateDraft({ to: event.target.value })}
            />
          </div>
        </div>
        {filterError ? (
          <p id="audit-filter-error" className="form-error" role="alert">
            {filterError}
          </p>
        ) : null}
        <div className="audit-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
              setPage(1);
              setFilterError(null);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>

      {logs.isError && !logs.isFetching ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(logs.error)}</p>
          <button type="button" onClick={() => void logs.refetch()}>
            Try again
          </button>
        </div>
      ) : null}

      {statusText ? (
        <p className="audit-summary" role="status">
          {statusText}
        </p>
      ) : null}

      {result ? (
        <>
          <div className="table-scroll">
            <table className="audit-table" aria-busy={logs.isFetching}>
              <caption className="visually-hidden">Audit entries</caption>
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
                    <td colSpan={COLUMNS.length}>{emptyMessage}</td>
                  </tr>
                ) : (
                  result.items.map((item) => <AuditRow key={item.id} item={item} />)
                )}
              </tbody>
            </table>
          </div>
          <nav className="audit-pager" aria-label="Audit log pages">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={result.page <= 1 || logs.isFetching}
            >
              Previous page
            </button>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={!hasNext || logs.isFetching}>
              Next page
            </button>
          </nav>
        </>
      ) : null}
    </div>
  );
}
