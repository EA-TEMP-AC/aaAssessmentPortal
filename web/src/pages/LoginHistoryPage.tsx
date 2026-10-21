import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SECTOR_NAMES } from "../api/annexure";
import { errorMessage } from "../api/client";
import {
  getLoginHistory,
  getPunchDetails,
  type LoginFilters,
} from "../api/dashboard";

const EMPTY: LoginFilters = {
  sector: "",
  batchId: "",
  examDate: "",
  role: "",
  userId: "",
};
const ROLE_LABEL: Record<string, string> = {
  assessor: "Assessor",
  proctor: "Proctor",
  student: "Student",
};

function timeText(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/** X-49. Users log and punch details from the login and logout events. */
export function LoginHistoryPage() {
  const [view, setView] = useState<"log" | "punch">("log");
  const [draft, setDraft] = useState<LoginFilters>(EMPTY);
  const [filters, setFilters] = useState<LoginFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ["login-history", "log", filters, page],
    queryFn: ({ signal }) => getLoginHistory({ ...filters, page }, signal),
    enabled: view === "log",
    placeholderData: keepPreviousData,
    retry: false,
  });
  const punch = useQuery({
    queryKey: ["login-history", "punch", filters],
    queryFn: ({ signal }) => getPunchDetails(filters, signal),
    enabled: view === "punch",
    retry: false,
  });
  const active = view === "log" ? log : punch;
  const set = (key: keyof LoginFilters) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const logData = log.data;
  const pages = logData
    ? Math.max(1, Math.ceil(logData.total / logData.pageSize))
    : 1;

  return (
    <div>
      <h1>Login history</h1>
      <p className="field-hint">
        When assessors, proctors and students logged in and out of the app, by
        batch.
      </p>
      <div role="group" aria-label="Report type">
        <button
          type="button"
          aria-pressed={view === "log"}
          onClick={() => setView("log")}
        >
          Users log
        </button>{" "}
        <button
          type="button"
          aria-pressed={view === "punch"}
          onClick={() => setView("punch")}
        >
          Punch details
        </button>
      </div>
      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters(draft);
        }}
      >
        <div className="field">
          <label htmlFor="lh-sector">Sector</label>
          <select
            id="lh-sector"
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
          <label htmlFor="lh-batch">Batch Id</label>
          <input
            id="lh-batch"
            value={draft.batchId}
            onChange={(e) => set("batchId")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="lh-date">Exam date</label>
          <input
            id="lh-date"
            type="date"
            value={draft.examDate}
            onChange={(e) => set("examDate")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="lh-role">Role</label>
          <select
            id="lh-role"
            value={draft.role}
            onChange={(e) => set("role")(e.target.value)}
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lh-user">User Id</label>
          <input
            id="lh-user"
            value={draft.userId}
            onChange={(e) => set("userId")(e.target.value)}
          />
        </div>
        <button type="submit">Search</button>
      </form>

      {active.isLoading ? <p role="status">Loading…</p> : null}
      {active.isError ? <p role="alert">{errorMessage(active.error)}</p> : null}

      {view === "log" && logData && logData.items.length === 0 ? (
        <p role="status">No login records match.</p>
      ) : null}
      {view === "log" && logData && logData.items.length > 0 ? (
        <>
          <table>
            <caption className="visually-hidden">Users log</caption>
            <thead>
              <tr>
                <th scope="col">Time (IST)</th>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Event</th>
                <th scope="col">Job role</th>
                <th scope="col">Device</th>
                <th scope="col">Place</th>
              </tr>
            </thead>
            <tbody>
              {logData.items.map((r) => (
                <tr key={r.id}>
                  <td>{timeText(r.capturedAt)}</td>
                  <td>{r.userName ?? "—"}</td>
                  <td>{ROLE_LABEL[r.role] ?? r.role}</td>
                  <td>{r.type === "login" ? "Login" : "Logout"}</td>
                  <td>{r.qualification ?? "—"}</td>
                  <td>{r.platform ?? "—"}</td>
                  <td>{r.locationCaptured ? "Captured" : "Not captured"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}

      {view === "punch" && punch.data && punch.data.items.length === 0 ? (
        <p role="status">No punch records match.</p>
      ) : null}
      {view === "punch" && punch.data && punch.data.items.length > 0 ? (
        <>
          {punch.data.truncated ? (
            <p role="status">
              Showing the first records only. Narrow the search.
            </p>
          ) : null}
          <table>
            <caption className="visually-hidden">Punch details</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">First login</th>
                <th scope="col">Last logout</th>
                <th scope="col">Events</th>
              </tr>
            </thead>
            <tbody>
              {punch.data.items.map((r) => (
                <tr key={`${r.userId}-${r.batchId}-${r.date}`}>
                  <td>{r.date}</td>
                  <td>{r.userName ?? "—"}</td>
                  <td>{ROLE_LABEL[r.role] ?? r.role}</td>
                  <td>{timeText(r.firstLogin)}</td>
                  <td>{timeText(r.lastLogout)}</td>
                  <td>{r.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
