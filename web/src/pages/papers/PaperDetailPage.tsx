import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { QUESTION_TYPE_LABELS } from "../../api/questionBank";
import {
  PAPER_ITEM_PAGE_SIZE,
  PAPER_STATUS_LABELS,
  approvePaper,
  getPaper,
  getPaperQuestions,
  paperTitle,
  returnPaper,
  shortageText,
  submitPaper,
  type TestPaper,
} from "../../api/testPapers";
import { canApprovePapers, canWriteQuestions } from "../../routing/access";
import { Dialog } from "../masterData/dialog";
import { nosLabel, nosOf, pcLabel, qualificationLabel, useQualifications } from "../questionBank/qualifications";

function staleText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== "TEST_PAPER_STALE") return null;
  const details = error.details as { stale?: unknown } | undefined;
  const count = Array.isArray(details?.stale) ? details.stale.length : 0;
  return count > 0 ? `${count} question(s) in this paper are no longer approved or are not the latest version.` : null;
}

function ReturnDialog({
  paperId,
  onCancel,
  onDone,
}: {
  paperId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const problemRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!reason.trim()) {
      setProblem("Give a reason for sending the paper back.");
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await returnPaper(paperId, reason.trim());
      if (mounted.current) onDone();
    } catch (error) {
      if (!mounted.current) return;
      setPending(false);
      setProblem(errorMessage(error));
    }
  }

  return (
    <Dialog title="Send paper back" busy={pending} onCancel={onCancel}>
      <form noValidate aria-label="Send paper back" onSubmit={(e) => void submit(e)}>
        {problem ? (
          <p ref={problemRef} tabIndex={-1} className="form-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="return-reason">Reason</label>
          <textarea
            id="return-reason"
            rows={4}
            maxLength={2000}
            value={reason}
            aria-invalid={problem && !reason.trim() ? true : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" data-dialog-cancel onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="submit" disabled={pending}>
            {pending ? "Sending back…" : "Send back"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Preview({ paper, nos }: { paper: TestPaper; nos: ReturnType<typeof nosOf> }) {
  const [page, setPage] = useState(1);
  const questions = useQuery({
    queryKey: ["papers", "questions", paper.id, page],
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: ({ signal }) => getPaperQuestions(paper.id, page, signal),
  });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const data = questions.data;
  const pages = data ? Math.max(1, Math.ceil(data.itemTotal / data.itemPageSize)) : 1;
  const offset = (page - 1) * PAPER_ITEM_PAGE_SIZE;

  return (
    <section aria-labelledby="preview-heading">
      <h2 id="preview-heading" ref={headingRef} tabIndex={-1}>
        Preview with answers
      </h2>
      {questions.isPending ? <p role="status">Loading questions…</p> : null}
      {questions.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(questions.error)}</p>
          <button type="button" onClick={() => void questions.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {data && data.items.length === 0 ? <p>This paper has no questions.</p> : null}
      {data && data.items.length > 0 ? (
        <>
          <p role="status">
            Questions {offset + 1} to {offset + data.items.length} of {data.itemTotal}.
          </p>
          <ol start={offset + 1}>
            {data.items.map((item) => (
              <li key={`${item.questionId}-${item.version}`}>
                <p style={{ whiteSpace: "pre-wrap" }}>{item.stem ?? "The question text is not available."}</p>
                <p className="field-hint">
                  {nosLabel(nos, item.nosId)} / {pcLabel(nos, item.nosId, item.pcId)}, {QUESTION_TYPE_LABELS[item.type]},{" "}
                  {item.marks} {item.marks === 1 ? "mark" : "marks"}
                </p>
                {item.options && item.options.length > 0 ? (
                  <ul>
                    {item.options.map((option) => (
                      <li key={option.key}>
                        {option.key}. {option.text}
                        {option.key === item.correctAnswer ? <strong> (correct answer)</strong> : null}
                      </li>
                    ))}
                  </ul>
                ) : item.correctAnswer ? (
                  <p>
                    <strong>Model answer:</strong> {item.correctAnswer}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          <nav className="master-pager" aria-label="Preview pages">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || questions.isFetching}>
              Previous page
            </button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || questions.isFetching}>
              Next page
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}

export function PaperDetailPage() {
  const session = useSession();
  const { id } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const qualifications = useQualifications(Boolean(session));
  const [showPreview, setShowPreview] = useState(false);
  const [returning, setReturning] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    (location.state as { created?: boolean } | null)?.created ? "The paper was generated as a draft." : null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const returnOpener = useRef<HTMLElement | null>(null);

  const paperQuery = useQuery({
    queryKey: ["papers", "one", id],
    enabled: Boolean(session && id),
    queryFn: ({ signal }) => getPaper(id ?? "", signal),
  });

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (actionError) errorRef.current?.focus();
  }, [actionError]);
  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    if (returning) {
      node.setAttribute("inert", "");
      return;
    }
    node.removeAttribute("inert");
    returnOpener.current?.focus();
  }, [returning]);

  const paper = paperQuery.data;
  const nos = useMemo(() => nosOf(qualifications.data, paper?.qualificationId ?? ""), [qualifications.data, paper]);

  if (!session || !id) return null;
  const role = session.user.role;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["papers"] });
  }

  async function act(action: () => Promise<TestPaper>, message: string) {
    if (pending) return;
    setPending(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (error) {
      const stale = staleText(error);
      setActionError(stale ? `${errorMessage(error)} ${stale}` : errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const title = paper ? paperTitle(paper, qualificationLabel(qualifications.data, paper.qualificationId)) : "Paper";
  const canSubmit = paper && canWriteQuestions(role) && paper.status === "draft" && paper.complete;
  const canReview = paper && canApprovePapers(role) && paper.status === "submitted";

  return (
    <>
      <div ref={pageRef} className="master-page">
        <p>
          <Link to="/papers">Back to papers</Link>
        </p>
        <h1>{title}</h1>
        {paperQuery.isPending ? <p role="status">Loading paper…</p> : null}
        {paperQuery.isError ? (
          <div className="form-error" role="alert">
            <p>{errorMessage(paperQuery.error)}</p>
            <button type="button" onClick={() => void paperQuery.refetch()}>
              Try again
            </button>
          </div>
        ) : null}
        {notice ? (
          <p ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {actionError ? (
          <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {paper ? (
          <>
            <dl className="recognition-facts">
              <div>
                <dt>Status</dt>
                <dd>{PAPER_STATUS_LABELS[paper.status]}</dd>
              </div>
              <div>
                <dt>Qualification</dt>
                <dd>{qualificationLabel(qualifications.data, paper.qualificationId)}</dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{paper.language}</dd>
              </div>
              <div>
                <dt>Questions</dt>
                <dd>{paper.itemCount ?? "Not known"}</dd>
              </div>
              <div>
                <dt>Total marks</dt>
                <dd>{paper.totalMarks}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{paper.durationMinutes ? `${paper.durationMinutes} minutes` : "Not set"}</dd>
              </div>
              <div>
                <dt>Seed</dt>
                <dd>{paper.seed}</dd>
              </div>
              <div>
                <dt>Weight profile</dt>
                <dd>{paper.weightProfile ? `Version ${paper.weightProfile.version}` : "None"}</dd>
              </div>
            </dl>
            {paper.returnReason && paper.status === "draft" ? (
              <p className="form-warning" role="status">
                Sent back by the reviewer: {paper.returnReason}
              </p>
            ) : null}
            {!paper.complete ? (
              <div className="form-warning" role="status">
                <p>This paper is incomplete and cannot be submitted or approved.</p>
                {paper.shortages.length > 0 ? (
                  <ul>
                    {paper.shortages.map((shortage, index) => (
                      <li key={index}>{shortageText(shortage)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <h2>Quotas</h2>
            <div className="table-scroll">
              <table className="master-table">
                <caption className="visually-hidden">Quotas of this paper</caption>
                <thead>
                  <tr>
                    <th scope="col">NOS</th>
                    <th scope="col">Type</th>
                    <th scope="col">Questions</th>
                  </tr>
                </thead>
                <tbody>
                  {paper.quotas.map((quota, index) => (
                    <tr key={index}>
                      <td>{nosLabel(nos, quota.nosId)}</td>
                      <td>{quota.type ? QUESTION_TYPE_LABELS[quota.type] : "Any type"}</td>
                      <td>{quota.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h2>Actions</h2>
            <div className="row-actions">
              {canSubmit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void act(() => submitPaper(paper.id), "The paper was submitted for approval.")}
                >
                  Submit for approval
                </button>
              ) : null}
              {canReview ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void act(() => approvePaper(paper.id), "The paper was approved.")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={(e) => {
                      returnOpener.current = e.currentTarget;
                      setReturning(true);
                    }}
                  >
                    Send back
                  </button>
                </>
              ) : null}
              {!showPreview ? (
                <button type="button" onClick={() => setShowPreview(true)}>
                  Show questions and answers
                </button>
              ) : null}
            </div>
            {!canSubmit && !canReview ? <p>No status change is available for your role and this paper.</p> : null}
            {!showPreview ? (
              <p className="field-hint">
                The preview shows question text and answers, 50 at a time, and counts against the daily content-read limit.
              </p>
            ) : (
              <Preview paper={paper} nos={nos} />
            )}
          </>
        ) : null}
      </div>
      {returning && paper ? (
        <ReturnDialog
          paperId={paper.id}
          onCancel={() => setReturning(false)}
          onDone={() => {
            setReturning(false);
            void refresh();
            setNotice("The paper was sent back to the author.");
          }}
        />
      ) : null}
    </>
  );
}
