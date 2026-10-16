import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getBatch, type BatchRecord } from "../../api/batches";
import { errorMessage } from "../../api/client";
import { getProject, getScheme } from "../../api/schemes";
import { useSession } from "../../api/session";
import { SCHEME_READ_ROLES } from "../../routing/access";
import { SCHEME_DATA_KEY } from "../schemes/schemeData";
import { visibleBatchActions, type BatchAction } from "./access";
import { ActionDialog } from "./ActionDialog";
import { BATCH_ACTION_LABELS, BATCH_STATUS_LABELS } from "./labels";
import { formatInstant } from "./sla";
import { SlaTimeline } from "./SlaCountdown";
import { StatusBadge } from "./StatusBadge";
import { useNow } from "./useNow";
import { CandidateRoster } from "./CandidateRoster";
import { ResultSection } from "./ResultSection";
import { canSeeResultSection } from "./resultMarks";

type Banner = { id: number; message: string };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function display(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "None";
}

export function BatchDetailPage() {
  const session = useSession();
  const { id } = useParams();
  const now = useNow();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<BatchAction | null>(null);
  const [notice, setNotice] = useState<Banner | null>(null);
  const [warnings, setWarnings] = useState<Banner | null>(null);
  const [actionError, setActionError] = useState<Banner | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const warningRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const bannerSeq = useRef(0);

  const batchQuery = useQuery({
    queryKey: ["batch", id],
    enabled: Boolean(session && id),
    queryFn: ({ signal }) => getBatch(id ?? "", signal),
  });

  // Names only for roles that may read schemes. Everyone else sees the stored id.
  const canReadSchemes = session ? SCHEME_READ_ROLES.includes(session.user.role) : false;
  const schemeId = batchQuery.data?.schemeId ?? null;
  const projectId = batchQuery.data?.projectId ?? null;
  const schemeQuery = useQuery({
    queryKey: [SCHEME_DATA_KEY, "scheme", schemeId],
    enabled: canReadSchemes && Boolean(schemeId),
    queryFn: ({ signal }) => getScheme(schemeId ?? "", signal),
  });
  const projectQuery = useQuery({
    queryKey: [SCHEME_DATA_KEY, "project", projectId],
    enabled: canReadSchemes && Boolean(projectId),
    queryFn: ({ signal }) => getProject(projectId ?? "", signal),
  });

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    if (action) {
      node.setAttribute("inert", "");
      return;
    }
    node.removeAttribute("inert");
    if (restoreFocus.current) {
      const target = restoreFocus.current;
      restoreFocus.current = null;
      target.focus();
      return;
    }
    if (notice) noticeRef.current?.focus();
    else if (warnings) warningRef.current?.focus();
    else if (actionError) errorRef.current?.focus();
  }, [action, notice, warnings, actionError]);

  if (!session || !id) return null;

  const batch = batchQuery.data;
  const allowed = batch ? visibleBatchActions(session.user.role, batch.status) : [];

  function openAction(event: MouseEvent<HTMLButtonElement>, next: BatchAction) {
    openerRef.current = event.currentTarget;
    restoreFocus.current = null;
    setNotice(null);
    setWarnings(null);
    setActionError(null);
    setAction(next);
  }

  function cancelAction() {
    restoreFocus.current = openerRef.current;
    setAction(null);
  }

  function handleSaved(message: string, nextWarnings?: BatchRecord["warnings"]) {
    restoreFocus.current = null;
    setActionError(null);
    setNotice({ id: ++bannerSeq.current, message });
    setWarnings(
      nextWarnings && nextWarnings.length > 0
        ? {
            id: ++bannerSeq.current,
            message: nextWarnings.map((item) => item.message).join(" "),
          }
        : null,
    );
    setAction(null);
    void queryClient.invalidateQueries({ queryKey: ["batch", id] });
    void queryClient.invalidateQueries({ queryKey: ["batches"] });
  }

  return (
    <div className="batch-detail">
      <div ref={pageRef}>
        <p>
          <Link to="/batches">Back to batches</Link>
        </p>
        <h1>Batch {id}</h1>
        {batchQuery.isError ? (
          <p className="form-error" role="alert">
            {errorMessage(batchQuery.error)}
          </p>
        ) : null}
        {batchQuery.isFetching && !batch ? <p role="status">Loading batch.</p> : null}
        {notice ? (
          <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
            {notice.message} Status is now {batch ? BATCH_STATUS_LABELS[batch.status] : ""}.
          </p>
        ) : null}
        {warnings ? (
          <div key={warnings.id} ref={warningRef} tabIndex={-1} className="form-warning" role="status">
            <p>Assignment warning: {warnings.message}</p>
          </div>
        ) : null}
        {actionError ? (
          <p key={actionError.id} ref={errorRef} tabIndex={-1} className="form-error" role="alert">
            {actionError.message}
          </p>
        ) : null}
        {batch ? (
          <>
            <p>
              <StatusBadge status={batch.status} /> Version {batch.statusVersion}.
            </p>
            <dl className="batch-facts">
              <Fact label="Awarding body" value={batch.abId} />
              <Fact label="Qualification" value={batch.qualificationId} />
              <Fact label="Type" value={batch.type} />
              <Fact label="Mode" value={batch.mode} />
              <Fact label="Assessment start" value={batch.assessmentStartDate} />
              <Fact label="Assessment end" value={batch.assessmentEndDate} />
              <Fact label="Training partner" value={batch.tpId} />
              <Fact label="Centre" value={batch.centreId} />
              <Fact
                label="Scheme"
                value={schemeId ? (schemeQuery.data ? `${schemeQuery.data.name} (${schemeQuery.data.code})` : schemeId) : "None"}
              />
              <Fact
                label="Project"
                value={projectId ? (projectQuery.data ? `${projectQuery.data.name} (${projectQuery.data.code})` : projectId) : "None"}
              />
              <Fact label="Candidate count" value={String(batch.candidateCount)} />
              <Fact label="Sector" value={batch.sector} />
              <Fact label="Ratio class" value={batch.ratioClass} />
              <Fact label="Assessment language" value={batch.assessmentLanguage} />
              <Fact label="State" value={batch.state} />
              <Fact label="Assessor" value={display(batch.assessorId)} />
              <Fact label="Proctor" value={display(batch.proctorId)} />
              <Fact label="Result" value={display(batch.resultId)} />
              <Fact label="Reassessment" value={batch.isReassessment ? "Yes" : "No"} />
              <Fact label="Reassessment of" value={display(batch.reassessmentOf)} />
              <Fact label="First assessment batch" value={display(batch.firstAssessmentBatchId)} />
              <Fact label="Reject reason" value={display(batch.rejectReason)} />
              <Fact label="Cancel reason" value={display(batch.cancelReason)} />
              <Fact label="Allocated at" value={formatInstant(batch.allocatedAt)} />
              <Fact label="Accepted at" value={formatInstant(batch.acceptedAt)} />
              <Fact label="Assigned at" value={formatInstant(batch.assignedAt)} />
              <Fact label="Cancelled at" value={formatInstant(batch.cancelledAt)} />
              <Fact label="Created at" value={formatInstant(batch.createdAt)} />
              <Fact label="Updated at" value={formatInstant(batch.updatedAt)} />
              <Fact
                label="Accommodations"
                value={batch.accommodations.length > 0 ? batch.accommodations.join(", ") : "None"}
              />
              <Fact
                label="Recognition override"
                value={
                  batch.recognitionOverride
                    ? `${batch.recognitionOverride.reason} (${batch.recognitionOverride.checks.join(", ") || "no checks"})`
                    : "None"
                }
              />
              <Fact label="Ratio override" value={batch.ratioOverride ? batch.ratioOverride.reason : "None"} />
              <Fact label="Learner feedback" value="Not recorded" />
            </dl>
            <h2>SLA timeline</h2>
            <SlaTimeline batch={batch} now={now} />
            {batch.sla.lateActions.length > 0 ? (
              <>
                <h3>Late actions</h3>
                <ul>
                  {batch.sla.lateActions.map((row, index) => (
                    <li key={`${row.key}-${row.at}-${index}`}>
                      {row.key}: {row.reason} at {formatInstant(row.at)}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {batch.statusHistory && batch.statusHistory.length > 0 ? (
              <>
                <h2>Status history</h2>
                <ol>
                  {batch.statusHistory.map((entry, index) => (
                    <li key={`${entry.at ?? "row"}-${index}`}>
                      {entry.action ? `${entry.action}: ` : ""}
                      {entry.status ?? "status change"}
                      {entry.at ? ` at ${formatInstant(entry.at)}` : ""}
                      {entry.note ? `. ${entry.note}` : ""}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            <h2>Actions</h2>
            {allowed.length === 0 ? (
              <p>No status changes are available for this role and status.</p>
            ) : (
              <div className="row-actions">
                {allowed.map((item) => (
                  <button key={item} type="button" onClick={(event) => openAction(event, item)}>
                    {BATCH_ACTION_LABELS[item]}
                  </button>
                ))}
              </div>
            )}
            {session.user.role === "aa_admin" ? (
              <>
                <h2>Settings</h2>
                <p>
                  <Link to={`/batches/${batch.id}/settings`}>Batch settings</Link>: shuffling, marks shown to the
                  candidate, flags, camera images, the candidate pop-up and location.
                </p>
              </>
            ) : null}
            <CandidateRoster batch={batch} role={session.user.role} />
            {canSeeResultSection(session.user.role) ? (
              <ResultSection batch={batch} role={session.user.role} />
            ) : null}
          </>
        ) : null}
      </div>
      {action && batch ? (
        <ActionDialog
          action={action}
          batch={batch}
          canOverride={session.user.role === "aa_admin"}
          onCancel={cancelAction}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
