import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { QuestionImagesField } from "./QuestionImagesField";
import type { Qualification } from "../../api/masterData";
import { errorMessage } from "../../api/client";
import {
  BLOOM_LEVELS,
  DIFFICULTIES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  createQuestion,
  updateQuestion,
  type Question,
  type QuestionType,
} from "../../api/questionBank";
import { Dialog } from "../masterData/dialog";
import {
  ORDER,
  OPTION_KEYS,
  buildWrite,
  initialDraft,
  validateDraft,
  type Draft,
  type Errors,
} from "./questionDraft";

export function QuestionForm({
  question,
  qualifications,
  onCancel,
  onSaved,
}: {
  question: Question | null;
  qualifications: readonly Qualification[];
  onCancel: () => void;
  onSaved: (saved: Question, created: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(question, qualifications));
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const serverRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const baseId = useId();
  const id = (name: string) => `${baseId}-${name}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (serverError) serverRef.current?.focus();
  }, [serverError]);

  const nosList = qualifications.find((item) => item.id === draft.qualificationId)?.nos ?? [];
  const pcList = nosList.find((item) => item.nosId === draft.nosId)?.pcs ?? [];
  const mcq = draft.type === "mcq";

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function invalid(name: keyof Draft) {
    return errors[name] ? { "aria-invalid": true, "aria-describedby": id(`${name}-error`) } : {};
  }

  function fieldError(name: keyof Draft) {
    const message = errors[name];
    return message ? (
      <p id={id(`${name}-error`)} className="form-error" role="alert">
        {message}
      </p>
    ) : null;
  }

  function addOption() {
    const used = new Set(draft.options.map((option) => option.key));
    const key = OPTION_KEYS.find((candidate) => !used.has(candidate));
    if (key) patch({ options: [...draft.options, { key, text: "" }] });
  }

  function removeOption(key: string) {
    patch({
      options: draft.options.filter((option) => option.key !== key),
      correctAnswer: draft.correctAnswer === key ? "" : draft.correctAnswer,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found = validateDraft(draft);
    setErrors(found);
    setServerError(null);
    const first = ORDER.find((name) => found[name]);
    if (first) {
      window.setTimeout(() => {
        const target =
          first === "options"
            ? formRef.current?.querySelector<HTMLElement>(`[data-options-first]`)
            : formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`);
        target?.focus();
      }, 0);
      return;
    }
    setPending(true);
    try {
      const body = buildWrite(draft);
      const saved = question ? await updateQuestion(question.id, body) : await createQuestion(body);
      if (mounted.current) onSaved(saved, !question);
    } catch (error) {
      if (!mounted.current) return;
      setPending(false);
      setServerError(errorMessage(error));
    }
  }

  return (
    <Dialog title={question ? "Edit question" : "New question"} busy={pending} wide onCancel={onCancel}>
      {question ? (
        <p>Saving creates version {question.version + 1} as a draft. Version {question.version} is kept.</p>
      ) : null}
      <form ref={formRef} noValidate aria-label={question ? "Edit question" : "New question"} onSubmit={(e) => void submit(e)}>
        {serverError ? (
          <p ref={serverRef} tabIndex={-1} className="form-error" role="alert">
            {serverError}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={id("qualificationId")}>Qualification</label>
          <select
            id={id("qualificationId")}
            name="qualificationId"
            value={draft.qualificationId}
            onChange={(e) => patch({ qualificationId: e.target.value, nosId: "", pcId: "" })}
            {...invalid("qualificationId")}
          >
            <option value="">Choose a qualification</option>
            {qualifications.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
          {fieldError("qualificationId")}
        </div>
        <div className="field">
          <label htmlFor={id("nosId")}>NOS</label>
          <select
            id={id("nosId")}
            name="nosId"
            value={draft.nosId}
            disabled={!draft.qualificationId}
            onChange={(e) => patch({ nosId: e.target.value, pcId: "" })}
            {...invalid("nosId")}
          >
            <option value="">Choose a NOS</option>
            {nosList.map((item) => (
              <option key={item.nosId} value={item.nosId}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
          {fieldError("nosId")}
        </div>
        <div className="field">
          <label htmlFor={id("pcId")}>PC</label>
          <select
            id={id("pcId")}
            name="pcId"
            value={draft.pcId}
            disabled={!draft.nosId}
            onChange={(e) => patch({ pcId: e.target.value })}
            {...invalid("pcId")}
          >
            <option value="">Choose a PC</option>
            {pcList.map((item) => (
              <option key={item.pcId} value={item.pcId}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
          {fieldError("pcId")}
        </div>
        <div className="field">
          <label htmlFor={id("type")}>Type</label>
          <select
            id={id("type")}
            name="type"
            value={draft.type}
            onChange={(e) => patch({ type: e.target.value as QuestionType })}
          >
            {QUESTION_TYPES.map((value) => (
              <option key={value} value={value}>
                {QUESTION_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("language")}>Language</label>
          <input
            id={id("language")}
            name="language"
            type="text"
            autoComplete="off"
            value={draft.language}
            onChange={(e) => patch({ language: e.target.value })}
            {...invalid("language")}
          />
          {fieldError("language")}
        </div>
        <div className="field">
          <label htmlFor={id("difficulty")}>Difficulty (optional)</label>
          <select
            id={id("difficulty")}
            name="difficulty"
            value={draft.difficulty}
            onChange={(e) => patch({ difficulty: e.target.value })}
          >
            <option value="">Not set</option>
            {DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("bloomLevel")}>Bloom level (optional)</label>
          <select
            id={id("bloomLevel")}
            name="bloomLevel"
            value={draft.bloomLevel}
            onChange={(e) => patch({ bloomLevel: e.target.value })}
          >
            <option value="">Not set</option>
            {BLOOM_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={id("stem")}>Question text</label>
          <textarea
            id={id("stem")}
            name="stem"
            rows={4}
            value={draft.stem}
            onChange={(e) => patch({ stem: e.target.value })}
            {...invalid("stem")}
          />
          {fieldError("stem")}
        </div>
        <QuestionImagesField images={draft.images} onChange={(images) => patch({ images })} error={errors.images} />
        {mcq ? (
          <fieldset className="bare-fieldset" aria-describedby={errors.options ? id("options-error") : undefined}>
            <legend>Options</legend>
            {draft.options.map((option, index) => (
              <div className="repeat-row" key={option.key}>
                <div className="field">
                  <label htmlFor={id(`option-${option.key}`)}>Option {option.key}</label>
                  <input
                    id={id(`option-${option.key}`)}
                    type="text"
                    autoComplete="off"
                    value={option.text}
                    data-options-first={index === 0 ? "" : undefined}
                    aria-invalid={errors.options ? true : undefined}
                    onChange={(e) =>
                      patch({
                        options: draft.options.map((o) => (o.key === option.key ? { ...o, text: e.target.value } : o)),
                      })
                    }
                  />
                </div>
                {draft.options.length > 2 ? (
                  <button type="button" onClick={() => removeOption(option.key)}>
                    Remove option {option.key}
                  </button>
                ) : null}
              </div>
            ))}
            {fieldError("options")}
            {draft.options.length < OPTION_KEYS.length ? (
              <button type="button" onClick={addOption}>
                Add option
              </button>
            ) : null}
            <div className="field">
              <label htmlFor={id("correctAnswer")}>Correct option</label>
              <select
                id={id("correctAnswer")}
                name="correctAnswer"
                value={draft.correctAnswer}
                onChange={(e) => patch({ correctAnswer: e.target.value })}
                {...invalid("correctAnswer")}
              >
                <option value="">Choose the correct option</option>
                {draft.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key}
                    {option.text.trim() ? `: ${option.text.trim().slice(0, 60)}` : ""}
                  </option>
                ))}
              </select>
              {fieldError("correctAnswer")}
            </div>
          </fieldset>
        ) : (
          <div className="field">
            <label htmlFor={id("correctAnswer")}>Model answer or marking guide (optional)</label>
            <textarea
              id={id("correctAnswer")}
              name="correctAnswer"
              rows={3}
              value={draft.correctAnswer}
              onChange={(e) => patch({ correctAnswer: e.target.value })}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={id("marks")}>Marks</label>
          <input
            id={id("marks")}
            name="marks"
            type="number"
            step="0.5"
            min="0.5"
            value={draft.marks}
            onChange={(e) => patch({ marks: e.target.value })}
            {...invalid("marks")}
          />
          {fieldError("marks")}
        </div>
        <div className="dialog-actions">
          <button type="button" data-dialog-cancel onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="submit" disabled={pending}>
            {pending ? "Saving…" : question ? "Save new version" : "Create question"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
