import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createProject,
  createScheme,
  createSignatory,
  SIGNATORY_SCOPES,
  updateProject,
  updateScheme,
  updateSignatory,
  isSignatoryScope,
  type Project,
  type Scheme,
  type Signatory,
} from "../../api/schemes";
import { Dialog, FormAlert } from "../masterData/dialog";
import { formatMasterDataError } from "../masterData/formatApiError";
import { SCHEME_DATA_KEY, SCOPE_LABELS, useProjectOptions, useSchemeOptions, type Option } from "./schemeData";
import { useFormErrorFocus } from "../masterData/useFormErrorFocus";
import {
  PROJECT_FIELDS,
  SCHEME_FIELDS,
  SIGNATORY_FIELDS,
  buildProjectWrite,
  buildSchemeWrite,
  buildSignatoryWrite,
  emptyProjectDraft,
  emptySchemeDraft,
  emptySignatoryDraft,
  serverFieldErrors,
  type ProjectDraft,
  type SchemeDraft,
  type SignatoryDraft,
  type WriteResult,
} from "./schemeWrite";

type FormError = { id: number; message: string; fields: string[] };

type Ctx = {
  bind: (field: string) => (node: HTMLElement | null) => void;
  invalid: (field: string) => true | undefined;
  describedBy: (field: string, hintId: string) => string;
};

/** Shared dialog, submit, error and focus handling for the three forms. */
function FormShell<Draft extends { active: boolean }, Body>({
  title,
  submitLabel,
  order,
  initial,
  build,
  save,
  onCancel,
  onSaved,
  children,
}: {
  title: string;
  submitLabel: string;
  order: readonly string[];
  initial: Draft;
  build: (draft: Draft) => WriteResult<Body>;
  save: (body: Body) => Promise<string>;
  onCancel: () => void;
  onSaved: (message: string) => void;
  children: (draft: Draft, update: (patch: Partial<Draft>) => void, ctx: Ctx) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  useFormErrorFocus(formError, fieldRefs, order);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function showError(message: string, fields: string[]) {
    errorSeq.current += 1;
    setFormError({ id: errorSeq.current, message, fields });
  }

  const ctx: Ctx = {
    bind: (field) => (node) => {
      fieldRefs.current[field] = node;
    },
    invalid: (field) => formError?.fields.includes(field) || undefined,
    describedBy: (field, hintId) => (formError?.fields.includes(field) ? `${hintId} ${errorId}` : hintId),
  };

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  return (
    <Dialog title={title} busy={pending} onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const built = build(draft);
          if (!built.ok) {
            showError(built.message, built.fields);
            return;
          }
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const message = await save(built.body);
              await queryClient.invalidateQueries({ queryKey: [SCHEME_DATA_KEY] });
              await queryClient.invalidateQueries({ queryKey: ["batches"] });
              if (mounted.current) onSaved(message);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              showError(formatMasterDataError(error).message, serverFieldErrors(error, order));
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          {children(draft, update, ctx)}
          <ActiveField checked={draft.active} onChange={(active) => setDraft((current) => ({ ...current, active }))} />
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{submitLabel}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function ActiveField({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="check-label" htmlFor={id}>
        <input id={id} name="active" type="checkbox" checked={checked} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.checked)} />
        Active
      </label>
      <p id={`${id}-hint`} className="field-hint">
        Clear this to mark the record inactive.
      </p>
    </div>
  );
}

function TextField({
  label,
  hint,
  field,
  value,
  max,
  required = true,
  type = "text",
  ctx,
  onChange,
}: {
  label: string;
  hint: string;
  field: string;
  value: string;
  max?: number;
  required?: boolean;
  type?: "text" | "date";
  ctx: Ctx;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={ctx.bind(field)}
        name={field}
        type={type}
        value={value}
        maxLength={max}
        autoComplete="off"
        spellCheck={false}
        aria-required={required || undefined}
        aria-invalid={ctx.invalid(field)}
        aria-describedby={ctx.describedBy(field, `${id}-hint`)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
    </div>
  );
}


function SelectField({
  label,
  hint,
  field,
  value,
  options,
  placeholder,
  status,
  ctx,
  onChange,
}: {
  label: string;
  hint: string;
  field: string;
  value: string;
  options: readonly Option[];
  placeholder: string;
  status: "loading" | "error" | "ready";
  ctx: Ctx;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const shown = value && !options.some((option) => option.id === value) ? [...options, { id: value, label: `${value} (not in the active list)` }] : options;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        ref={ctx.bind(field)}
        name={field}
        value={value}
        aria-required="true"
        aria-invalid={ctx.invalid(field)}
        aria-describedby={ctx.describedBy(field, `${id}-hint`)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{status === "loading" ? "Loading…" : placeholder}</option>
        {shown.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="field-hint">
        {status === "error" ? "The list could not be loaded. Close this form and try again." : hint}
      </p>
    </div>
  );
}

export function SchemeForm({ record, onCancel, onSaved }: { record: Scheme | null; onCancel: () => void; onSaved: (message: string) => void }) {
  const initial: SchemeDraft = record
    ? { name: record.name, code: record.code, fundingBody: record.fundingBody, active: record.active }
    : emptySchemeDraft();
  return (
    <FormShell
      title={record ? `Edit ${record.name}` : "Create scheme"}
      submitLabel={record ? "Save changes" : "Create scheme"}
      order={SCHEME_FIELDS}
      initial={initial}
      build={buildSchemeWrite}
      save={async (body) => {
        const saved = record ? await updateScheme(record.id, body) : await createScheme(body);
        return record ? `${saved.name} was saved.` : `${saved.name} was created.`;
      }}
      onCancel={onCancel}
      onSaved={onSaved}
    >
      {(draft, update, ctx) => (
        <>
          <TextField label="Name" hint="Required. Up to 200 characters." field="name" value={draft.name} max={200} ctx={ctx} onChange={(name) => update({ name })} />
          <TextField label="Code" hint="Required. Up to 64 characters. Must be unique." field="code" value={draft.code} max={64} ctx={ctx} onChange={(code) => update({ code })} />
          <TextField label="Funding body" hint="Required. Up to 200 characters." field="fundingBody" value={draft.fundingBody} max={200} ctx={ctx} onChange={(fundingBody) => update({ fundingBody })} />
        </>
      )}
    </FormShell>
  );
}

export function ProjectForm({ record, onCancel, onSaved }: { record: Project | null; onCancel: () => void; onSaved: (message: string) => void }) {
  const schemes = useSchemeOptions();
  const initial: ProjectDraft = record
    ? { name: record.name, code: record.code, schemeId: record.schemeId, startDate: record.startDate, endDate: record.endDate ?? "", active: record.active }
    : emptyProjectDraft();
  return (
    <FormShell
      title={record ? `Edit ${record.name}` : "Create project"}
      submitLabel={record ? "Save changes" : "Create project"}
      order={PROJECT_FIELDS}
      initial={initial}
      build={buildProjectWrite}
      save={async (body) => {
        const saved = record ? await updateProject(record.id, body) : await createProject(body);
        return record ? `${saved.name} was saved.` : `${saved.name} was created.`;
      }}
      onCancel={onCancel}
      onSaved={onSaved}
    >
      {(draft, update, ctx) => (
        <>
          <TextField label="Name" hint="Required. Up to 200 characters." field="name" value={draft.name} max={200} ctx={ctx} onChange={(name) => update({ name })} />
          <TextField label="Code" hint="Required. Up to 64 characters. Must be unique across all projects." field="code" value={draft.code} max={64} ctx={ctx} onChange={(code) => update({ code })} />
          <SelectField label="Scheme" hint="Required. Only active schemes are listed." field="schemeId" value={draft.schemeId} options={schemes.options} placeholder="Choose a scheme" status={schemes.status} ctx={ctx} onChange={(schemeId) => update({ schemeId })} />
          <TextField label="Start date" hint="Required. A calendar date in IST." field="startDate" type="date" value={draft.startDate} ctx={ctx} onChange={(startDate) => update({ startDate })} />
          <TextField label="End date" hint="Optional. Leave blank for an open-ended project." field="endDate" type="date" required={false} value={draft.endDate} ctx={ctx} onChange={(endDate) => update({ endDate })} />
        </>
      )}
    </FormShell>
  );
}

function ScopeField({ value, ctx, onChange }: { value: string; ctx: Ctx; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Scope</label>
      <select
        id={id}
        ref={ctx.bind("scope")}
        name="scope"
        value={value}
        aria-required="true"
        aria-invalid={ctx.invalid("scope")}
        aria-describedby={ctx.describedBy("scope", `${id}-hint`)}
        onChange={(event) => onChange(event.target.value)}
      >
        {SIGNATORY_SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            {SCOPE_LABELS[scope]}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="field-hint">
        Who this person may sign for: one scheme, one project, or the whole agency.
      </p>
    </div>
  );
}

function SignatoryScopeFields({ draft, update, ctx }: { draft: SignatoryDraft; update: (patch: Partial<SignatoryDraft>) => void; ctx: Ctx }) {
  const schemes = useSchemeOptions(draft.scope === "scheme");
  const projects = useProjectOptions(null, draft.scope === "project");
  return (
    <>
      <ScopeField
        value={draft.scope}
        ctx={ctx}
        onChange={(scope) => {
          if (isSignatoryScope(scope)) update({ scope, schemeId: "", projectId: "" });
        }}
      />
      {draft.scope === "scheme" ? (
        <SelectField label="Scheme" hint="Required for this scope. Only active schemes are listed." field="schemeId" value={draft.schemeId} options={schemes.options} placeholder="Choose a scheme" status={schemes.status} ctx={ctx} onChange={(schemeId) => update({ schemeId })} />
      ) : null}
      {draft.scope === "project" ? (
        <SelectField label="Project" hint="Required for this scope. Only active projects are listed." field="projectId" value={draft.projectId} options={projects.options} placeholder="Choose a project" status={projects.status} ctx={ctx} onChange={(projectId) => update({ projectId })} />
      ) : null}
    </>
  );
}

export function SignatoryForm({ record, onCancel, onSaved }: { record: Signatory | null; onCancel: () => void; onSaved: (message: string) => void }) {
  const initial: SignatoryDraft = record
    ? {
        name: record.name,
        designation: record.designation,
        scope: record.scope,
        schemeId: record.schemeId ?? "",
        projectId: record.projectId ?? "",
        validFrom: record.validFrom,
        validTo: record.validTo ?? "",
        active: record.active,
      }
    : emptySignatoryDraft();
  return (
    <FormShell
      title={record ? `Edit ${record.name}` : "Create signatory"}
      submitLabel={record ? "Save changes" : "Create signatory"}
      order={SIGNATORY_FIELDS}
      initial={initial}
      build={buildSignatoryWrite}
      save={async (body) => {
        const saved = record ? await updateSignatory(record.id, body) : await createSignatory(body);
        return record ? `${saved.name} was saved.` : `${saved.name} was created.`;
      }}
      onCancel={onCancel}
      onSaved={onSaved}
    >
      {(draft, update, ctx) => (
        <>
          <TextField label="Name" hint="Required. Up to 200 characters. Do not enter a national identity number." field="name" value={draft.name} max={200} ctx={ctx} onChange={(name) => update({ name })} />
          <TextField label="Designation" hint="Required. Up to 200 characters." field="designation" value={draft.designation} max={200} ctx={ctx} onChange={(designation) => update({ designation })} />
          <SignatoryScopeFields draft={draft} update={update} ctx={ctx} />
          <TextField label="Valid from" hint="Required. A calendar date in IST." field="validFrom" type="date" value={draft.validFrom} ctx={ctx} onChange={(validFrom) => update({ validFrom })} />
          <TextField label="Valid to" hint="Optional. Leave blank for no end date." field="validTo" type="date" required={false} value={draft.validTo} ctx={ctx} onChange={(validTo) => update({ validTo })} />
        </>
      )}
    </FormShell>
  );
}

export function DeactivateDialog({
  name,
  one,
  run,
  onCancel,
  onSaved,
}: {
  name: string;
  one: string;
  run: () => Promise<string>;
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
    <Dialog title={`Deactivate ${name}?`} busy={pending} initialFocus="cancel" onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = await run();
              await queryClient.invalidateQueries({ queryKey: [SCHEME_DATA_KEY] });
              if (mounted.current) onSaved(saved);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              errorSeq.current += 1;
              setFormError({ id: errorSeq.current, message: formatMasterDataError(error).message, fields: [] });
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <p>This marks the {one} inactive. Nothing is deleted. You can mark it active again from Edit.</p>
          <FormAlert error={formError} id={errorId} />
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Deactivate</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
