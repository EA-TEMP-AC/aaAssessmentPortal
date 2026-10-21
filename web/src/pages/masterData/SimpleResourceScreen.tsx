import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { STATE_NAMES } from "../../api/annexure";
import type {
  AwardingBody,
  AwardingBodyWrite,
  Centre,
  CentreWrite,
  Learner,
  LearnerWrite,
  MasterPageSize,
  TrainingPartner,
  TrainingPartnerWrite,
} from "../../api/masterData";
import {
  createAwardingBody,
  createCentre,
  createLearner,
  createTrainingPartner,
  deactivateAwardingBody,
  deactivateCentre,
  deactivateTrainingPartner,
  listAwardingBodies,
  listCentres,
  listLearners,
  listTrainingPartners,
  updateAwardingBody,
  updateCentre,
  updateLearner,
  updateTrainingPartner,
} from "../../api/masterData";
import { useSession } from "../../api/session";
import {
  MASTER_COLLECTION_META,
  canReadMasterCollection,
  canWriteMasterData,
  readsEveryCentre,
} from "../masterDataAccess";
import { LearnerFilesPanel } from "./LearnerFilesPanel";
import { Dialog, FormAlert } from "./dialog";
import { formatMasterDataError } from "./formatApiError";
import { ActiveFilterField, ListScaffold, PageSizeField } from "./listScaffold";
import { READ_ONLY_NOTE, SCOPE_NOTE, emptyListMessage, listSummary } from "./listText";
import {
  buildSimpleWrite,
  emptySimpleDraft,
  isObjectId,
  simpleFieldOrder,
  type SimpleDraft,
} from "./simpleWrite";
import { useFormErrorFocus } from "./useFormErrorFocus";
import { useMasterDialog } from "./useMasterDialog";

type SimpleRecord = AwardingBody | TrainingPartner | Centre | Learner;

type Filters = {
  active: "" | "true" | "false";
  pageSize: MasterPageSize;
  tpId: string;
};

type DialogState = { type: "create" } | { type: "edit"; record: SimpleRecord } | { type: "deactivate"; record: SimpleRecord };

type FormError = { id: number; message: string; fields: string[] };

const EMPTY_FILTERS: Filters = { active: "", pageSize: 20, tpId: "" };

type SimpleCollection = "awarding-bodies" | "training-partners" | "centres" | "learners";

function display(value: string | null | undefined): string {
  return value && value.trim() ? value : "None";
}

function draftFrom(collection: SimpleCollection, record: SimpleRecord | null): SimpleDraft {
  const empty = emptySimpleDraft();
  if (!record) return empty;
  if (collection === "awarding-bodies" && "notificationEmails" in record) {
    return {
      ...empty,
      name: record.name,
      code: record.code ?? "",
      active: record.active,
      notificationEmails: record.notificationEmails.length > 0 ? [...record.notificationEmails] : [""],
    };
  }
  if (collection === "training-partners" && "email" in record) {
    return { ...empty, name: record.name, code: record.code ?? "", email: record.email ?? "", active: record.active };
  }
  if (collection === "centres" && "tpId" in record) {
    return {
      ...empty,
      name: record.name,
      code: record.code ?? "",
      tpId: record.tpId,
      state: record.state,
      email: record.email ?? "",
      active: record.active,
    };
  }
  if ("externalRef" in record) {
    return {
      ...empty,
      name: record.name,
      externalRef: record.externalRef ?? "",
      phone: record.phone ?? "",
      enrolmentNumber: record.enrolmentNumber ?? "",
      fatherName: record.fatherName ?? "",
      gender: record.gender ?? "",
      address: record.address ?? "",
      accommodations: [...record.accommodations],
      active: record.active,
    };
  }
  return empty;
}

async function loadRecords(collection: SimpleCollection, filters: Filters, page: number, signal: AbortSignal) {
  const query = {
    active: filters.active === "" ? undefined : filters.active === "true",
    page,
    pageSize: filters.pageSize,
  };
  if (collection === "awarding-bodies") return listAwardingBodies(query, signal);
  if (collection === "training-partners") return listTrainingPartners(query, signal);
  if (collection === "centres") return listCentres({ ...query, tpId: filters.tpId || undefined }, signal);
  return listLearners(query, signal);
}

async function saveRecord(collection: SimpleCollection, id: string | null, body: SimpleDraft, mode: "create" | "edit") {
  const built = buildSimpleWrite(collection, body, mode);
  if (!built.ok) return built;
  if (collection === "awarding-bodies") {
    const payload = built.body as AwardingBodyWrite;
    const saved = id ? await updateAwardingBody(id, payload) : await createAwardingBody(payload);
    return { ok: true as const, name: saved.name };
  }
  if (collection === "training-partners") {
    const payload = built.body as TrainingPartnerWrite;
    const saved = id ? await updateTrainingPartner(id, payload) : await createTrainingPartner(payload);
    return { ok: true as const, name: saved.name };
  }
  if (collection === "centres") {
    const payload = built.body as CentreWrite;
    const saved = id ? await updateCentre(id, payload) : await createCentre(payload);
    return { ok: true as const, name: saved.name };
  }
  const payload = built.body as LearnerWrite;
  const saved = id ? await updateLearner(id, payload) : await createLearner(payload);
  return { ok: true as const, name: saved.name };
}

function SimpleForm({
  collection,
  record,
  onCancel,
  onSaved,
}: {
  collection: SimpleCollection;
  record: SimpleRecord | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const meta = MASTER_COLLECTION_META[collection];
  const editing = record !== null;
  const editingMasked =
    record && "aadhaarMasked" in record ? (record.aadhaarMasked ?? (record.hasAadhaar ? "Saved" : null)) : null;
  const [draft, setDraft] = useState(() => draftFrom(collection, record));
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const fieldOrder = useMemo(() => simpleFieldOrder(collection, draft), [collection, draft]);
  useFormErrorFocus(formError, fieldRefs, fieldOrder);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const nameId = useId();
  const codeId = useId();
  const emailId = useId();
  const tpId = useId();
  const stateId = useId();
  const externalRefId = useId();
  const phoneId = useId();
  const enrolmentId = useId();
  const fatherId = useId();
  const genderId = useId();
  const addressId = useId();
  const aadhaarId = useId();
  const activeId = useId();
  const listBaseId = useId();

  function bind(field: string) {
    return (node: HTMLElement | null) => {
      fieldRefs.current[field] = node;
    };
  }

  function described(field: string, hintId: string) {
    return formError?.fields.includes(field) ? `${hintId} ${errorId}` : hintId;
  }

  function update(patch: Partial<SimpleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  const title = editing ? `Edit ${record.name}` : `Create ${meta.one}`;
  const codeHint = editing ? "Optional. Leave blank to clear the code. Up to 64 characters." : "Optional. Up to 64 characters.";

  return (
    <Dialog title={title} busy={pending} onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const built = buildSimpleWrite(collection, draft, editing ? "edit" : "create");
          if (!built.ok) {
            setFormError({ id: errorSeq.current + 1, message: built.message, fields: built.fields });
            errorSeq.current += 1;
            return;
          }
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = editing
                ? await saveRecord(collection, record.id, draft, "edit")
                : await saveRecord(collection, null, draft, "create");
              if (!saved.ok) {
                if (!mounted.current) return;
                setPending(false);
                setFormError({ id: errorSeq.current + 1, message: saved.message, fields: saved.fields });
                errorSeq.current += 1;
                return;
              }
              await queryClient.invalidateQueries({ queryKey: ["master-data", collection] });
              if (!mounted.current) return;
              onSaved(editing ? `${saved.name} was saved.` : `${saved.name} was created.`);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              const formatted = formatMasterDataError(error);
              const known = formatted.field && fieldOrder.includes(formatted.field) ? [formatted.field] : [];
              setFormError({ id: errorSeq.current + 1, message: formatted.message, fields: known });
              errorSeq.current += 1;
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          <div className="field">
            <label htmlFor={nameId}>Name</label>
            <input
              id={nameId}
              ref={bind("name")}
              name="name"
              type="text"
              value={draft.name}
              maxLength={200}
              autoComplete={collection === "learners" ? "name" : "organization"}
              aria-required="true"
              aria-invalid={formError?.fields.includes("name") || undefined}
              aria-describedby={described("name", `${nameId}-hint`)}
              onChange={(event) => update({ name: event.target.value })}
            />
            <p id={`${nameId}-hint`} className="field-hint">
              Required. Up to 200 characters.
            </p>
          </div>
          {collection !== "learners" ? (
            <div className="field">
              <label htmlFor={codeId}>Code</label>
              <input
                id={codeId}
                ref={bind("code")}
                name="code"
                type="text"
                value={draft.code}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={formError?.fields.includes("code") || undefined}
                aria-describedby={described("code", `${codeId}-hint`)}
                onChange={(event) => update({ code: event.target.value })}
              />
              <p id={`${codeId}-hint`} className="field-hint">
                {codeHint}
              </p>
            </div>
          ) : null}
          {collection === "awarding-bodies" ? (
            <fieldset>
              <legend>Notification emails</legend>
              <p id={`${listBaseId}-email-hint`} className="field-hint">
                At least one address. Each address must be unique.
              </p>
              {draft.notificationEmails.map((value, index) => {
                const field = `notificationEmails.${index}`;
                const inputId = `${listBaseId}-email-${index}`;
                return (
                  <div className="repeat-row" key={field}>
                    <div className="field">
                      <label htmlFor={inputId}>Notification email {index + 1}</label>
                      <input
                        id={inputId}
                        ref={bind(field)}
                        name={field}
                        type="email"
                        value={value}
                        maxLength={320}
                        autoComplete="off"
                        aria-required={index === 0 || undefined}
                        aria-invalid={formError?.fields.includes(field) || undefined}
                        aria-describedby={described(field, `${listBaseId}-email-hint`)}
                        onChange={(event) => {
                          const next = [...draft.notificationEmails];
                          next[index] = event.target.value;
                          update({ notificationEmails: next });
                        }}
                      />
                    </div>
                    {draft.notificationEmails.length > 1 ? (
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => update({ notificationEmails: draft.notificationEmails.filter((_, item) => item !== index) })}
                      >
                        Remove notification email {index + 1}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <button type="button" className="button-quiet" onClick={() => update({ notificationEmails: [...draft.notificationEmails, ""] })}>
                Add notification email
              </button>
            </fieldset>
          ) : null}
          {collection === "training-partners" || collection === "centres" ? (
            <div className="field">
              <label htmlFor={emailId}>Email</label>
              <input
                id={emailId}
                ref={bind("email")}
                name="email"
                type="email"
                value={draft.email}
                maxLength={320}
                autoComplete="off"
                aria-invalid={formError?.fields.includes("email") || undefined}
                aria-describedby={described("email", `${emailId}-hint`)}
                onChange={(event) => update({ email: event.target.value })}
              />
              <p id={`${emailId}-hint`} className="field-hint">
                {editing ? "Optional. Leave blank to clear the email." : "Optional."}
              </p>
            </div>
          ) : null}
          {collection === "centres" ? (
            <div className="field">
              <label htmlFor={tpId}>Training partner id</label>
              <input
                id={tpId}
                ref={bind("tpId")}
                name="tpId"
                type="text"
                value={draft.tpId}
                autoComplete="off"
                spellCheck={false}
                aria-required="true"
                aria-invalid={formError?.fields.includes("tpId") || undefined}
                aria-describedby={described("tpId", `${tpId}-hint`)}
                onChange={(event) => update({ tpId: event.target.value })}
              />
              <p id={`${tpId}-hint`} className="field-hint">
                Required. 24-character id of a training partner.
              </p>
            </div>
          ) : null}
          {collection === "centres" ? (
            <div className="field">
              <label htmlFor={stateId}>State</label>
              <select
                id={stateId}
                ref={bind("state")}
                name="state"
                value={draft.state}
                aria-required="true"
                aria-invalid={formError?.fields.includes("state") || undefined}
                aria-describedby={described("state", `${stateId}-hint`)}
                onChange={(event) => update({ state: event.target.value })}
              >
                <option value="">Choose a state</option>
                {STATE_NAMES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              <p id={`${stateId}-hint`} className="field-hint">
                Required. Annexure IV state or union territory.
              </p>
            </div>
          ) : null}
          {collection === "learners" ? (
            <>
              <div className="field">
                <label htmlFor={externalRefId}>Student ID / Candidate ID</label>
                <input
                  id={externalRefId}
                  ref={bind("externalRef")}
                  name="externalRef"
                  type="text"
                  value={draft.externalRef}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={formError?.fields.includes("externalRef") || undefined}
                  aria-describedby={described("externalRef", `${externalRefId}-hint`)}
                  onChange={(event) => update({ externalRef: event.target.value })}
                />
                <p id={`${externalRefId}-hint`} className="field-hint">
                  Optional. The student or candidate id from the training partner. Up to 64 characters.
                </p>
              </div>
              <div className="field">
                <label htmlFor={enrolmentId}>Enrolment number</label>
                <input
                  id={enrolmentId}
                  ref={bind("enrolmentNumber")}
                  name="enrolmentNumber"
                  type="text"
                  value={draft.enrolmentNumber}
                  maxLength={64}
                  autoComplete="off"
                  aria-invalid={formError?.fields.includes("enrolmentNumber") || undefined}
                  onChange={(event) => update({ enrolmentNumber: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={fatherId}>Father's / Husband's name</label>
                <input
                  id={fatherId}
                  ref={bind("fatherName")}
                  name="fatherName"
                  type="text"
                  value={draft.fatherName}
                  maxLength={200}
                  autoComplete="off"
                  aria-invalid={formError?.fields.includes("fatherName") || undefined}
                  onChange={(event) => update({ fatherName: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={genderId}>Gender</label>
                <select
                  id={genderId}
                  ref={bind("gender")}
                  name="gender"
                  value={draft.gender}
                  aria-invalid={formError?.fields.includes("gender") || undefined}
                  onChange={(event) => update({ gender: event.target.value })}
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={addressId}>Address</label>
                <textarea
                  id={addressId}
                  ref={bind("address")}
                  name="address"
                  rows={3}
                  maxLength={500}
                  value={draft.address}
                  aria-invalid={formError?.fields.includes("address") || undefined}
                  onChange={(event) => update({ address: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`${aadhaarId}-type`}>Identification Type</label>
                <select id={`${aadhaarId}-type`} name="identificationType" value="aadhaar" disabled onChange={() => undefined}>
                  <option value="aadhaar">Aadhaar Number</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={aadhaarId}>Aadhaar Number</label>
                <input
                  id={aadhaarId}
                  ref={bind("aadhaar")}
                  name="aadhaar"
                  type="text"
                  inputMode="numeric"
                  value={draft.aadhaar}
                  maxLength={14}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={editing && editingMasked ? editingMasked : undefined}
                  aria-invalid={formError?.fields.includes("aadhaar") || undefined}
                  aria-describedby={`${aadhaarId}-hint`}
                  onChange={(event) => update({ aadhaar: event.target.value })}
                />
                <p id={`${aadhaarId}-hint`} className="field-hint">
                  Optional. 12 digits. Stored encrypted and shown only as the last four digits.
                  {editing && editingMasked ? " Leave blank to keep the saved number." : ""}
                </p>
              </div>
              {editing && record && "hasAadhaar" in record ? <LearnerFilesPanel learnerId={record.id} /> : null}
              <div className="field">
                <label htmlFor={phoneId}>Mobile No.</label>
                <input
                  id={phoneId}
                  ref={bind("phone")}
                  name="phone"
                  type="tel"
                  value={draft.phone}
                  maxLength={32}
                  autoComplete="tel"
                  aria-invalid={formError?.fields.includes("phone") || undefined}
                  aria-describedby={described("phone", `${phoneId}-hint`)}
                  onChange={(event) => update({ phone: event.target.value })}
                />
                <p id={`${phoneId}-hint`} className="field-hint">
                  Optional. Up to 32 characters.
                </p>
              </div>
              <fieldset>
                <legend>Accommodations</legend>
                <p id={`${listBaseId}-acc-hint`} className="field-hint">
                  Optional. One accommodation per row, up to 100 characters.
                </p>
                {draft.accommodations.map((value, index) => {
                  const field = `accommodations.${index}`;
                  const inputId = `${listBaseId}-acc-${index}`;
                  return (
                    <div className="repeat-row" key={field}>
                      <div className="field">
                        <label htmlFor={inputId}>Accommodation {index + 1}</label>
                        <input
                          id={inputId}
                          ref={bind(field)}
                          name={field}
                          type="text"
                          value={value}
                          maxLength={100}
                          aria-invalid={formError?.fields.includes(field) || undefined}
                          aria-describedby={described(field, `${listBaseId}-acc-hint`)}
                          onChange={(event) => {
                            const next = [...draft.accommodations];
                            next[index] = event.target.value;
                            update({ accommodations: next });
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => update({ accommodations: draft.accommodations.filter((_, item) => item !== index) })}
                      >
                        Remove accommodation {index + 1}
                      </button>
                    </div>
                  );
                })}
                <button type="button" className="button-quiet" onClick={() => update({ accommodations: [...draft.accommodations, ""] })}>
                  Add accommodation
                </button>
              </fieldset>
            </>
          ) : null}
          <div className="field">
            <label className="check-label" htmlFor={activeId}>
              <input
                id={activeId}
                name="active"
                type="checkbox"
                checked={draft.active}
                aria-describedby={`${activeId}-hint`}
                onChange={(event) => update({ active: event.target.checked })}
              />
              Active
            </label>
            <p id={`${activeId}-hint`} className="field-hint">
              Clear this to mark the record inactive.
            </p>
          </div>
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{editing ? "Save changes" : `Create ${meta.one}`}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}

function DeactivateConfirm({
  collection,
  record,
  onCancel,
  onSaved,
}: {
  collection: Exclude<SimpleCollection, "learners">;
  record: SimpleRecord;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const meta = MASTER_COLLECTION_META[collection];
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
    <Dialog title={`Deactivate ${record.name}?`} busy={pending} initialFocus="cancel" onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved =
                collection === "awarding-bodies"
                  ? await deactivateAwardingBody(record.id)
                  : collection === "training-partners"
                    ? await deactivateTrainingPartner(record.id)
                    : await deactivateCentre(record.id);
              await queryClient.invalidateQueries({ queryKey: ["master-data", collection] });
              if (!mounted.current) return;
              onSaved(`${saved.name} is now inactive.`);
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
          <p>This marks the {meta.one} inactive. You can mark it active again from Edit.</p>
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

function cellsFor(collection: SimpleCollection, record: SimpleRecord): ReactNode[] {
  const status = record.active ? "Active" : "Inactive";
  if (collection === "awarding-bodies" && "notificationEmails" in record) {
    return [record.name, display(record.code), record.notificationEmails.join(", ") || "None", status];
  }
  if (collection === "training-partners" && "email" in record) {
    return [record.name, display(record.code), display(record.email), status];
  }
  if (collection === "centres" && "tpId" in record) {
    return [record.name, display(record.code), record.tpId, record.state, display(record.email), status];
  }
  if ("accommodations" in record) {
    return [
      record.name,
      display(record.externalRef),
      display(record.enrolmentNumber),
      display(record.fatherName),
      display(record.gender),
      display(record.aadhaar ?? record.aadhaarMasked ?? (record.hasAadhaar ? "Saved" : null)),
      display(record.phone),
      record.accommodations.length > 0 ? record.accommodations.join(", ") : "None",
      status,
    ];
  }
  return [record.name, status];
}

export function SimpleResourceScreen({ collection }: { collection: SimpleCollection }) {
  const session = useSession();
  const role = session?.user.role ?? null;
  const canRead = role ? canReadMasterCollection(role, collection) : false;
  const canWrite = role ? canWriteMasterData(role) && canRead : false;
  const showTpFilter = role ? readsEveryCentre(role) && collection === "centres" : false;
  const meta = MASTER_COLLECTION_META[collection];
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const chrome = useMasterDialog(dialog !== null);
  const tpFilterId = useId();

  const records = useQuery({
    queryKey: ["master-data", collection, applied, page],
    enabled: canRead,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => loadRecords(collection, applied, page, signal),
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
  const filtered = Boolean(applied.active || (showTpFilter && applied.tpId));
  const columns = [
    "Name",
    ...(collection === "learners" ? ["Student ID", "Enrolment number", "Father's / Husband's name", "Gender", "Aadhaar", "Mobile No.", "Accommodations"] : ["Code"]),
    ...(collection === "awarding-bodies" ? ["Notification emails"] : []),
    ...(collection === "training-partners" ? ["Email"] : []),
    ...(collection === "centres" ? ["Training partner id", "State", "Email"] : []),
    "Status",
    ...(canWrite ? ["Actions"] : []),
  ];
  const notes = [SCOPE_NOTE];
  if (!canWrite) notes.push(READ_ONLY_NOTE);
  if (collection === "learners" && canWrite) notes.push("Learners cannot be deleted.");

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

  return (
    <ListScaffold
      title={meta.title}
      lede={meta.lede}
      notes={notes}
      canWrite={canWrite}
      createLabel={`Create ${meta.one}`}
      onCreate={(event) => openDialog(event, { type: "create" })}
      filterLabel={`Filter ${meta.many}`}
      filters={
        <>
          <ActiveFilterField
            id={`${collection}-active`}
            value={draftFilters.active}
            onChange={(active) => setDraftFilters((current) => ({ ...current, active }))}
          />
          {showTpFilter ? (
            <div className="field">
              <label htmlFor={tpFilterId}>Training partner id</label>
              <input
                id={tpFilterId}
                name="tpId"
                type="text"
                value={draftFilters.tpId}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${tpFilterId}-hint`}
                onChange={(event) => setDraftFilters((current) => ({ ...current, tpId: event.target.value }))}
              />
              <p id={`${tpFilterId}-hint`} className="field-hint">
                Optional. 24-character id. Leave blank to include every training partner you can read.
              </p>
            </div>
          ) : null}
          <PageSizeField
            id={`${collection}-page-size`}
            value={draftFilters.pageSize}
            onChange={(pageSize) => setDraftFilters((current) => ({ ...current, pageSize }))}
          />
        </>
      }
      onApply={() => {
        const tpId = draftFilters.tpId.trim();
        if (showTpFilter && tpId && !isObjectId(tpId)) {
          setFilterError("Training partner id must be a 24-character id, or left blank.");
          return;
        }
        setFilterError(null);
        chrome.setNotice(null);
        setApplied({ ...draftFilters, tpId: showTpFilter ? tpId : "" });
        setPage(1);
      }}
      onClear={() => {
        setDraftFilters(EMPTY_FILTERS);
        setApplied(EMPTY_FILTERS);
        setPage(1);
        setFilterError(null);
        chrome.setNotice(null);
      }}
      filterError={filterError}
      isError={records.isError}
      isFetching={records.isFetching}
      error={records.error}
      onRetry={() => void records.refetch()}
      summary={records.isFetching ? `Loading ${meta.many}.` : result ? listSummary(result.page, result.pageSize, result.total, meta.one, meta.many) : ""}
      columns={columns}
      caption={meta.title}
      rows={
        result && result.items.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{emptyListMessage(meta.many, filtered)}</td>
          </tr>
        ) : (
          result?.items.map((record) => (
            <tr key={record.id}>
              {cellsFor(collection, record).map((cell, index) => (
                <td key={columns[index] ?? index}>{cell}</td>
              ))}
              {canWrite ? (
                <td>
                  <div className="row-actions">
                    <button type="button" className="button-quiet" onClick={(event) => openDialog(event, { type: "edit", record })}>
                      Edit {record.name}
                    </button>
                    {collection !== "learners" && record.active ? (
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={(event) => openDialog(event, { type: "deactivate", record })}
                      >
                        Deactivate {record.name}
                      </button>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))
        )
      }
      showTable={Boolean(result)}
      page={result?.page ?? 1}
      hasNext={result ? result.page * result.pageSize < result.total : false}
      onPrevious={() => setPage((current) => Math.max(1, current - 1))}
      onNext={() => setPage((current) => current + 1)}
      pagerLabel={`${meta.title} pages`}
      pageRef={chrome.pageRef}
      notice={chrome.notice}
      noticeRef={chrome.noticeRef}
      dialog={
        dialog?.type === "create" ? (
          <SimpleForm collection={collection} record={null} onCancel={cancelDialog} onSaved={onSaved} />
        ) : dialog?.type === "edit" ? (
          <SimpleForm key={dialog.record.id} collection={collection} record={dialog.record} onCancel={cancelDialog} onSaved={onSaved} />
        ) : dialog?.type === "deactivate" && collection !== "learners" ? (
          <DeactivateConfirm collection={collection} record={dialog.record} onCancel={cancelDialog} onSaved={onSaved} />
        ) : null
      }
    />
  );
}
