import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SECTOR_NAMES } from "../api/annexure";
import { errorMessage } from "../api/client";
import { getDashboard, type DashboardFilters } from "../api/dashboard";

const EMPTY: DashboardFilters = { sector: "", batchId: "", from: "", to: "" };

/** X-49. The agency's home dashboard: counts for a day or range and the next seven days. */
export function DashboardPanel() {
  const [draft, setDraft] = useState<DashboardFilters>(EMPTY);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY);
  const query = useQuery({
    queryKey: ["dashboard", filters],
    queryFn: ({ signal }) => getDashboard(filters, signal),
    retry: false,
  });
  const set = (key: keyof DashboardFilters) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const data = query.data;
  const upcoming = data?.nextSevenDays ?? [];

  return (
    <section aria-labelledby="dash-title">
      <h2 id="dash-title">Dashboard</h2>
      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <div className="field">
          <label htmlFor="dash-sector">Sector</label>
          <select
            id="dash-sector"
            value={draft.sector}
            onChange={(e) => set("sector")(e.target.value)}
          >
            <option value="">All sectors</option>
            {SECTOR_NAMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dash-batch">Batch Id</label>
          <input
            id="dash-batch"
            value={draft.batchId}
            onChange={(e) => set("batchId")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="dash-from">From</label>
          <input
            id="dash-from"
            type="date"
            value={draft.from}
            onChange={(e) => set("from")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="dash-to">To</label>
          <input
            id="dash-to"
            type="date"
            value={draft.to}
            onChange={(e) => set("to")(e.target.value)}
          />
        </div>
        <button type="submit">Search</button>
      </form>

      {query.isLoading ? <p role="status">Loading dashboard…</p> : null}
      {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
      {data ? (
        <>
          <p className="field-hint">
            Counts for{" "}
            {data.from === data.to ? data.from : `${data.from} to ${data.to}`}.
          </p>
          <dl className="dash-tiles">
            <div>
              <dt>Batches scheduled</dt>
              <dd>{data.batchesScheduled}</dd>
            </div>
            <div>
              <dt>Assessors scheduled</dt>
              <dd>{data.assessorsScheduled}</dd>
            </div>
            <div>
              <dt>Students writing the exam now</dt>
              <dd>{data.writingNow}</dd>
            </div>
          </dl>
          <h3>Batches in the next 7 days</h3>
          {upcoming.length === 0 ? (
            <p role="status">No batches in the next 7 days.</p>
          ) : (
            <table>
              <caption className="visually-hidden">
                Batches in the next 7 days
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Job role</th>
                  <th scope="col">Centre</th>
                  <th scope="col">Training partner</th>
                  <th scope="col">Assessor</th>
                  <th scope="col">Students</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((b) => (
                  <tr key={b.id}>
                    <td>{b.assessmentStartDate}</td>
                    <td>{b.qualification ?? "—"}</td>
                    <td>{b.centreName ?? "—"}</td>
                    <td>{b.tpName ?? "—"}</td>
                    <td>{b.assessorName ?? "Not assigned"}</td>
                    <td>{b.candidateCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </section>
  );
}
