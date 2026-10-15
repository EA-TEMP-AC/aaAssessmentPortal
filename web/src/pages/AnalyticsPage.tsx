import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  defaultRange,
  getAnalyticsSummary,
  listAnalytics,
  validateRange,
  type AnalyticsDimension,
  type AnalyticsRow,
} from "../api/analytics";
import { errorMessage } from "../api/client";
import { BarChart } from "../components/BarChart";

const PAGE_SIZE = 10;

const TABS: readonly { id: AnalyticsDimension; label: string; noun: string }[] = [
  { id: "assessor", label: "By assessor", noun: "Assessor" },
  { id: "training-partner", label: "By training partner", noun: "Training partner" },
  { id: "job-role", label: "By job role", noun: "Job role" },
  { id: "state", label: "By state", noun: "State" },
];

type Metric = "passRate" | "batches";

const STATUS_LABELS: Record<string, string> = {
  allocated: "Allocated",
  accepted: "Accepted",
  rejected: "Rejected",
  assessor_assigned: "Assessor assigned",
  in_progress: "In progress",
  assessment_completed: "Assessment completed",
  result_submitted: "Result submitted",
  ab_validated: "AB validated",
  published: "Published",
  cancelled: "Cancelled",
};

function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? key.replace(/_/g, " ");
}

function percent(rate: number | null): string {
  return rate === null ? "No data" : `${(rate * 100).toFixed(1)}%`;
}

function rowName(row: AnalyticsRow): string {
  const name = row.name ?? "Removed record";
  return row.code ? `${name} (${row.code})` : name;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Summary({ from, to }: { from: string; to: string }) {
  const query = useQuery({
    queryKey: ["analytics", "summary", from, to],
    queryFn: ({ signal }) => getAnalyticsSummary({ from, to }, signal),
  });

  if (query.isPending) return <p role="status">Loading summary.</p>;
  if (query.isError) {
    return (
      <p className="form-error" role="alert">
        {errorMessage(query.error)}
      </p>
    );
  }
  const s = query.data;
  if (s.batches.total === 0) {
    return (
      <p role="status">
        No batches start between {from} and {to}.
      </p>
    );
  }
  return (
    <section aria-labelledby="analytics-summary-heading">
      <h2 id="analytics-summary-heading">Summary</h2>
      <dl className="stat-tiles">
        <Tile label="Batches" value={String(s.batches.total)} />
        {Object.entries(s.batches.byStatus).map(([key, n]) => (
          <Tile key={key} label={`Batches ${statusLabel(key).toLowerCase()}`} value={String(n)} />
        ))}
        <Tile label="Published on time" value={String(s.publishedResults.onTime)} />
        <Tile label="Published late" value={String(s.publishedResults.late)} />
        <Tile label="Learners assessed" value={String(s.learnersAssessed)} />
        <Tile label="Pass rate" value={percent(s.passRate)} />
        <Tile label="SLA breaches" value={String(s.slaBreaches)} />
      </dl>
    </section>
  );
}

function BreakdownPanel({
  dimension,
  noun,
  from,
  to,
  labelledBy,
}: {
  dimension: AnalyticsDimension;
  noun: string;
  from: string;
  to: string;
  labelledBy: string;
}) {
  const [page, setPage] = useState(1);
  const [metric, setMetric] = useState<Metric>("passRate");

  const table = useQuery({
    queryKey: ["analytics", dimension, from, to, page, PAGE_SIZE],
    queryFn: ({ signal }) => listAnalytics(dimension, { from, to, page, pageSize: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  });
  // The chart always shows the top 10 rows (page 1), whichever table page is open.
  const top = useQuery({
    queryKey: ["analytics", dimension, from, to, 1, PAGE_SIZE],
    queryFn: ({ signal }) => listAnalytics(dimension, { from, to, page: 1, pageSize: PAGE_SIZE }, signal),
  });

  if (table.isPending) return <p role="status">Loading {noun.toLowerCase()} figures.</p>;
  if (table.isError) {
    return (
      <p className="form-error" role="alert">
        {errorMessage(table.error)}
      </p>
    );
  }
  const result = table.data;
  if (result.total === 0) {
    return (
      <p role="status">
        No {noun.toLowerCase()} figures for {from} to {to}.
      </p>
    );
  }
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div role="tabpanel" aria-labelledby={labelledBy} className="analytics-panel">
      {top.data ? (
        <>
          <fieldset className="bare-fieldset chart-metric">
            <legend>Chart shows</legend>
            <label className="check-label">
              <input
                type="radio"
                name={`metric-${dimension}`}
                checked={metric === "passRate"}
                onChange={() => setMetric("passRate")}
              />
              Pass rate
            </label>
            <label className="check-label">
              <input
                type="radio"
                name={`metric-${dimension}`}
                checked={metric === "batches"}
                onChange={() => setMetric("batches")}
              />
              Batches
            </label>
          </fieldset>
          <BarChart
            title={`${metric === "passRate" ? "Pass rate" : "Batches"} for the top ${top.data.items.length} ${noun.toLowerCase()} rows`}
            valueAxisLabel={metric === "passRate" ? "Pass rate (%)" : "Batches in range"}
            categoryAxisLabel={noun}
            max={metric === "passRate" ? 1 : undefined}
            formatTick={metric === "passRate" ? (v) => `${Math.round(v * 100)}%` : undefined}
            data={top.data.items.map((row) =>
              metric === "passRate"
                ? { label: rowName(row), value: row.passRate, text: percent(row.passRate) }
                : { label: rowName(row), value: row.batches, text: String(row.batches) },
            )}
          />
        </>
      ) : top.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(top.error)}
        </p>
      ) : null}

      <p className="audit-summary">
        Page {result.page} of {pages}. {result.total} {result.total === 1 ? "row" : "rows"}, busiest first.
      </p>
      <div className="table-scroll">
        <table className="master-table">
          <caption className="visually-hidden">{noun} figures, most batches first</caption>
          <thead>
            <tr>
              <th scope="col">{noun}</th>
              <th scope="col">Batches</th>
              <th scope="col">Published batches</th>
              <th scope="col">Learners assessed</th>
              <th scope="col">Passed</th>
              <th scope="col">Failed</th>
              <th scope="col">Absent</th>
              <th scope="col">Pass rate</th>
              <th scope="col">Avg turnaround (days)</th>
              <th scope="col">SLA breaches</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((row) => (
              <tr key={row.id}>
                <th scope="row">{rowName(row)}</th>
                <td>{row.batches}</td>
                <td>{row.publishedBatches}</td>
                <td>{row.learnersAssessed}</td>
                <td>{row.passed}</td>
                <td>{row.failed}</td>
                <td>{row.absent}</td>
                <td>{percent(row.passRate)}</td>
                <td>{row.avgTurnaroundDays === null ? "No data" : row.avgTurnaroundDays.toFixed(2)}</td>
                <td>{row.slaBreaches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="audit-pager" aria-label={`${noun} pages`}>
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={result.page <= 1 || table.isFetching}
        >
          Previous page
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={result.page >= pages || table.isFetching}
        >
          Next page
        </button>
      </nav>
    </div>
  );
}

export function AnalyticsPage() {
  const initial = useRef(defaultRange()).current;
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [tab, setTab] = useState<AnalyticsDimension>("assessor");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function apply(event: FormEvent) {
    event.preventDefault();
    const problem = validateRange(draftFrom, draftTo);
    setRangeError(problem);
    if (!problem) setApplied({ from: draftFrom, to: draftTo });
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="analytics-page">
      <h1>Analytics</h1>
      <p>
        Batches are counted by assessment start date, in IST. Both dates are included. Only published results count
        towards learners assessed and pass rate.
      </p>

      <form className="audit-filters" onSubmit={apply} noValidate>
        <div className="field">
          <label htmlFor="analytics-from">From</label>
          <input
            id="analytics-from"
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            aria-invalid={rangeError ? true : undefined}
            aria-describedby={rangeError ? "analytics-range-error" : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="analytics-to">To</label>
          <input
            id="analytics-to"
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            aria-invalid={rangeError ? true : undefined}
            aria-describedby={rangeError ? "analytics-range-error" : undefined}
          />
        </div>
        <div className="audit-filter-actions">
          <button type="submit">Apply range</button>
        </div>
      </form>
      {rangeError ? (
        <p id="analytics-range-error" className="form-error" role="alert">
          {rangeError}
        </p>
      ) : null}

      <Summary from={applied.from} to={applied.to} />

      <section aria-labelledby="analytics-breakdown-heading">
        <h2 id="analytics-breakdown-heading">Breakdown</h2>
        <div role="tablist" aria-label="Group figures by" className="analytics-tabs">
          {TABS.map((t, index) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`analytics-tab-${t.id}`}
              aria-selected={t.id === tab}
              tabIndex={t.id === tab ? 0 : -1}
              className={t.id === tab ? "analytics-tab analytics-tab-active" : "analytics-tab"}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, index)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <BreakdownPanel
          key={`${active.id}|${applied.from}|${applied.to}`}
          dimension={active.id}
          noun={active.noun}
          from={applied.from}
          to={applied.to}
          labelledBy={`analytics-tab-${active.id}`}
        />
      </section>
    </div>
  );
}
