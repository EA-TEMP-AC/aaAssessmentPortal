import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import {
  QUESTION_STATUS_LABELS,
  QUESTION_TYPE_LABELS,
  approveQuestion,
  submitQuestionForReview,
  type Question,
} from "../../api/questionBank";
import type { Role } from "../../routing/access";
import { canApproveQuestions, canWriteQuestions } from "../../routing/access";
import { Dialog } from "../masterData/dialog";

export function QuestionDetail({
  question,
  role,
  where,
  onClose,
  onEdit,
  onChanged,
}: {
  question: Question;
  role: Role;
  /** Qualification, NOS and PC as readable text. */
  where: string;
  onClose: () => void;
  onEdit: (question: Question) => void;
  /** A status change was saved; the list should reload. */
  onChanged: (updated: Question, message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const editable = question.isLatest && question.status !== "retired";
  const canEdit = canWriteQuestions(role) && editable;
  const canSubmit = canWriteQuestions(role) && editable && question.status === "draft";
  const canApprove = canApproveQuestions(role) && editable && (question.status === "draft" || question.status === "in_review");

  async function run(action: () => Promise<Question>, message: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await action();
      if (mounted.current) onChanged(updated, message);
    } catch (failure) {
      if (!mounted.current) return;
      setPending(false);
      setError(errorMessage(failure));
    }
  }

  return (
    <Dialog title="Question" busy={pending} wide initialFocus="cancel" onCancel={onClose}>
      {error ? (
        <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <dl className="recognition-facts">
        <div>
          <dt>Where</dt>
          <dd>{where}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{QUESTION_TYPE_LABELS[question.type]}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{question.language}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {QUESTION_STATUS_LABELS[question.status]}, version {question.version}
            {question.isLatest ? "" : " (older version)"}
          </dd>
        </div>
        <div>
          <dt>Marks</dt>
          <dd>{question.marks}</dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>{question.difficulty ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Bloom level</dt>
          <dd>{question.bloomLevel ?? "Not set"}</dd>
        </div>
      </dl>
      <h3>Question text</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{question.stem}</p>
      {question.type === "mcq" ? (
        <>
          <h3>Options</h3>
          <ul>
            {question.options.map((option) => (
              <li key={option.key}>
                {option.key}. {option.text}
                {option.key === question.correctAnswer ? <strong> (correct answer)</strong> : null}
              </li>
            ))}
          </ul>
        </>
      ) : question.correctAnswer ? (
        <>
          <h3>Model answer or marking guide</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{question.correctAnswer}</p>
        </>
      ) : null}
      <div className="dialog-actions">
        <button type="button" data-dialog-cancel onClick={onClose} disabled={pending}>
          Close
        </button>
        {canEdit ? (
          <button type="button" onClick={() => onEdit(question)} disabled={pending}>
            Edit (new version)
          </button>
        ) : null}
        {canSubmit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => submitQuestionForReview(question.id), "The question was sent for review.")}
          >
            Submit for review
          </button>
        ) : null}
        {canApprove ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => approveQuestion(question.id), "The question was approved.")}
          >
            Approve
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
