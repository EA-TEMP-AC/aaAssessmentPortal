import { useId, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createPublicSiteItem,
  listPublicSite,
  updatePublicSiteItem,
  type PublicSiteItem,
} from "../../api/publicSite";
import { Dialog, FormAlert } from "../masterData/dialog";
import { useFormErrorFocus } from "../masterData/useFormErrorFocus";
import { CONSENT_HINT, type FieldDef, type SectionDef } from "./sections";
import {
  buildBody,
  draftFromItem,
  emptyDraft,
  formatPublicSiteError,
  hasConsentFields,
  visible,
  type Draft,
  type Failure,
} from "./write";

type FormError = Failure & { id: number };

function describedBy(ids: Array<string | null | undefined>): string | undefined {
  const value = ids.filter((id): id is string => Boolean(id)).join(" ");
  return value.length > 0 ? value : undefined;
}

export function ItemForm({
  section,
  item,
  onCancel,
  onSaved,
}: {
  section: SectionDef;
  /** Absent when adding a new item. */
  item: PublicSiteItem | null;
  onCancel: () => void;
  onSaved: (saved: PublicSiteItem) => void;
}) {
  const mode = item ? "edit" : "create";
  const [draft, setDraft] = useState<Draft>(() => (item ? draftFromItem(section, item) : emptyDraft(section)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const baseId = useId();
  const consentHintId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const parents = useQuery({
    queryKey: ["admin", "public-site", "organogram", "parents"],
    enabled: section.slug === "organogram",
    queryFn: ({ signal }) => listPublicSite("organogram", { pageSize: 100, archived: false }, signal),
  });

  const order = [...section.fields.map((field) => field.name), "consentRecorded", "consentNote"];
  useFormErrorFocus(error, fieldRefs, order);

  function setValue(name: string, value: string) {
    setDraft((current) => ({ ...current, values: { ...current.values, [name]: value } }));
    setError(null);
  }

  function invalid(name: string): boolean {
    return error?.fields.includes(name) ?? false;
  }

  function submit() {
    if (pending) return;
    const built = buildBody(section, draft, mode);
    if (!built.ok) {
      setError({ id: ++errorSeq.current, ...built });
      return;
    }
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const saved = item
          ? await updatePublicSiteItem(section.slug, item.id, built.body)
          : await createPublicSiteItem(section.slug, built.body);
        if (!mounted.current) return;
        onSaved(saved);
      } catch (caught) {
        if (!mounted.current) return;
        setPending(false);
        setError({ id: ++errorSeq.current, ...formatPublicSiteError(section, caught) });
      }
    })();
  }

  function fieldError(name: string) {
    const message = error?.byField[name];
    return message && invalid(name) ? (
      <p id={`${baseId}-${name}-error`} className="field-error">
        {message}
      </p>
    ) : null;
  }

  function control(field: FieldDef) {
    const id = `${baseId}-${field.name}`;
    const hintId = field.hint ? `${id}-hint` : null;
    const aria = {
      "aria-invalid": invalid(field.name) || undefined,
      "aria-describedby": describedBy([hintId, invalid(field.name) ? `${id}-error` : null]),
      "aria-required": field.required || undefined,
    };
    const ref = (node: HTMLElement | null) => {
      fieldRefs.current[field.name] = node;
    };
    const value = draft.values[field.name] ?? "";
    const locked = mode === "edit" && field.createOnly;

    if (field.kind === "textarea") {
      return (
        <textarea
          id={id}
          name={field.name}
          ref={ref}
          rows={4}
          value={value}
          maxLength={field.max}
          onChange={(event) => setValue(field.name, event.target.value)}
          {...aria}
        />
      );
    }
    if (field.kind === "select") {
      let options = field.options ?? [];
      if (field.name === "parentId") {
        options = (parents.data?.items ?? [])
          .filter((node) => node.id !== item?.id)
          .map((node) => ({ value: node.id, label: String(node.fields.name ?? node.id) }));
      }
      return (
        <select
          id={id}
          name={field.name}
          ref={ref}
          value={value}
          disabled={locked}
          onChange={(event) => setValue(field.name, event.target.value)}
          {...aria}
        >
          {field.required ? null : <option value="">{field.name === "parentId" ? "Top of the chart" : "Not set"}</option>}
          {field.required && value === "" ? <option value="">Choose one</option> : null}
          {options.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        id={id}
        name={field.name}
        ref={ref}
        type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "email" ? "email" : "text"}
        inputMode={field.kind === "number" ? "numeric" : undefined}
        value={value}
        readOnly={locked}
        maxLength={field.max}
        onChange={(event) => setValue(field.name, event.target.value)}
        {...aria}
      />
    );
  }

  const title = item ? `Edit ${section.singular}` : `Add ${section.singular}`;
  const consent = hasConsentFields(section, draft.values);

  return (
    <Dialog title={title} busy={pending} wide onCancel={onCancel}>
      {section.warning ? (
        <p className="public-warning" role="note">
          {section.warning}
        </p>
      ) : null}
      <form
        noValidate
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={error} id={errorId} />
          {mode === "create" ? (
            <p className="field-hint">New items are saved as drafts. An AA admin publishes them from the list.</p>
          ) : null}
          {section.fields
            .filter((field) => visible(field, draft.values))
            .map((field) => {
              const id = `${baseId}-${field.name}`;
              return (
                <div className="field" key={field.name}>
                  <label htmlFor={id}>
                    {field.label}
                    {field.required ? <span aria-hidden="true"> *</span> : null}
                  </label>
                  {control(field)}
                  {field.hint ? (
                    <p id={`${id}-hint`} className="field-hint">
                      {field.hint}
                    </p>
                  ) : null}
                  {fieldError(field.name)}
                </div>
              );
            })}
          {consent ? (
            <fieldset aria-describedby={consentHintId}>
              <legend>Consent to publish</legend>
              <p id={consentHintId} className="field-hint">
                {CONSENT_HINT}
              </p>
              <div className="field">
                <label className="check-label" htmlFor={`${baseId}-consentRecorded`}>
                  <input
                    id={`${baseId}-consentRecorded`}
                    name="consentRecorded"
                    type="checkbox"
                    ref={(node) => {
                      fieldRefs.current.consentRecorded = node;
                    }}
                    checked={draft.consentRecorded}
                    aria-invalid={invalid("consentRecorded") || undefined}
                    aria-describedby={describedBy([consentHintId, invalid("consentRecorded") ? `${baseId}-consentRecorded-error` : null])}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, consentRecorded: event.target.checked }));
                      setError(null);
                    }}
                  />
                  Consent has been recorded
                </label>
                {fieldError("consentRecorded")}
              </div>
              <div className="field">
                <label htmlFor={`${baseId}-consentNote`}>Consent note</label>
                <textarea
                  id={`${baseId}-consentNote`}
                  name="consentNote"
                  ref={(node) => {
                    fieldRefs.current.consentNote = node;
                  }}
                  rows={3}
                  maxLength={1000}
                  value={draft.values.consentNote ?? ""}
                  aria-invalid={invalid("consentNote") || undefined}
                  aria-describedby={invalid("consentNote") ? `${baseId}-consentNote-error` : undefined}
                  onChange={(event) => setValue("consentNote", event.target.value)}
                />
                {fieldError("consentNote")}
              </div>
            </fieldset>
          ) : null}
          <div className="dialog-actions">
            <button type="submit">{item ? "Save changes" : "Save draft"}</button>
            <button type="button" className="button-quiet" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
