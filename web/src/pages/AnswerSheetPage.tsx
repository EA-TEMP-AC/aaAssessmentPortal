import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  getAnswerSheet,
  spentText,
  type SheetQuestion,
} from "../api/attemptSheet";
import { errorMessage } from "../api/client";
import { formatInstant } from "./batches/sla";

function optionText(q: SheetQuestion, key: string | null): string {
  if (key === null) return "Not answered";
  if (q.type !== "mcq") return key;
  const option = q.options.find((o) => o.key === key);
  return option ? `${key}. ${option.text}` : key;
}

function Row({ q }: { q: SheetQuestion }) {
  const marked = q.awardedMarks !== null;
  return (
    <li className="sheet-question">
      <h3>
        Question {q.order}
        <span className="field-hint">
          {" "}
          ({q.marks} {q.marks === 1 ? "mark" : "marks"}
          {q.nosId ? `, ${q.nosId}` : ""})
        </span>
      </h3>
      <p>{q.stem}</p>
      <dl className="report-grid">
        <div>
          <dt>Candidate&apos;s answer</dt>
          <dd>{optionText(q, q.answer)}</dd>
        </div>
        {q.correctAnswer !== null ? (
          <div>
            <dt>Correct answer</dt>
            <dd>{optionText(q, q.correctAnswer)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Marks given</dt>
          <dd>
            {marked
              ? `${q.awardedMarks} of ${q.marks}`
              : q.scoreStatus === "pending"
                ? "Waiting to be marked"
                : "None"}
          </dd>
        </div>
        <div>
          <dt>Time on this question</dt>
          <dd>{spentText(q.secondsSpent)}</dd>
        </div>
        <div>
          <dt>Last saved</dt>
          <dd>{q.answeredAt ? formatInstant(q.answeredAt) : "Not answered"}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * X-09. One candidate's answer sheet for staff: every question, the answer given, the marks and
 * the time spent. The time is the gap since the answer before it was saved, so it is an estimate.
 */
export function AnswerSheetPage() {
  const { attemptId = "" } = useParams();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["answer-sheet", attemptId, page],
    enabled: attemptId !== "",
    queryFn: ({ signal }) => getAnswerSheet(attemptId, page, signal),
  });
  const data = query.data;
  const pages = data
    ? Math.max(1, Math.ceil(data.itemTotal / Math.max(1, data.itemPageSize)))
    : 1;
  return (
    <div className="report-sheet">
      <p className="no-print">
        <Link to="/batches">Back to batches</Link>
      </p>
      <h1>Answer sheet</h1>
      {query.isPending ? <p role="status">Loading answer sheet…</p> : null}
      {query.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(query.error)}</p>
          <button
            type="button"
            className="no-print"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          <button
            type="button"
            className="no-print"
            onClick={() => window.print()}
          >
            Print or save as PDF
          </button>
          <dl className="report-grid">
            <div>
              <dt>Candidate</dt>
              <dd>{data.candidateName ?? "Name not available"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{data.status.replace("_", " ")}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatInstant(data.startedAt)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{formatInstant(data.closedAt)}</dd>
            </div>
            <div>
              <dt>Marks</dt>
              <dd>
                {data.obtainedMarks !== null && data.maxMarks !== null
                  ? `${data.obtainedMarks} of ${data.maxMarks}${data.scoringComplete === false ? " (some answers still to be marked)" : ""}`
                  : "Not marked yet"}
              </dd>
            </div>
          </dl>
          {data.questions.length === 0 ? (
            <p>This attempt has no questions.</p>
          ) : (
            <ol
              className="sheet-questions"
              start={(data.itemPage - 1) * data.itemPageSize + 1}
            >
              {data.questions.map((q) => (
                <Row key={q.questionId} q={q} />
              ))}
            </ol>
          )}
          {pages > 1 ? (
            <nav className="no-print" aria-label="Answer sheet pages">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous questions
              </button>{" "}
              <span>
                Page {page} of {pages}
              </span>{" "}
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next questions
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
