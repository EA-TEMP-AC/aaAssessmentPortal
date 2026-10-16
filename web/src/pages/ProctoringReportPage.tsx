import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../api/client";
import {
  DECISION_LABELS,
  FLAG_TYPE_LABELS,
  SEVERITY_LABELS,
  getFlagCapture,
  getProctoringSession,
  type Flag,
} from "../api/proctoring";
import { EvidenceImage } from "./proctoring/EvidenceImage";
import { FlagCaptureDetails } from "./proctoring/FlagCaptureDetails";
import { formatTime } from "./proctoring/format";

const typeLabel = (type: string) => FLAG_TYPE_LABELS[type] ?? type;

function Entry({ flag, number }: { flag: Flag; number: number }) {
  return (
    <li className="report-flag">
      <h3>
        {number}. {typeLabel(flag.type)}
      </h3>
      <dl className="report-grid">
        <div>
          <dt>Time</dt>
          <dd>{formatTime(flag.capturedAt)}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{SEVERITY_LABELS[flag.severity]}</dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>
            {flag.review
              ? `${DECISION_LABELS[flag.review.decision]}${flag.review.note ? `. Note: ${flag.review.note}` : ""}`
              : "Not reviewed yet"}
          </dd>
        </div>
      </dl>
      <div className="proctor-flag-capture">
        {flag.evidenceId ? (
          <EvidenceImage
            evidenceId={flag.evidenceId}
            description={`${typeLabel(flag.type)} at ${formatTime(flag.capturedAt)}`}
            row={undefined}
            detailsState="loading"
            showMeta={false}
          />
        ) : (
          <p className="field-hint">No image for this flag</p>
        )}
        <FlagCaptureDetails flagId={flag.id} load={getFlagCapture} />
      </div>
    </li>
  );
}

/**
 * X-09. One candidate's proctoring record laid out for paper. "Print or save as PDF" opens the
 * browser's print box, where the candidate record can be saved as a PDF. The menu and buttons are
 * hidden when printing (see index.css).
 */
export function ProctoringReportPage() {
  const { sessionId = "" } = useParams();
  const query = useQuery({
    queryKey: ["proctoring-session", sessionId],
    enabled: sessionId !== "",
    queryFn: ({ signal }) => getProctoringSession(sessionId, signal),
  });
  const data = query.data;
  return (
    <div className="report-sheet">
      <p className="no-print">
        <Link to="/proctoring">Back to proctoring</Link>
      </p>
      <h1>Proctoring report</h1>
      {query.isPending ? <p role="status">Loading report…</p> : null}
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
              <dt>Started</dt>
              <dd>{formatTime(data.startedAt)}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{formatTime(data.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Flags</dt>
              <dd>
                {data.flagCounts.high} high, {data.flagCounts.medium} medium,{" "}
                {data.flagCounts.low} low
              </dd>
            </div>
            <div>
              <dt>Still to review</dt>
              <dd>{data.unreviewedCount}</dd>
            </div>
            <div>
              <dt>Warnings sent</dt>
              <dd>{data.warnings.length}</dd>
            </div>
            <div>
              <dt>Invalidation recommended</dt>
              <dd>{data.invalidationRecommended ? "Yes" : "No"}</dd>
            </div>
          </dl>
          <p className="field-hint">
            Flags record what the candidate&apos;s browser saw. A person reviews
            every flag. Nothing is decided automatically.
          </p>
          <h2>Flags in time order</h2>
          {data.flags.length === 0 ? (
            <p>No flags in this session.</p>
          ) : (
            <ol className="report-flags">
              {data.flags.map((flag, index) => (
                <Entry key={flag.id} flag={flag} number={index + 1} />
              ))}
            </ol>
          )}
        </>
      ) : null}
    </div>
  );
}
