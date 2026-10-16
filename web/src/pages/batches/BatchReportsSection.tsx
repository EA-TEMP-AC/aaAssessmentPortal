import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { downloadMarksExcel, listBatchAttempts } from "../../api/attemptSheet";
import { errorMessage } from "../../api/client";
import { formatInstant } from "./sla";

const STATUS_TEXT: Record<string, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  timed_out: "Time ran out",
};

/**
 * X-09. For staff who may read attempts: the marks workbook for the batch and a link to each
 * candidate's answer sheet.
 */
export function BatchReportsSection({ batchId }: { batchId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["batch-attempts", batchId],
    queryFn: ({ signal }) => listBatchAttempts(batchId, signal),
  });

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadMarksExcel(batchId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `marks-${batchId}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="batch-reports-heading">
      <h2 id="batch-reports-heading">Reports</h2>
      <p>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Preparing the file…" : "Download marks (Excel)"}
        </button>
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <h3>Answer sheets</h3>
      {query.isPending ? <p role="status">Loading attempts…</p> : null}
      {query.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {query.data && query.data.length === 0 ? (
        <p>No candidate has started the exam yet.</p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <table>
          <caption className="visually-hidden">Attempts in this batch</caption>
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Status</th>
              <th scope="col">Started</th>
              <th scope="col">Marks</th>
              <th scope="col">Answer sheet</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.candidateName ?? "Name not available"}</th>
                <td>{STATUS_TEXT[row.status] ?? row.status}</td>
                <td>{formatInstant(row.startedAt)}</td>
                <td>
                  {row.obtainedMarks !== null && row.maxMarks !== null
                    ? `${row.obtainedMarks} of ${row.maxMarks}`
                    : "Not marked"}
                </td>
                <td>
                  <Link to={`/attempts/${row.id}/sheet`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
