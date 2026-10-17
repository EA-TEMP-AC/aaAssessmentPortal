import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../../api/client";
import type { BatchRecord } from "../../api/batches";
import { getBatchSettings } from "../../api/batchSettings";
import {
  listPapers,
  paperTitle,
  setBatchLanguagePapers,
} from "../../api/testPapers";
import { canAssignBatchPaper, type Role } from "../../routing/access";
import { sameLanguage } from "./paperLanguage";

/**
 * X-33: one more paper for each extra language. The candidate picks the language when the exam
 * starts and takes that paper only. Needs the "theory languages" switch in the batch settings.
 * The server refuses a change once a candidate has started (BATCH_TEST_PAPER_LOCKED).
 */
export function LanguagePapersSection({
  batch,
  role,
}: {
  batch: BatchRecord;
  role: Role;
}) {
  const queryClient = useQueryClient();
  const canAssign = canAssignBatchPaper(role);
  const [language, setLanguage] = useState("");
  const [paperId, setPaperId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const languageId = useId();
  const paperSelectId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const settings = useQuery({
    queryKey: ["batch-settings", batch.id],
    enabled: canAssign,
    queryFn: ({ signal }) => getBatchSettings(batch.id, signal),
  });
  const approved = useQuery({
    queryKey: ["papers", "approved-for", batch.qualificationId],
    enabled: canAssign,
    queryFn: ({ signal }) =>
      listPapers(
        {
          qualificationId: batch.qualificationId,
          status: "approved",
          page: 1,
          pageSize: 100,
        },
        signal,
      ),
  });

  const current = batch.languagePapers ?? [];
  const choices = (approved.data?.items ?? []).filter(
    (paper) =>
      paper.complete &&
      paper.id !== batch.testPaperId &&
      !sameLanguage(paper.language, batch.assessmentLanguage) &&
      !current.some((entry) => entry.testPaperId === paper.id),
  );
  const titleOf = (id: string) => {
    const paper = approved.data?.items.find((p) => p.id === id);
    return paper ? paperTitle(paper) : "Paper";
  };

  async function save(next: { language: string; testPaperId: string }[]) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await setBatchLanguagePapers(batch.id, next);
      await queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
      if (!mounted.current) return;
      setLanguage("");
      setPaperId("");
    } catch (failure) {
      if (!mounted.current) return;
      if (
        failure instanceof ApiError &&
        failure.code === "BATCH_TEST_PAPER_LOCKED"
      )
        setLocked(true);
      setError(errorMessage(failure));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    if (!language.trim() || !paperId) {
      setError("Write the language and choose its paper.");
      return;
    }
    void save([
      ...current,
      { language: language.trim(), testPaperId: paperId },
    ]);
  }

  const switchOn = settings.data?.languages.theory === true;
  if (!canAssign && current.length === 0) return null;

  return (
    <section aria-labelledby="batch-lang-papers-heading">
      <h2 id="batch-lang-papers-heading">Papers in other languages</h2>
      {current.length === 0 ? (
        <p role="status">No other language. Candidates take the paper above.</p>
      ) : (
        <ul>
          {current.map((entry) => (
            <li key={entry.testPaperId}>
              {entry.language}: {titleOf(entry.testPaperId)}{" "}
              {canAssign && !locked ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void save(
                      current.filter(
                        (e) => e.testPaperId !== entry.testPaperId,
                      ),
                    )
                  }
                >
                  Remove
                  <span className="visually-hidden"> {entry.language}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {canAssign && locked ? (
        <p>
          The papers are fixed because a candidate has started an attempt on
          this batch.
        </p>
      ) : null}
      {canAssign && !locked && settings.data && !switchOn ? (
        <p role="status">
          To offer more than one language, turn on &quot;Theory&quot; under
          &quot;More than one language&quot; in the batch settings first.
        </p>
      ) : null}
      {canAssign && !locked && switchOn ? (
        <form noValidate aria-label="Add a language paper" onSubmit={add}>
          <div className="field">
            <label htmlFor={languageId}>Language</label>
            <input
              id={languageId}
              value={language}
              maxLength={80}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={paperSelectId}>Paper in that language</label>
            <select
              id={paperSelectId}
              value={paperId}
              onChange={(e) => setPaperId(e.target.value)}
            >
              <option value="">Choose an approved paper</option>
              {choices.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paperTitle(paper)} ({paper.totalMarks} marks)
                </option>
              ))}
            </select>
            <p className="field-hint">
              The candidate picks the language when the exam starts and takes
              that paper only. The papers cannot be changed after a candidate
              has started.
            </p>
          </div>
          <button type="submit" disabled={pending || approved.isPending}>
            {pending ? "Saving…" : "Add language paper"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
