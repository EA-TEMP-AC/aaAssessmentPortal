import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { PAPER_STATUSES, PAPER_STATUS_LABELS, listPapers, paperTitle } from "../../api/testPapers";
import { canWriteQuestions } from "../../routing/access";
import { qualificationLabel, useQualifications } from "../questionBank/qualifications";

const PAGE_SIZE = 20;

export function PaperListPage() {
  const session = useSession();
  const [draft, setDraft] = useState({ qualificationId: "", status: "" });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);
  const qualifications = useQualifications(Boolean(session));
  const list = useQuery({
    queryKey: ["papers", "list", applied, page],
    enabled: Boolean(session),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => listPapers({ ...applied, page, pageSize: PAGE_SIZE }, signal),
  });

  if (!session) return null;
  const result = list.data;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const filtered = Boolean(applied.qualificationId || applied.status);

  let status: string | null = null;
  if (list.isPending) status = "Loading papers…";
  else if (result) {
    status =
      result.total === 0
        ? filtered
          ? "No papers match these filters."
          : "There are no test papers yet."
        : `${result.total} ${result.total === 1 ? "paper" : "papers"}. Page ${result.page} of ${totalPages}.`;
  }

  return (
    <div className="master-page">
      <h1>Papers</h1>
      <p>
        Papers are built from approved questions. An awarding body reviewer approves a paper before it can be given to a
        batch.
      </p>
      {canWriteQuestions(session.user.role) ? (
        <p>
          <Link to="/papers/new">Create paper</Link>
        </p>
      ) : null}
      <form
        role="search"
        aria-label="Filter papers"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft);
          setPage(1);
        }}
      >
        <div className="master-filters">
          <div className="field">
            <label htmlFor="paper-qualification">Qualification</label>
            <select
              id="paper-qualification"
              value={draft.qualificationId}
              onChange={(e) => setDraft({ ...draft, qualificationId: e.target.value })}
            >
              <option value="">All</option>
              {(qualifications.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="paper-status">Status</label>
            <select id="paper-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">All</option>
              {PAPER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PAPER_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="master-filter-actions">
          <button type="submit">Apply filters</button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              const empty = { qualificationId: "", status: "" };
              setDraft(empty);
              setApplied(empty);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      </form>
      {list.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(list.error)}</p>
          <button type="button" onClick={() => void list.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {status ? (
        <p className="master-summary" role="status">
          {status}
        </p>
      ) : null}
      {result && result.items.length > 0 ? (
        <>
          <div className="table-scroll">
            <table className="master-table" aria-busy={list.isFetching}>
              <caption className="visually-hidden">Test papers</caption>
              <thead>
                <tr>
                  <th scope="col">Paper</th>
                  <th scope="col">Qualification</th>
                  <th scope="col">Language</th>
                  <th scope="col">Total marks</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((paper) => {
                  const qualification = qualificationLabel(qualifications.data, paper.qualificationId);
                  return (
                    <tr key={paper.id}>
                      <th scope="row">
                        <Link to={`/papers/${paper.id}`}>{paperTitle(paper, qualification)}</Link>
                      </th>
                      <td>{qualification}</td>
                      <td>{paper.language}</td>
                      <td>{paper.totalMarks}</td>
                      <td>
                        {PAPER_STATUS_LABELS[paper.status]}
                        {paper.complete ? "" : " (incomplete)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="master-pager" aria-label="Paper pages">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || list.isFetching}>
              Previous page
            </button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages || list.isFetching}>
              Next page
            </button>
          </nav>
        </>
      ) : null}
    </div>
  );
}
