import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import {
  downloadCandidateSummary,
  getCandidateSummary,
  listResultBatches,
  type ResultListFilters,
} from "../api/resultsReport";
import { useSession } from "../api/session";
import { SECTOR_NAMES } from "../api/annexure";

const REPORT_ROLES = ["aa_admin", "mis", "ncvet_viewer"];

const STATUS_LABEL: Record<string, string> = {
  assessment_completed: "Assessment done, result not sent",
  result_submitted: "Result submitted",
  ab_validated: "Validated",
  published: "Final",
};

const EMPTY: ResultListFilters = { status: "", sector: "", batchId: "", from: "", to: "" };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ResultsList() {
  const [draft, setDraft] = useState<ResultListFilters>(EMPTY);
  const [filters, setFilters] = useState<ResultListFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["results", "list", filters, page],
    queryFn: ({ signal }) => listResultBatches({ ...filters, page }, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const set = (key: keyof ResultListFilters) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <h1>Results</h1>
      <p className="field-hint">Batches that have finished assessment, with the pass, fail and absent counts.</p>
      <form
        className="audit-filters no-print"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters(draft);
        }}
      >
        <div className="field">
          <label htmlFor="rs-sector">Sector</label>
          <select id="rs-sector" value={draft.sector} onChange={(e) => set("sector")(e.target.value)}>
            <option value="">All sectors</option>
            {SECTOR_NAMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rs-status">Status</label>
          <select id="rs-status" value={draft.status} onChange={(e) => set("status")(e.target.value)}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rs-batch">Batch Id</label>
          <input id="rs-batch" value={draft.batchId} onChange={(e) => set("batchId")(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rs-from">Assessed from</label>
          <input id="rs-from" type="date" value={draft.from} onChange={(e) => set("from")(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rs-to">Assessed to</label>
          <input id="rs-to" type="date" value={draft.to} onChange={(e) => set("to")(e.target.value)} />
        </div>
        <button type="submit">Search</button>
        <button
          type="button"
          className="button-quiet"
          onClick={() => {
            setDraft(EMPTY);
            setFilters(EMPTY);
            setPage(1);
          }}
        >
          Clear
        </button>
      </form>

      {query.isLoading ? <p role="status">Loading results…</p> : null}
      {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
      {data && data.items.length === 0 ? <p role="status">No batches with results yet.</p> : null}
      {data && data.items.length > 0 ? (
        <>
          <table>
            <caption className="visually-hidden">Batch results</caption>
            <thead>
              <tr>
                <th scope="col">Batch</th>
                <th scope="col">Job role</th>
                <th scope="col">Centre</th>
                <th scope="col">Date</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
                <th scope="col">Pass</th>
                <th scope="col">Fail</th>
                <th scope="col">Absent</th>
                <th scope="col">Report</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.batchId}>
                  <td>{r.batchId}</td>
                  <td>{r.qualification ?? "—"}</td>
                  <td>{r.centre ?? "—"}</td>
                  <td>{r.assessmentDate}</td>
                  <td>{STATUS_LABEL[r.batchStatus] ?? r.batchStatus}</td>
                  <td>{r.total}</td>
                  <td>{r.pass}</td>
                  <td>{r.fail}</td>
                  <td>{r.absent}</td>
                  <td>
                    {r.resultStatus ? (
                      <Link to={`/results/${r.batchId}`}>Open report</Link>
                    ) : (
                      "Not ready"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Page {data.page} of {pages}. {data.total} {data.total === 1 ? "batch" : "batches"}.
          </p>
          <div className="no-print">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>{" "}
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ReportView() {
  const { batchId = "" } = useParams();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["results", "summary", batchId],
    queryFn: ({ signal }) => getCandidateSummary(batchId, signal),
    retry: false,
  });
  const s = query.data;

  async function excel() {
    setError(null);
    try {
      saveBlob(await downloadCandidateSummary(batchId), `candidate-summary-${batchId}.xlsx`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="report-sheet">
      <p className="no-print">
        <Link to="/results">Back to results</Link>
      </p>
      <h1>Candidate Summary Report</h1>
      {query.isLoading ? <p role="status">Loading report…</p> : null}
      {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {s ? (
        <>
          <div className="no-print">
            <button type="button" onClick={() => window.print()}>
              Print
            </button>{" "}
            <button type="button" onClick={() => void excel()}>
              Download Excel
            </button>
          </div>
          <dl>
            <dt>Batch Id</dt>
            <dd>{s.batchId}</dd>
            <dt>Job role</dt>
            <dd>{s.header.qualification}</dd>
            <dt>Assessor Name</dt>
            <dd>{s.header.assessor}</dd>
            <dt>Centre Location</dt>
            <dd>{s.header.centre}</dd>
            <dt>Partner</dt>
            <dd>{s.header.partner}</dd>
            <dt>Date of Assessment</dt>
            <dd>{s.header.date}</dd>
            <dt>Result Index</dt>
            <dd>
              Total {s.counts.total}, Pass {s.counts.pass}, Fail {s.counts.fail}, Absent {s.counts.absent}.
              Candidates assessed {s.counts.assessed}.
            </dd>
          </dl>
          <table>
            <caption className="visually-hidden">Candidate marks</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>S.No</th>
                <th scope="col" rowSpan={2}>Candidate Id</th>
                <th scope="col" rowSpan={2}>Candidate Name</th>
                {s.nos.map((n) => (
                  <th key={n.nosId} scope="colgroup" colSpan={s.components.length}>
                    {n.code}
                  </th>
                ))}
                {s.components.map((c) => (
                  <th key={c} scope="col" rowSpan={2}>
                    Total {c}
                  </th>
                ))}
                <th scope="col" rowSpan={2}>Overall Marks ({s.maxTotal})</th>
                <th scope="col" rowSpan={2}>Status</th>
                <th scope="col" rowSpan={2}>Total Percentage</th>
              </tr>
              <tr>
                {s.nos.flatMap((n) =>
                  s.components.map((c) => (
                    <th key={`${n.nosId}-${c}`} scope="col">
                      {c} ({n.max[c] ?? 0})
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.sNo}>
                  <td>{r.sNo}</td>
                  <td>{r.reference || "—"}</td>
                  <td>{r.name}</td>
                  {r.marks.flatMap((m, i) =>
                    s.components.map((c) => <td key={`${i}-${c}`}>{m[c] ?? "—"}</td>),
                  )}
                  {s.components.map((c) => (
                    <td key={c}>{r.totals[c]}</td>
                  ))}
                  <td>{r.total}</td>
                  <td>{r.status}</td>
                  <td>{r.percentage.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field-hint">
            This is a system generated report, contains confidential information intended for a
            specific individual and purpose, and is intended for the addressee only. Any
            unauthorized use, copying, or distribution of this report is strictly prohibited.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** X-44. Results: the batch list and the printable candidate summary report. */
export function ResultsPage() {
  const session = useSession();
  if (!session || !REPORT_ROLES.includes(session.user.role)) {
    return (
      <div>
        <h1>Results</h1>
        <p role="status">Your results are shown in your own section.</p>
      </div>
    );
  }
  return (
    <Routes>
      <Route index element={<ResultsList />} />
      <Route path=":batchId" element={<ReportView />} />
    </Routes>
  );
}
