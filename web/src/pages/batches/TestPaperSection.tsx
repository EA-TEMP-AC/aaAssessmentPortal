import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, errorMessage } from "../../api/client";
import type { BatchRecord } from "../../api/batches";
import { PAPER_STATUS_LABELS, getPaper, listPapers, paperTitle, setBatchTestPaper } from "../../api/testPapers";
import { QUESTION_BANK_ROLES, canAssignBatchPaper, type Role } from "../../routing/access";
import { sameLanguage } from "./paperLanguage";

/**
 * D5: the one test paper candidates of a batch can start. aa_admin picks an approved, complete
 * paper of the batch's qualification and language. The server refuses a change once any attempt
 * exists (BATCH_TEST_PAPER_LOCKED); the page then shows the paper as fixed.
 */
export function TestPaperSection({ batch, role }: { batch: BatchRecord; role: Role }) {
  const queryClient = useQueryClient();
  const canAssign = canAssignBatchPaper(role);
  const canReadPapers = QUESTION_BANK_ROLES.includes(role);
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const selectId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const assigned = useQuery({
    queryKey: ["papers", "one", batch.testPaperId],
    enabled: canReadPapers && Boolean(batch.testPaperId),
    queryFn: ({ signal }) => getPaper(batch.testPaperId ?? "", signal),
  });

  const approved = useQuery({
    queryKey: ["papers", "approved-for", batch.qualificationId],
    enabled: canAssign,
    queryFn: ({ signal }) =>
      listPapers({ qualificationId: batch.qualificationId, status: "approved", page: 1, pageSize: 100 }, signal),
  });

  const choices = (approved.data?.items ?? []).filter(
    (paper) => paper.complete && sameLanguage(paper.language, batch.assessmentLanguage),
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!choice) {
      setError("Choose a paper first.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await setBatchTestPaper(batch.id, choice);
      await queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
      if (!mounted.current) return;
      setChoice("");
      setNotice("The test paper was set for this batch.");
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.code === "BATCH_TEST_PAPER_LOCKED") setLocked(true);
      setError(errorMessage(failure));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  let current = "";
  if (!batch.testPaperId) current = "No test paper is set. Candidates cannot start an exam until one is.";
  else if (!canReadPapers) current = "A test paper is set.";
  else if (assigned.isPending) current = "Loading the paper…";

  return (
    <section aria-labelledby="batch-paper-heading">
      <h2 id="batch-paper-heading">Test paper</h2>
      {current ? <p role="status">{current}</p> : null}
      {assigned.data ? (
        <p>
          <strong>{paperTitle(assigned.data)}</strong> ({PAPER_STATUS_LABELS[assigned.data.status]},{" "}
          {assigned.data.totalMarks} marks) <Link to={`/papers/${assigned.data.id}`}>Open paper</Link>
        </p>
      ) : null}
      {assigned.isError ? (
        <p className="form-error" role="alert">
          A test paper is set, but its details could not be loaded. {errorMessage(assigned.error)}
        </p>
      ) : null}
      {notice ? (
        <p ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {canAssign && locked ? <p>The paper is fixed because a candidate has started an attempt on this batch.</p> : null}
      {canAssign && !locked ? (
        <form noValidate aria-label="Set test paper" onSubmit={(e) => void save(e)}>
          <div className="field">
            <label htmlFor={selectId}>{batch.testPaperId ? "Change the test paper" : "Choose the test paper"}</label>
            <select id={selectId} value={choice} disabled={approved.isPending} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose an approved paper</option>
              {choices.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paperTitle(paper)} ({paper.totalMarks} marks)
                </option>
              ))}
            </select>
            <p className="field-hint">
              Only approved, complete papers for this qualification in {batch.assessmentLanguage} are listed. The paper
              cannot be changed after a candidate has started an attempt.
            </p>
          </div>
          {approved.isPending ? <p role="status">Loading approved papers…</p> : null}
          {approved.isError ? (
            <p className="form-error" role="alert">
              {errorMessage(approved.error)}
            </p>
          ) : null}
          {approved.data && choices.length === 0 ? (
            <p role="status">
              There is no approved paper for this qualification and language yet. <Link to="/papers">Go to papers</Link>.
            </p>
          ) : null}
          <button type="submit" disabled={pending || choices.length === 0}>
            {pending ? "Saving…" : "Set test paper"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
