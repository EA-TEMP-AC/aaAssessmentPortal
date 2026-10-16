import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, errorMessage } from "../api/client";
import {
  GENDER_CHOICES,
  GENDER_LABELS,
  INFO_FIELD_LABELS,
  saveCandidateInfo,
  type CandidateInfoValues,
  type InfoField,
} from "../api/batchSettings";
import { checkField, today } from "./candidateInfoCheck";

type Props = {
  batchId: string;
  fields: InfoField[];
  /** Called after the server accepted the answers. */
  onDone: () => void;
  onCancel: () => void;
};

type Values = Record<InfoField, string>;
type Errors = Partial<Record<InfoField, string>>;

const EMPTY: Values = { email: "", fatherName: "", gender: "", dateOfBirth: "" };

/**
 * B-20. The pop-up shown after the camera check and before the exam starts, when the batch asks for
 * the candidate's details. Only the fields the batch lists are shown. There is no field for any
 * national ID number. The answers are sent once and are not kept in the browser.
 */
export function CandidateInfoForm({ batchId, fields, onDone, onCancel }: Props) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const set = (field: InfoField, value: string) => setValues((cur) => ({ ...cur, [field]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    for (const field of fields) {
      const problem = checkField(field, values[field]);
      if (problem) found[field] = problem;
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      window.setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    const body: CandidateInfoValues = {};
    for (const field of fields) body[field] = values[field].trim();
    setBusy(true);
    try {
      await saveCandidateInfo(batchId, body);
      onDone();
    } catch (error) {
      setBusy(false);
      setFormError(
        error instanceof ApiError && error.status === 400
          ? "Some details were not accepted. Check them and try again."
          : errorMessage(error),
      );
      window.setTimeout(() => summaryRef.current?.focus(), 0);
    }
  }

  const problems = fields.flatMap((f) => (errors[f] ? [{ field: f, text: errors[f] as string }] : []));
  return (
    <section aria-labelledby={`${baseId}-heading`} className="exam-info-form">
      <h1 id={`${baseId}-heading`} ref={headingRef} tabIndex={-1}>
        Your details
      </h1>
      <p>
        Before the exam starts, please enter these details. They are kept private and only the assessment agency and your
        training partner can see them. Never enter an Aadhaar, PAN, voter id or passport number.
      </p>
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {problems.length > 0 || formError ? (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="form-error">
            {formError ? <p>{formError}</p> : <p>Please fix these before you continue:</p>}
            {problems.length > 0 ? (
              <ul>
                {problems.map((p) => (
                  <li key={p.field}>
                    {INFO_FIELD_LABELS[p.field]}: {p.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <fieldset className="bare-fieldset" disabled={busy}>
          {fields.map((field) => {
            const id = `${baseId}-${field}`;
            const error = errors[field];
            const common = {
              id,
              "aria-invalid": error ? true : undefined,
              "aria-describedby": error ? `${id}-error` : undefined,
            } as const;
            return (
              <div className="field" key={field}>
                <label htmlFor={id}>{INFO_FIELD_LABELS[field]}</label>
                {field === "gender" ? (
                  <select {...common} value={values.gender} onChange={(e) => set("gender", e.target.value)}>
                    <option value="">Choose</option>
                    {GENDER_CHOICES.map((g) => (
                      <option key={g} value={g}>
                        {GENDER_LABELS[g]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={field === "email" ? "email" : field === "dateOfBirth" ? "date" : "text"}
                    autoComplete={field === "email" ? "email" : field === "dateOfBirth" ? "bday" : "off"}
                    max={field === "dateOfBirth" ? today() : undefined}
                    value={values[field]}
                    onChange={(e) => set(field, e.target.value)}
                  />
                )}
                {error ? (
                  <p id={`${id}-error`} className="field-error">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        <div className="dialog-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save and start the exam"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Go back
          </button>
        </div>
      </form>
    </section>
  );
}
