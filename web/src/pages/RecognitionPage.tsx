import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SECTOR_NAMES, STATE_NAMES } from "../api/annexure";
import { ApiError, errorMessage } from "../api/client";
import { explainBatchRule, joinErrorParts } from "../api/ruleErrors";
import { getRecognition, saveRecognition, type Recognition } from "../api/recognition";
import { useSession } from "../api/session";
import { canWriteRecognition } from "../routing/access";
import { FormAlert } from "./masterData/dialog";
import { useFormErrorFocus } from "./masterData/useFormErrorFocus";
import {
  buildRecognition,
  emptyRecognitionDraft,
  recognitionDraftFromRecord,
  recognitionFieldOrder,
  type RecognitionDraft,
} from "./recognitionWrite";

type FormError = { id: number; message: string; fields: string[] };

function formatRecognitionError(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  return joinErrorParts([error.code, error.message, explainBatchRule(error.code, error.details) ?? ""]);
}

function optionDomId(field: string, option: string): string {
  return `${field}-${option.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function toggleValue(selected: readonly string[], value: string, on: boolean): string[] {
  if (on) return selected.includes(value) ? [...selected] : [...selected, value];
  return selected.filter((item) => item !== value);
}

function ChoiceList({
  legend,
  hintId,
  hint,
  filterLabel,
  options,
  selected,
  field,
  invalid,
  errorId,
  onToggle,
  fieldRef,
}: {
  legend: string;
  hintId: string;
  hint: string;
  filterLabel: string;
  options: readonly string[];
  selected: readonly string[];
  field: string;
  invalid: boolean;
  errorId: string;
  onToggle: (value: string, on: boolean) => void;
  fieldRef: (node: HTMLElement | null) => void;
}) {
  const filterId = useId();
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const visible = query ? options.filter((option) => option.toLowerCase().includes(query)) : options;

  return (
    <fieldset
      ref={fieldRef}
      tabIndex={-1}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
    >
      <legend>{legend}</legend>
      <div className="choice-toolbar">
        <div className="field">
          <label htmlFor={filterId}>{filterLabel}</label>
          <input
            id={filterId}
            type="search"
            value={filter}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <p className="field-hint">
          {selected.length} selected. Choices hidden by this filter stay selected.
        </p>
      </div>
      <p id={hintId} className="field-hint">
        {hint}
      </p>
      {visible.length === 0 ? <p>No choices match that filter.</p> : null}
      <ul className="choice-list">
        {visible.map((option) => {
          const inputId = optionDomId(field, option);
          return (
            <li key={option}>
              <label className="check-label" htmlFor={inputId}>
                <input
                  id={inputId}
                  name={field}
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={(event) => onToggle(option, event.target.checked)}
                />
                {option}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function RecognitionForm({
  record,
  onSaved,
}: {
  record: Recognition | null;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RecognitionDraft>(() =>
    record ? recognitionDraftFromRecord(record) : emptyRecognitionDraft(),
  );
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const sectorHintId = useId();
  const stateHintId = useId();
  const startId = useId();
  const endId = useId();
  const fieldOrder = useMemo(() => recognitionFieldOrder(draft), [draft]);
  useFormErrorFocus(formError, fieldRefs, fieldOrder);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function bind(field: string) {
    return (node: HTMLElement | null) => {
      fieldRefs.current[field] = node;
    };
  }

  function update(patch: Partial<RecognitionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  const invalid = (field: string) => formError?.fields.includes(field) ?? false;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const built = buildRecognition(draft);
        if (!built.ok) {
          setFormError({ id: errorSeq.current + 1, message: built.message, fields: built.fields });
          errorSeq.current += 1;
          return;
        }
        setPending(true);
        setFormError(null);
        void (async () => {
          try {
            const saved = await saveRecognition(built.body);
            await queryClient.invalidateQueries({ queryKey: ["admin", "recognition"] });
            if (!mounted.current) return;
            onSaved(`Recognition was saved. Reference ${saved.id}.`);
          } catch (error) {
            if (!mounted.current) return;
            setPending(false);
            setFormError({ id: errorSeq.current + 1, message: formatRecognitionError(error), fields: [] });
            errorSeq.current += 1;
          }
        })();
      }}
    >
      <fieldset disabled={pending} className="bare-fieldset">
        <FormAlert error={formError} id={errorId} />
        <ChoiceList
          legend="Recognised sectors"
          hintId={sectorHintId}
          hint="Choose at least one Annexure II sector."
          filterLabel="Find a sector"
          options={SECTOR_NAMES}
          selected={draft.sectors}
          field="sectors"
          invalid={invalid("sectors")}
          errorId={errorId}
          fieldRef={bind("sectors")}
          onToggle={(value, on) => update({ sectors: toggleValue(draft.sectors, value, on) })}
        />
        <fieldset>
          <legend>Geography</legend>
          <label className="check-label">
            <input
              type="radio"
              name="geography"
              checked={draft.panIndia}
              onChange={() => update({ panIndia: true, states: [] })}
            />
            PAN India
          </label>
          <label className="check-label">
            <input
              type="radio"
              name="geography"
              checked={!draft.panIndia}
              onChange={() => update({ panIndia: false })}
            />
            Selected states
          </label>
          <p className="field-hint">PAN India covers every state. Otherwise choose at least one Annexure IV state.</p>
        </fieldset>
        {draft.panIndia ? null : (
          <ChoiceList
            legend="Recognised states"
            hintId={stateHintId}
            hint="Choose at least one state or union territory."
            filterLabel="Find a state"
            options={STATE_NAMES}
            selected={draft.states}
            field="states"
            invalid={invalid("states")}
            errorId={errorId}
            fieldRef={bind("states")}
            onToggle={(value, on) => update({ states: toggleValue(draft.states, value, on) })}
          />
        )}
        <div className="recognition-dates">
          <div className="field">
            <label htmlFor={startId}>Start date</label>
            <input
              id={startId}
              ref={bind("startDate")}
              name="startDate"
              type="date"
              value={draft.startDate}
              aria-required="true"
              aria-invalid={invalid("startDate") || undefined}
              aria-describedby={invalid("startDate") ? `${startId}-hint ${errorId}` : `${startId}-hint`}
              onChange={(event) => update({ startDate: event.target.value })}
            />
            <p id={`${startId}-hint`} className="field-hint">
              Required. Inclusive calendar date.
            </p>
          </div>
          <div className="field">
            <label htmlFor={endId}>End date</label>
            <input
              id={endId}
              ref={bind("endDate")}
              name="endDate"
              type="date"
              value={draft.endDate}
              aria-required="true"
              aria-invalid={invalid("endDate") || undefined}
              aria-describedby={invalid("endDate") ? `${endId}-hint ${errorId}` : `${endId}-hint`}
              onChange={(event) => update({ endDate: event.target.value })}
            />
            <p id={`${endId}-hint`} className="field-hint">
              Required. Inclusive, and on or after the start date.
            </p>
          </div>
        </div>
        <button type="submit">{pending ? "Saving…" : "Save recognition"}</button>
      </fieldset>
    </form>
  );
}

function RecognitionReadOnly({ record }: { record: Recognition }) {
  return (
    <>
      <h2>Recognised sectors</h2>
      <ul>
        {record.sectors.map((sector) => (
          <li key={sector}>{sector}</li>
        ))}
      </ul>
      <h2>Geography</h2>
      {record.panIndia ? (
        <p>PAN India</p>
      ) : (
        <ul>
          {record.states.map((state) => (
            <li key={state}>{state}</li>
          ))}
        </ul>
      )}
      <h2>Dates</h2>
      <dl className="recognition-facts">
        <div>
          <dt>Start date</dt>
          <dd>{record.startDate}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>{record.endDate}</dd>
        </div>
      </dl>
    </>
  );
}

export function RecognitionPage() {
  const session = useSession();
  const [notice, setNotice] = useState<string | null>(null);
  const recognition = useQuery({
    queryKey: ["admin", "recognition"],
    queryFn: ({ signal }) => getRecognition(signal),
  });

  if (!session) return null;
  const canWrite = canWriteRecognition(session.user.role);
  const record = recognition.isError ? undefined : recognition.data;

  return (
    <>
      <h1>Recognition</h1>
      <p>Recognised sectors, states or PAN India, and the start and end dates for this assessment agency.</p>
      {canWrite ? (
        <p>Saving replaces the recognition record. It does not change batches that already exist.</p>
      ) : (
        <p>You can view recognition. Your role cannot change it.</p>
      )}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {recognition.isFetching && record === undefined ? <p role="status">Loading recognition.</p> : null}
      {recognition.isError && !recognition.isFetching ? (
        <div className="form-error" role="alert">
          <p>{formatRecognitionError(recognition.error)}</p>
          <button type="button" onClick={() => void recognition.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {record === null ? (
        <p role="status">
          {canWrite
            ? "Recognition is not configured. Save a record to set sectors, geography, and dates."
            : "Recognition is not configured."}
        </p>
      ) : null}
      {record === null && canWrite ? <RecognitionForm key="new" record={null} onSaved={setNotice} /> : null}
      {record ? (
        canWrite ? (
          <RecognitionForm key={record.id} record={record} onSaved={setNotice} />
        ) : (
          <RecognitionReadOnly record={record} />
        )
      ) : null}
    </>
  );
}
