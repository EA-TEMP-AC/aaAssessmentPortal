import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { SECTOR_NAMES } from "../api/annexure";
import { errorMessage } from "../api/client";
import {
  searchMailBatches,
  sendBatchMails,
  type MailFilters,
  type MailRecipient,
} from "../api/dashboard";

const EMPTY: MailFilters = {
  sector: "",
  batchId: "",
  from: "",
  to: "",
  assessorStatus: "",
  tpStatus: "",
};
const REASON: Record<string, string> = {
  past_date: "date has passed",
  not_found: "batch not found",
  no_training_partner_email: "no training partner email",
  no_assessor_email: "no assessor email",
  queue_failed: "could not be queued",
};

/** X-49. Search batches that are still to come, then queue notice mails. */
export function BatchMailsPage() {
  const [draft, setDraft] = useState<MailFilters>(EMPTY);
  const [filters, setFilters] = useState<MailFilters>(EMPTY);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<MailRecipient[]>([
    "training_partner",
    "assessor",
  ]);
  const query = useQuery({
    queryKey: ["batch-mails", filters, page],
    queryFn: ({ signal }) => searchMailBatches({ ...filters, page }, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const send = useMutation({
    mutationFn: () => sendBatchMails(picked, recipients),
    onSuccess: () => setPicked([]),
  });
  const set = (key: keyof MailFilters) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleRecipient = (r: MailRecipient) =>
    setRecipients((list) =>
      list.includes(r) ? list.filter((x) => x !== r) : [...list, r],
    );

  return (
    <div>
      <h1>Batch mails</h1>
      <p className="field-hint">
        Send a notice to the training partner (the mail names the centre) and
        the assessor. Only batches that have not started yet are listed.
      </p>
      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setPicked([]);
          setFilters(draft);
        }}
      >
        <div className="field">
          <label htmlFor="bm-sector">Sector</label>
          <select
            id="bm-sector"
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
          <label htmlFor="bm-batch">Batch Id</label>
          <input
            id="bm-batch"
            value={draft.batchId}
            onChange={(e) => set("batchId")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="bm-from">From</label>
          <input
            id="bm-from"
            type="date"
            value={draft.from}
            onChange={(e) => set("from")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="bm-to">To</label>
          <input
            id="bm-to"
            type="date"
            value={draft.to}
            onChange={(e) => set("to")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="bm-assessor">Assessor status</label>
          <select
            id="bm-assessor"
            value={draft.assessorStatus}
            onChange={(e) => set("assessorStatus")(e.target.value)}
          >
            <option value="">All</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Not assigned</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bm-tp">Training partner status</label>
          <select
            id="bm-tp"
            value={draft.tpStatus}
            onChange={(e) => set("tpStatus")(e.target.value)}
          >
            <option value="">All</option>
            <option value="pending">Not accepted yet</option>
            <option value="accepted">Accepted</option>
          </select>
        </div>
        <button type="submit">Search</button>
      </form>

      {query.isLoading ? <p role="status">Loading batches…</p> : null}
      {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
      {data && data.items.length === 0 ? (
        <p role="status">No upcoming batches match.</p>
      ) : null}
      {data && data.items.length > 0 ? (
        <>
          <table>
            <caption className="visually-hidden">Upcoming batches</caption>
            <thead>
              <tr>
                <th scope="col">Send</th>
                <th scope="col">Date</th>
                <th scope="col">Job role</th>
                <th scope="col">Centre</th>
                <th scope="col">Training partner</th>
                <th scope="col">Assessor</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select batch ${b.id}`}
                      checked={picked.includes(b.id)}
                      onChange={() => toggle(b.id)}
                    />
                  </td>
                  <td>{b.assessmentStartDate}</td>
                  <td>{b.qualification ?? "—"}</td>
                  <td>{b.centreName ?? "—"}</td>
                  <td>
                    {b.tpName ?? "—"} (
                    {b.tpAccepted ? "accepted" : "not accepted"})
                  </td>
                  <td>{b.assessorName ?? "Not assigned"}</td>
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
          <fieldset>
            <legend>Send to</legend>
            <label>
              <input
                type="checkbox"
                checked={recipients.includes("training_partner")}
                onChange={() => toggleRecipient("training_partner")}
              />{" "}
              Training partner and centre
            </label>{" "}
            <label>
              <input
                type="checkbox"
                checked={recipients.includes("assessor")}
                onChange={() => toggleRecipient("assessor")}
              />{" "}
              Assessor
            </label>
          </fieldset>
          <button
            type="button"
            disabled={
              picked.length === 0 || recipients.length === 0 || send.isPending
            }
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : `Send mails (${picked.length})`}
          </button>
        </>
      ) : null}
      {send.isError ? <p role="alert">{errorMessage(send.error)}</p> : null}
      {send.data ? (
        <div role="status">
          <p>{send.data.queued} mail(s) queued.</p>
          {send.data.skipped.length > 0 ? (
            <ul>
              {send.data.skipped.map((s, i) => (
                <li key={`${s.batchId}-${i}`}>
                  Batch {s.batchId} skipped: {REASON[s.reason] ?? s.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
