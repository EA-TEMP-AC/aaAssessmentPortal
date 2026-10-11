import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SECTORS,
  createQualification,
  deleteQualification,
  listQualifications,
  updateQualification,
  type MasterPageSize,
  type Qualification,
  type Sector,
} from "../../api/masterData";
import { useSession } from "../../api/session";
import { MASTER_COLLECTION_META, canReadMasterCollection, canWriteMasterData } from "../masterDataAccess";
import { Dialog, FormAlert } from "./dialog";
import { formatMasterDataError } from "./formatApiError";
import { BATCH_TYPE_LABELS, PASS_CRITERIA_LABELS, PASS_UNIT_LABELS, SECTOR_LABELS } from "./labels";
import { ListScaffold, PageSizeField } from "./listScaffold";
import { READ_ONLY_NOTE, SCOPE_NOTE, emptyListMessage, listSummary } from "./listText";
import {
  blankNos,
  blankPc,
  buildQualification,
  emptyQualificationDraft,
  formFieldForServerPath,
  qualificationDraftFromRecord,
  qualificationFieldOrder,
  type MarkDraft,
  type QualificationDraft,
} from "./qualificationWrite";
import { useFormErrorFocus } from "./useFormErrorFocus";
import { useMasterDialog } from "./useMasterDialog";

type Filters = { sector: Sector | ""; pageSize: MasterPageSize };
type DialogState = { type: "create" } | { type: "edit"; record: Qualification } | { type: "delete"; record: Qualification };
type FormError = { id: number; message: string; fields: string[] };
type MarkName = "theory" | "practical" | "viva";

const EMPTY_FILTERS: Filters = { sector: "", pageSize: 20 };
const MARKS: readonly MarkName[] = ["theory", "practical", "viva"];
const MARK_LABEL: Record<MarkName, string> = { theory: "Theory", practical: "Practical", viva: "Viva" };

function passMarkText(record: Qualification): string {
  return MARKS.map((component) => `${MARK_LABEL[component]} ${record.passMarks[component]}`).join(", ");
}

function MarkFields({
  legend,
  values,
  idPrefix,
  fieldPrefix,
  labelPrefix,
  required,
  errorFields,
  errorId,
  hint,
  onChange,
  bind,
}: {
  legend: string;
  values: MarkDraft;
  idPrefix: string;
  fieldPrefix: string;
  labelPrefix: string;
  required: boolean;
  errorFields: readonly string[];
  errorId: string;
  hint: string;
  onChange: (component: MarkName, value: string) => void;
  bind: (field: string) => (node: HTMLElement | null) => void;
}) {
  const hintId = `${idPrefix}-hint`;
  return (
    <fieldset>
      <legend>{legend}</legend>
      <p id={hintId} className="field-hint">
        {hint}
      </p>
      <div className="mark-grid">
        {MARKS.map((component) => {
          const field = `${fieldPrefix}${component}`;
          const inputId = `${idPrefix}-${component}`;
          const invalid = errorFields.includes(field);
          const kind = required ? "pass mark" : "max mark";
          const label = labelPrefix
            ? `${labelPrefix} ${MARK_LABEL[component].toLowerCase()} ${kind}`
            : `${MARK_LABEL[component]} ${kind}`;
          return (
            <div className="field" key={component}>
              <label htmlFor={inputId}>{label}</label>
              <input
                id={inputId}
                ref={bind(field)}
                name={field}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values[component]}
                aria-required={required || undefined}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
                onChange={(event) => onChange(component, event.target.value)}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function QualificationForm({
  record,
  onCancel,
  onSaved,
}: {
  record: Qualification | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const keyRef = useRef(0);
  const [draft, setDraft] = useState<QualificationDraft>(() => {
    const nextKey = () => {
      keyRef.current += 1;
      return `q-${keyRef.current}`;
    };
    return record ? qualificationDraftFromRecord(record, nextKey) : emptyQualificationDraft();
  });
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const baseId = useId();
  const fieldOrder = useMemo(() => qualificationFieldOrder(draft), [draft]);
  useFormErrorFocus(formError, fieldRefs, fieldOrder);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function nextKey() {
    keyRef.current += 1;
    return `q-${keyRef.current}`;
  }

  function bind(field: string) {
    return (node: HTMLElement | null) => {
      fieldRefs.current[field] = node;
    };
  }

  function described(field: string, hintId: string) {
    return formError?.fields.includes(field) ? `${hintId} ${errorId}` : hintId;
  }

  function update(patch: Partial<QualificationDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  function setMark(group: "passMarks" | "maxMarks", component: MarkName, value: string) {
    setDraft((current) => ({ ...current, [group]: { ...current[group], [component]: value } }));
    setFormError(null);
  }

  const editing = record !== null;
  const title = editing ? `Edit ${record.name}` : "Create qualification";

  return (
    <Dialog title={title} wide busy={pending} onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const built = buildQualification(draft, editing ? "edit" : "create");
          if (!built.ok) {
            setFormError({ id: errorSeq.current + 1, message: built.message, fields: built.fields });
            errorSeq.current += 1;
            return;
          }
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = editing ? await updateQualification(record.id, built.body) : await createQualification(built.body);
              await queryClient.invalidateQueries({ queryKey: ["master-data", "qualifications"] });
              if (!mounted.current) return;
              onSaved(editing ? `${saved.name} was saved.` : `${saved.name} was created.`);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              const formatted = formatMasterDataError(error);
              const mapped = formatted.field ? formFieldForServerPath(formatted.field, draft) : null;
              setFormError({
                id: errorSeq.current + 1,
                message: formatted.message,
                fields: mapped ? [mapped] : [],
              });
              errorSeq.current += 1;
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          <div className="field">
            <label htmlFor={`${baseId}-code`}>Code</label>
            <input
              id={`${baseId}-code`}
              ref={bind("code")}
              name="code"
              type="text"
              value={draft.code}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              aria-required="true"
              aria-invalid={formError?.fields.includes("code") || undefined}
              aria-describedby={described("code", `${baseId}-code-hint`)}
              onChange={(event) => update({ code: event.target.value })}
            />
            <p id={`${baseId}-code-hint`} className="field-hint">
              Required. Up to 64 characters. Must be unique.
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-name`}>Name</label>
            <input
              id={`${baseId}-name`}
              ref={bind("name")}
              name="name"
              type="text"
              value={draft.name}
              maxLength={200}
              autoComplete="off"
              aria-required="true"
              aria-invalid={formError?.fields.includes("name") || undefined}
              aria-describedby={described("name", `${baseId}-name-hint`)}
              onChange={(event) => update({ name: event.target.value })}
            />
            <p id={`${baseId}-name-hint`} className="field-hint">
              Required. Up to 200 characters.
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-sector`}>Sector</label>
            <select
              id={`${baseId}-sector`}
              ref={bind("sector")}
              name="sector"
              value={draft.sector}
              aria-required="true"
              aria-invalid={formError?.fields.includes("sector") || undefined}
              onChange={(event) => update({ sector: event.target.value as Sector | "" })}
            >
              <option value="">Choose a sector</option>
              {SECTORS.map((sector) => (
                <option key={sector} value={sector}>
                  {SECTOR_LABELS[sector]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-batch`}>Default batch type</label>
            <select
              id={`${baseId}-batch`}
              name="defaultBatchType"
              value={draft.defaultBatchType}
              aria-describedby={`${baseId}-batch-hint`}
              onChange={(event) => update({ defaultBatchType: event.target.value as QualificationDraft["defaultBatchType"] })}
            >
              <option value="">Not set</option>
              <option value="STT">{BATCH_TYPE_LABELS.STT}</option>
              <option value="LTT">{BATCH_TYPE_LABELS.LTT}</option>
            </select>
            <p id={`${baseId}-batch-hint`} className="field-hint">
              {editing ? "Optional. Choose Not set to clear it." : "Optional."}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-criteria`}>Pass criteria</label>
            <select
              id={`${baseId}-criteria`}
              name="passCriteriaMode"
              value={draft.passCriteriaMode}
              aria-describedby={`${baseId}-criteria-hint`}
              onChange={(event) => update({ passCriteriaMode: event.target.value as QualificationDraft["passCriteriaMode"] })}
            >
              <option value="">Not set</option>
              <option value="nos_wise">{PASS_CRITERIA_LABELS.nos_wise}</option>
              <option value="overall">{PASS_CRITERIA_LABELS.overall}</option>
            </select>
            <p id={`${baseId}-criteria-hint`} className="field-hint">
              {editing ? "Optional. Choose Not set to clear it." : "Optional."}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-unit`}>Pass mark unit</label>
            <select
              id={`${baseId}-unit`}
              name="passMarkUnit"
              value={draft.passMarkUnit}
              aria-describedby={`${baseId}-unit-hint`}
              onChange={(event) => update({ passMarkUnit: event.target.value as QualificationDraft["passMarkUnit"] })}
            >
              <option value="percent">{PASS_UNIT_LABELS.percent}</option>
              <option value="absolute">{PASS_UNIT_LABELS.absolute}</option>
            </select>
            <p id={`${baseId}-unit-hint`} className="field-hint">
              Percent marks must be from 0 to 100. Absolute marks need a max mark on the qualification or on every NOS.
            </p>
          </div>
          <MarkFields
            legend="Pass marks"
            values={draft.passMarks}
            idPrefix={`${baseId}-pass`}
            fieldPrefix="passMarks."
            labelPrefix=""
            required
            errorFields={formError?.fields ?? []}
            errorId={errorId}
            hint="Required for theory, practical, and viva."
            onChange={(component, value) => setMark("passMarks", component, value)}
            bind={bind}
          />
          <MarkFields
            legend="Max marks"
            values={draft.maxMarks}
            idPrefix={`${baseId}-max`}
            fieldPrefix="maxMarks."
            labelPrefix=""
            required={false}
            errorFields={formError?.fields ?? []}
            errorId={errorId}
            hint="Optional for percent. For an absolute mark, set each component here or on every NOS."
            onChange={(component, value) => setMark("maxMarks", component, value)}
            bind={bind}
          />
          <div className="field">
            <label className="check-label" htmlFor={`${baseId}-pc-required`}>
              <input
                id={`${baseId}-pc-required`}
                name="pcPassMarksRequired"
                type="checkbox"
                checked={draft.pcPassMarksRequired}
                aria-describedby={`${baseId}-pc-required-hint`}
                onChange={(event) => update({ pcPassMarksRequired: event.target.checked })}
              />
              Require a pass mark on every performance criterion
            </label>
            <p id={`${baseId}-pc-required-hint`} className="field-hint">
              When this is checked, every performance criterion needs a pass mark.
            </p>
          </div>
          <fieldset>
            <legend>NOS</legend>
            {draft.nos.map((item, nosIndex) => (
              <fieldset key={item.key} className="nos-block">
                <legend>NOS {nosIndex + 1}</legend>
                <div className="field">
                  <label htmlFor={`${baseId}-nos-${nosIndex}-id`}>NOS {nosIndex + 1} id</label>
                  <input
                    id={`${baseId}-nos-${nosIndex}-id`}
                    ref={bind(`nos.${nosIndex}.nosId`)}
                    name={`nos.${nosIndex}.nosId`}
                    type="text"
                    value={item.nosId}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    aria-required="true"
                    aria-invalid={formError?.fields.includes(`nos.${nosIndex}.nosId`) || undefined}
                    aria-describedby={described(`nos.${nosIndex}.nosId`, `${baseId}-nos-${nosIndex}-hint`)}
                    onChange={(event) => updateNos(setDraft, setFormError, nosIndex, { nosId: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${baseId}-nos-${nosIndex}-code`}>NOS {nosIndex + 1} code</label>
                  <input
                    id={`${baseId}-nos-${nosIndex}-code`}
                    ref={bind(`nos.${nosIndex}.code`)}
                    name={`nos.${nosIndex}.code`}
                    type="text"
                    value={item.code}
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    aria-required="true"
                    aria-invalid={formError?.fields.includes(`nos.${nosIndex}.code`) || undefined}
                    onChange={(event) => updateNos(setDraft, setFormError, nosIndex, { code: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${baseId}-nos-${nosIndex}-name`}>NOS {nosIndex + 1} name</label>
                  <input
                    id={`${baseId}-nos-${nosIndex}-name`}
                    ref={bind(`nos.${nosIndex}.name`)}
                    name={`nos.${nosIndex}.name`}
                    type="text"
                    value={item.name}
                    maxLength={200}
                    autoComplete="off"
                    aria-required="true"
                    aria-invalid={formError?.fields.includes(`nos.${nosIndex}.name`) || undefined}
                    onChange={(event) => updateNos(setDraft, setFormError, nosIndex, { name: event.target.value })}
                  />
                </div>
                <p id={`${baseId}-nos-${nosIndex}-hint`} className="field-hint">
                  Id and code are required, up to 64 characters, and must be unique. Name is required, up to 200 characters.
                </p>
                <MarkFields
                  legend={`NOS ${nosIndex + 1} max marks`}
                  values={item.maxMarks}
                  idPrefix={`${baseId}-nos-${nosIndex}-max`}
                  fieldPrefix={`nos.${nosIndex}.maxMarks.`}
                  labelPrefix={`NOS ${nosIndex + 1}`}
                  required={false}
                  errorFields={formError?.fields ?? []}
                  errorId={errorId}
                  hint="Optional. Set these when the qualification max mark for that component is blank and the unit is absolute."
                  onChange={(component, value) => {
                    setDraft((current) => ({
                      ...current,
                      nos: current.nos.map((nos, index) =>
                        index === nosIndex ? { ...nos, maxMarks: { ...nos.maxMarks, [component]: value } } : nos,
                      ),
                    }));
                    setFormError(null);
                  }}
                  bind={bind}
                />
                {item.pcs.map((pc, pcIndex) => (
                  <fieldset key={pc.key}>
                    <legend>
                      Performance criterion {pcIndex + 1} for NOS {nosIndex + 1}
                    </legend>
                    {(
                      [
                        ["pcId", "id"],
                        ["code", "code"],
                        ["name", "name"],
                      ] as const
                    ).map(([key, label]) => {
                      const field = `nos.${nosIndex}.pcs.${pcIndex}.${key}`;
                      return (
                        <div className="field" key={key}>
                          <label htmlFor={`${baseId}-pc-${nosIndex}-${pcIndex}-${key}`}>
                            Performance criterion {pcIndex + 1} {label} for NOS {nosIndex + 1}
                          </label>
                          <input
                            id={`${baseId}-pc-${nosIndex}-${pcIndex}-${key}`}
                            ref={bind(field)}
                            name={field}
                            type="text"
                            value={pc[key]}
                            maxLength={key === "name" ? 200 : 64}
                            autoComplete="off"
                            spellCheck={false}
                            aria-required="true"
                            aria-invalid={formError?.fields.includes(field) || undefined}
                            onChange={(event) =>
                              updatePc(setDraft, setFormError, nosIndex, pcIndex, { [key]: event.target.value })
                            }
                          />
                        </div>
                      );
                    })}
                    <div className="field">
                      <label htmlFor={`${baseId}-pc-${nosIndex}-${pcIndex}-pass`}>
                        Performance criterion {pcIndex + 1} pass mark for NOS {nosIndex + 1}
                      </label>
                      <input
                        id={`${baseId}-pc-${nosIndex}-${pcIndex}-pass`}
                        ref={bind(`nos.${nosIndex}.pcs.${pcIndex}.passMark`)}
                        name={`nos.${nosIndex}.pcs.${pcIndex}.passMark`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pc.passMark}
                        aria-invalid={formError?.fields.includes(`nos.${nosIndex}.pcs.${pcIndex}.passMark`) || undefined}
                        aria-describedby={`${baseId}-pc-${nosIndex}-pass-hint`}
                        onChange={(event) => updatePc(setDraft, setFormError, nosIndex, pcIndex, { passMark: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${baseId}-pc-${nosIndex}-${pcIndex}-max`}>
                        Performance criterion {pcIndex + 1} max mark for NOS {nosIndex + 1}
                      </label>
                      <input
                        id={`${baseId}-pc-${nosIndex}-${pcIndex}-max`}
                        ref={bind(`nos.${nosIndex}.pcs.${pcIndex}.maxMark`)}
                        name={`nos.${nosIndex}.pcs.${pcIndex}.maxMark`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pc.maxMark}
                        aria-invalid={formError?.fields.includes(`nos.${nosIndex}.pcs.${pcIndex}.maxMark`) || undefined}
                        aria-describedby={`${baseId}-pc-${nosIndex}-max-hint`}
                        onChange={(event) => updatePc(setDraft, setFormError, nosIndex, pcIndex, { maxMark: event.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          nos: current.nos.map((nos, index) =>
                            index === nosIndex ? { ...nos, pcs: nos.pcs.filter((itemPc) => itemPc.key !== pc.key) } : nos,
                          ),
                        }))
                      }
                    >
                      Remove performance criterion {pcIndex + 1} from NOS {nosIndex + 1}
                    </button>
                  </fieldset>
                ))}
                <p id={`${baseId}-pc-${nosIndex}-pass-hint`} className="field-hint">
                  Pass mark is optional unless every performance criterion must have one. For an absolute unit it cannot be above the criterion max mark.
                </p>
                <p id={`${baseId}-pc-${nosIndex}-max-hint`} className="field-hint">
                  Max mark is optional. An absolute pass mark needs it.
                </p>
                <div className="row-actions">
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        nos: current.nos.map((nos, index) =>
                          index === nosIndex ? { ...nos, pcs: [...nos.pcs, blankPc(nextKey())] } : nos,
                        ),
                      }))
                    }
                  >
                    Add performance criterion to NOS {nosIndex + 1}
                  </button>
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => setDraft((current) => ({ ...current, nos: current.nos.filter((nos) => nos.key !== item.key) }))}
                  >
                    Remove NOS {nosIndex + 1}
                  </button>
                </div>
              </fieldset>
            ))}
            <button type="button" onClick={() => setDraft((current) => ({ ...current, nos: [...current.nos, blankNos(nextKey())] }))}>
              Add NOS
            </button>
          </fieldset>
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{editing ? "Save changes" : "Create qualification"}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function updateNos(
  setDraft: (value: (current: QualificationDraft) => QualificationDraft) => void,
  setFormError: (value: FormError | null) => void,
  nosIndex: number,
  patch: Partial<QualificationDraft["nos"][number]>,
) {
  setDraft((current) => ({
    ...current,
    nos: current.nos.map((item, index) => (index === nosIndex ? { ...item, ...patch } : item)),
  }));
  setFormError(null);
}

function updatePc(
  setDraft: (value: (current: QualificationDraft) => QualificationDraft) => void,
  setFormError: (value: FormError | null) => void,
  nosIndex: number,
  pcIndex: number,
  patch: Partial<QualificationDraft["nos"][number]["pcs"][number]>,
) {
  setDraft((current) => ({
    ...current,
    nos: current.nos.map((item, index) =>
      index === nosIndex
        ? { ...item, pcs: item.pcs.map((pc, indexPc) => (indexPc === pcIndex ? { ...pc, ...patch } : pc)) }
        : item,
    ),
  }));
  setFormError(null);
}

function DeleteConfirm({
  record,
  onCancel,
  onSaved,
}: {
  record: Qualification;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <Dialog title={`Delete ${record.name}?`} busy={pending} initialFocus="cancel" onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              await deleteQualification(record.id);
              await queryClient.invalidateQueries({ queryKey: ["master-data", "qualifications"] });
              if (!mounted.current) return;
              onSaved(`${record.name} was deleted.`);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              setFormError({ id: errorSeq.current + 1, message: formatMasterDataError(error).message, fields: [] });
              errorSeq.current += 1;
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <p>This removes the qualification. It cannot be undone.</p>
          <FormAlert error={formError} id={errorId} />
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Delete</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

export function QualificationsScreen() {
  const session = useSession();
  const role = session?.user.role ?? null;
  const canRead = role ? canReadMasterCollection(role, "qualifications") : false;
  const canWrite = role ? canWriteMasterData(role) && canRead : false;
  const meta = MASTER_COLLECTION_META.qualifications;
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const chrome = useMasterDialog(dialog !== null);
  const sectorId = useId();

  const records = useQuery({
    queryKey: ["master-data", "qualifications", applied, page],
    enabled: canRead,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      listQualifications({ sector: applied.sector || undefined, page, pageSize: applied.pageSize }, signal),
  });

  if (!session || !role) return null;
  if (!canRead) {
    return (
      <>
        <h1>{meta.title}</h1>
        <p role="status">This list is not available for your role.</p>
      </>
    );
  }

  const result = records.isError ? undefined : records.data;
  const columns = ["Code", "Name", "Sector", "Pass mark unit", "Pass marks", "NOS", ...(canWrite ? ["Actions"] : [])];
  const notes = [SCOPE_NOTE, canWrite ? "Delete removes a qualification permanently." : READ_ONLY_NOTE];

  function openDialog(event: MouseEvent<HTMLButtonElement>, next: DialogState) {
    chrome.rememberOpener(event);
    setDialog(next);
  }

  function cancelDialog() {
    chrome.closeDialog();
    setDialog(null);
  }

  function onSaved(message: string) {
    chrome.showNotice(message);
    setDialog(null);
  }

  let rows: ReactNode = null;
  if (result && result.items.length === 0) {
    rows = (
      <tr>
        <td colSpan={columns.length}>{emptyListMessage(meta.many, Boolean(applied.sector))}</td>
      </tr>
    );
  } else if (result) {
    rows = result.items.map((record) => (
      <tr key={record.id}>
        <td>{record.code}</td>
        <td>{record.name}</td>
        <td>{SECTOR_LABELS[record.sector]}</td>
        <td>{PASS_UNIT_LABELS[record.passMarkUnit]}</td>
        <td>{passMarkText(record)}</td>
        <td>{record.nos.length}</td>
        {canWrite ? (
          <td>
            <div className="row-actions">
              <button type="button" className="button-quiet" onClick={(event) => openDialog(event, { type: "edit", record })}>
                Edit {record.name}
              </button>
              <button type="button" className="button-quiet" onClick={(event) => openDialog(event, { type: "delete", record })}>
                Delete {record.name}
              </button>
            </div>
          </td>
        ) : null}
      </tr>
    ));
  }

  return (
    <ListScaffold
      title={meta.title}
      lede={meta.lede}
      notes={notes}
      canWrite={canWrite}
      createLabel="Create qualification"
      onCreate={(event) => openDialog(event, { type: "create" })}
      filterLabel="Filter qualifications"
      filters={
        <>
          <div className="field">
            <label htmlFor={sectorId}>Sector</label>
            <select
              id={sectorId}
              name="sector"
              value={draftFilters.sector}
              onChange={(event) => setDraftFilters((current) => ({ ...current, sector: event.target.value as Sector | "" }))}
            >
              <option value="">Any sector</option>
              {SECTORS.map((sector) => (
                <option key={sector} value={sector}>
                  {SECTOR_LABELS[sector]}
                </option>
              ))}
            </select>
          </div>
          <PageSizeField
            id="qualifications-page-size"
            value={draftFilters.pageSize}
            onChange={(pageSize) => setDraftFilters((current) => ({ ...current, pageSize }))}
          />
        </>
      }
      onApply={() => {
        chrome.setNotice(null);
        setApplied(draftFilters);
        setPage(1);
      }}
      onClear={() => {
        setDraftFilters(EMPTY_FILTERS);
        setApplied(EMPTY_FILTERS);
        setPage(1);
        chrome.setNotice(null);
      }}
      filterError={null}
      isError={records.isError}
      isFetching={records.isFetching}
      error={records.error}
      onRetry={() => void records.refetch()}
      summary={
        records.isFetching ? `Loading ${meta.many}.` : result ? listSummary(result.page, result.pageSize, result.total, meta.one, meta.many) : ""
      }
      columns={columns}
      caption={meta.title}
      rows={rows}
      showTable={Boolean(result)}
      page={result?.page ?? 1}
      hasNext={result ? result.page * result.pageSize < result.total : false}
      onPrevious={() => setPage((current) => Math.max(1, current - 1))}
      onNext={() => setPage((current) => current + 1)}
      pagerLabel="Qualification pages"
      pageRef={chrome.pageRef}
      notice={chrome.notice}
      noticeRef={chrome.noticeRef}
      dialog={
        dialog?.type === "create" ? (
          <QualificationForm record={null} onCancel={cancelDialog} onSaved={onSaved} />
        ) : dialog?.type === "edit" ? (
          <QualificationForm key={dialog.record.id} record={dialog.record} onCancel={cancelDialog} onSaved={onSaved} />
        ) : dialog?.type === "delete" ? (
          <DeleteConfirm record={dialog.record} onCancel={cancelDialog} onSaved={onSaved} />
        ) : null
      }
    />
  );
}
