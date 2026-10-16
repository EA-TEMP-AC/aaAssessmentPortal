import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import {
  EMPTY_QUESTION_FILTERS,
  QUESTION_STATUSES,
  QUESTION_STATUS_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  listQuestions,
  type Question,
  type QuestionFilters,
} from "../../api/questionBank";
import { canWriteQuestions } from "../../routing/access";
import { ImportDialog } from "./ImportDialog";
import { QuestionDetail } from "./QuestionDetail";
import { QuestionForm } from "./QuestionForm";
import { nosLabel, nosOf, pcLabel, qualificationLabel, useQualifications } from "./qualifications";

type Dialogs =
  | { kind: "none" }
  | { kind: "detail"; question: Question }
  | { kind: "form"; question: Question | null }
  | { kind: "import" };

const STEM_PREVIEW = 90;

function preview(stem: string): string {
  return stem.length > STEM_PREVIEW ? `${stem.slice(0, STEM_PREVIEW)}…` : stem;
}

export function QuestionBankPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<QuestionFilters>(EMPTY_QUESTION_FILTERS);
  const [applied, setApplied] = useState<QuestionFilters>(EMPTY_QUESTION_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialogs>({ kind: "none" });
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const noticeSeq = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const role = session?.user.role;
  const qualifications = useQualifications(Boolean(session));
  const list = useQuery({
    queryKey: ["question-bank", "list", applied, page],
    enabled: Boolean(session),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => listQuestions(applied, page, signal),
  });

  const nosChoices = useMemo(() => nosOf(qualifications.data, draft.qualification), [qualifications.data, draft.qualification]);
  const pcChoices = nosChoices.find((item) => item.nosId === draft.nos)?.pcs ?? [];

  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    if (dialog.kind !== "none") {
      node.setAttribute("inert", "");
      return;
    }
    node.removeAttribute("inert");
    if (notice) noticeRef.current?.focus();
    else openerRef.current?.focus();
  }, [dialog, notice]);

  if (!session || !role) return null;
  const writer = canWriteQuestions(role);

  function say(message: string) {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, message });
  }

  function open(next: Dialogs, event?: { currentTarget: HTMLElement }) {
    if (event) openerRef.current = event.currentTarget;
    setNotice(null);
    setDialog(next);
  }

  function reload() {
    void queryClient.invalidateQueries({ queryKey: ["question-bank", "list"] });
  }

  function whereOf(question: Question): string {
    const nos = nosOf(qualifications.data, question.qualificationId);
    return `${qualificationLabel(qualifications.data, question.qualificationId)}, NOS ${nosLabel(nos, question.nosId)}, PC ${pcLabel(nos, question.nosId, question.pcId)}`;
  }

  const result = list.data;
  const totalPages = result ? Math.max(1, result.totalPages) : 1;
  const filtered = Object.values(applied).some((value) => value.trim());

  let status: string | null = null;
  if (list.isPending) status = "Loading questions…";
  else if (result) {
    status =
      result.total === 0
        ? filtered
          ? "No questions match these filters."
          : "There are no questions yet."
        : `${result.total} ${result.total === 1 ? "question" : "questions"}. Page ${result.page} of ${totalPages}.`;
  }

  return (
    <>
      <div ref={pageRef} className="master-page">
        <h1>Question bank</h1>
        <p>
          Questions and answers are confidential. They are shown 50 at a time, there is no export, and every read is
          counted against a daily limit.
        </p>
        {notice ? (
          <p key={notice.id} ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
            {notice.message}
          </p>
        ) : null}
        {writer ? (
          <div className="row-actions">
            <button type="button" onClick={(e) => open({ kind: "form", question: null }, e)} disabled={!qualifications.data}>
              New question
            </button>
            <button type="button" onClick={(e) => open({ kind: "import" }, e)}>
              Import from Excel
            </button>
          </div>
        ) : null}
        <form
          role="search"
          aria-label="Filter questions"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(draft);
            setPage(1);
          }}
        >
          <div className="master-filters">
            <div className="field">
              <label htmlFor="qb-qualification">Qualification</label>
              <select
                id="qb-qualification"
                value={draft.qualification}
                onChange={(e) => setDraft({ ...draft, qualification: e.target.value, nos: "", pc: "" })}
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
              <label htmlFor="qb-nos">NOS</label>
              <select
                id="qb-nos"
                value={draft.nos}
                disabled={!draft.qualification}
                onChange={(e) => setDraft({ ...draft, nos: e.target.value, pc: "" })}
              >
                <option value="">All</option>
                {nosChoices.map((item) => (
                  <option key={item.nosId} value={item.nosId}>
                    {item.code} {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="qb-pc">PC</label>
              <select id="qb-pc" value={draft.pc} disabled={!draft.nos} onChange={(e) => setDraft({ ...draft, pc: e.target.value })}>
                <option value="">All</option>
                {pcChoices.map((item) => (
                  <option key={item.pcId} value={item.pcId}>
                    {item.code} {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="qb-type">Type</label>
              <select id="qb-type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                <option value="">All</option>
                {QUESTION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {QUESTION_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="qb-language">Language</label>
              <input
                id="qb-language"
                type="text"
                autoComplete="off"
                value={draft.language}
                onChange={(e) => setDraft({ ...draft, language: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="qb-status">Status</label>
              <select id="qb-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="">All</option>
                {QUESTION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {QUESTION_STATUS_LABELS[value]}
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
                setDraft(EMPTY_QUESTION_FILTERS);
                setApplied(EMPTY_QUESTION_FILTERS);
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        </form>

        {qualifications.isError ? (
          <p className="form-error" role="alert">
            The qualification list could not be loaded, so names show as ids. {errorMessage(qualifications.error)}
          </p>
        ) : null}
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
                <caption className="visually-hidden">Questions</caption>
                <thead>
                  <tr>
                    <th scope="col">Question</th>
                    <th scope="col">NOS / PC</th>
                    <th scope="col">Type</th>
                    <th scope="col">Language</th>
                    <th scope="col">Marks</th>
                    <th scope="col">Status</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((question) => {
                    const nos = nosOf(qualifications.data, question.qualificationId);
                    return (
                      <tr key={question.id}>
                        <td>{preview(question.stem)}</td>
                        <td>
                          {nosLabel(nos, question.nosId)} / {pcLabel(nos, question.nosId, question.pcId)}
                        </td>
                        <td>{QUESTION_TYPE_LABELS[question.type]}</td>
                        <td>{question.language}</td>
                        <td>{question.marks}</td>
                        <td>
                          {QUESTION_STATUS_LABELS[question.status]} (v{question.version})
                        </td>
                        <td>
                          <button type="button" onClick={(e) => open({ kind: "detail", question }, e)}>
                            Open <span className="visually-hidden">question {preview(question.stem)}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <nav className="master-pager" aria-label="Question pages">
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

      {dialog.kind === "detail" ? (
        <QuestionDetail
          question={dialog.question}
          role={role}
          where={whereOf(dialog.question)}
          onClose={() => setDialog({ kind: "none" })}
          onEdit={(question) => setDialog({ kind: "form", question })}
          onChanged={(_updated, message) => {
            reload();
            say(message);
            setDialog({ kind: "none" });
          }}
        />
      ) : null}
      {dialog.kind === "form" && qualifications.data ? (
        <QuestionForm
          question={dialog.question}
          qualifications={qualifications.data}
          onCancel={() => setDialog({ kind: "none" })}
          onSaved={(saved, created) => {
            reload();
            say(
              created
                ? "The question was created as a draft."
                : `Saved as version ${saved.version}. It is a draft and needs review again.`,
            );
            setDialog({ kind: "none" });
          }}
        />
      ) : null}
      {dialog.kind === "import" ? (
        <ImportDialog
          onCancel={() => setDialog({ kind: "none" })}
          onImported={() => {
            reload();
          }}
        />
      ) : null}
    </>
  );
}
