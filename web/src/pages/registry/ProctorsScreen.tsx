import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProctor,
  deactivateProctor,
  listProctors,
  updateProctor,
  type CreateProctorInput,
  type PatchProctorInput,
  type ProctorRecord,
} from "../../api/assessors";
import { errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { canWriteRegistry } from "../../routing/access";
import { Dialog, FormAlert } from "../masterData/dialog";
import { LanguageSelector } from "./common";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormError = {
  id: number;
  message: string;
  fields: readonly string[];
};

type DialogState =
  | { type: "create" }
  | { type: "edit"; proctor: ProctorRecord }
  | { type: "deactivate"; proctor: ProctorRecord };

export function ProctorsScreen() {
  const session = useSession();
  const queryClient = useQueryClient();
  const canWrite = session ? canWriteRegistry(session.user.role) : false;

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const queryParams = useMemo(() => {
    return {
      page: 1,
      pageSize: 100,
      active: activeFilter === "" ? undefined : activeFilter === "true",
    };
  }, [activeFilter]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["proctors", queryParams],
    queryFn: ({ signal }) => listProctors(queryParams, signal),
  });

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data.items;
    return data.items.filter((item) => {
      return (
        item.name.toLowerCase().includes(term) ||
        (item.code && item.code.toLowerCase().includes(term)) ||
        (item.email && item.email.toLowerCase().includes(term)) ||
        item.qualifications.some((q) => q.toLowerCase().includes(term)) ||
        item.languages.some((l) => l.toLowerCase().includes(term))
      );
    });
  }, [data?.items, search]);

  return (
    <section aria-labelledby="proctors-heading">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h2 id="proctors-heading" style={{ margin: 0 }}>
            Proctors
          </h2>
          <p style={{ margin: "0.25rem 0 0", color: "#4a5568" }}>
            Proctor registry, contact details, qualifications, and languages.
          </p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setDialogState({ type: "create" })}>
            Add proctor
          </button>
        )}
      </div>

      {notice && (
        <p className="form-notice" role="status" tabIndex={-1}>
          {notice}
        </p>
      )}

      <div className="users-filters">
        <div className="field">
          <label htmlFor="proctor-search">Search</label>
          <input
            id="proctor-search"
            type="search"
            placeholder="Search by name, code, contact, language…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="proctor-status-filter">Status</label>
          <select
            id="proctor-status-filter"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as "" | "true" | "false")}
          >
            <option value="">All statuses</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
        </div>
      </div>

      <div className="users-filter-actions">
        {(search || activeFilter) && (
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setSearch("");
              setActiveFilter("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading && <p role="status">Loading proctors…</p>}

      {error && (
        <div role="alert" className="form-error">
          <p style={{ margin: "0 0 0.5rem" }}>Failed to load proctors: {errorMessage(error)}</p>
          <button type="button" className="button-quiet" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && (
        <>
          <p className="users-summary">
            {filteredItems.length === 1 ? "1 proctor" : `${filteredItems.length} proctors`}
            {data?.total && data.total !== filteredItems.length ? ` (filtered from ${data.total})` : ""}.
          </p>

          {filteredItems.length === 0 ? (
            <p role="status">
              {search || activeFilter ? "No proctors match the current filters." : "No proctors registered yet."}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="users-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Code</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Qualifications</th>
                    <th scope="col">Languages</th>
                    <th scope="col">Status</th>
                    {canWrite && <th scope="col">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{item.name}</td>
                      <td>{item.code ?? "—"}</td>
                      <td>{item.email ?? "—"}</td>
                      <td>
                        {item.qualifications.length > 0 ? item.qualifications.join(", ") : "—"}
                      </td>
                      <td>{item.languages.length > 0 ? item.languages.join(", ") : "—"}</td>
                      <td>
                        <span className={item.active ? "badge badge-active" : "badge badge-inactive"}>
                          {item.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {canWrite && (
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="button-quiet"
                              onClick={() => setDialogState({ type: "edit", proctor: item })}
                            >
                              Edit
                            </button>
                            {item.active && (
                              <button
                                type="button"
                                className="button-quiet"
                                onClick={() => setDialogState({ type: "deactivate", proctor: item })}
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {(dialogState?.type === "create" || dialogState?.type === "edit") && (
        <ProctorFormDialog
          state={dialogState}
          onClose={() => setDialogState(null)}
          onSaved={(msg) => {
            setDialogState(null);
            setNotice(msg);
            queryClient.invalidateQueries({ queryKey: ["proctors"] });
          }}
        />
      )}

      {dialogState?.type === "deactivate" && (
        <DeactivateProctorDialog
          proctor={dialogState.proctor}
          onClose={() => setDialogState(null)}
          onDeactivated={() => {
            setDialogState(null);
            setNotice(`Proctor ${dialogState.proctor.name} deactivated.`);
            queryClient.invalidateQueries({ queryKey: ["proctors"] });
          }}
        />
      )}
    </section>
  );
}

function ProctorFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { type: "create" } | { type: "edit"; proctor: ProctorRecord };
  onClose: () => void;
  onSaved: (notice: string) => void;
}) {
  const isEdit = state.type === "edit";
  const proctor = isEdit ? state.proctor : null;

  const [name, setName] = useState(proctor?.name ?? "");
  const [code, setCode] = useState(proctor?.code ?? "");
  const [email, setEmail] = useState(proctor?.email ?? "");
  const [qualificationsText, setQualificationsText] = useState(
    proctor ? proctor.qualifications.join(", ") : "",
  );
  const [languages, setLanguages] = useState<string[]>(proctor ? [...proctor.languages] : []);
  const [active, setActive] = useState(proctor?.active ?? true);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const errorId = useId();

  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError({ id: Date.now(), message: "Enter a name.", fields: ["name"] });
      nameInputRef.current?.focus();
      return;
    }

    const trimmedCode = code.trim();
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      setFormError({ id: Date.now(), message: "Enter a valid email address.", fields: ["email"] });
      return;
    }

    const qualifications = qualificationsText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    setBusy(true);
    try {
      if (isEdit && proctor) {
        const patch: PatchProctorInput = {
          name: trimmedName,
          code: trimmedCode || null,
          email: trimmedEmail || null,
          qualifications,
          languages,
          active,
        };
        await updateProctor(proctor.id, patch);
        onSaved(`Proctor ${trimmedName} updated.`);
      } else {
        const createInput: CreateProctorInput = {
          name: trimmedName,
          code: trimmedCode || undefined,
          email: trimmedEmail || undefined,
          qualifications,
          languages,
          active,
        };
        await createProctor(createInput);
        onSaved(`Proctor ${trimmedName} created.`);
      }
    } catch (err) {
      setFormError({ id: Date.now(), message: errorMessage(err), fields: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={isEdit ? "Edit proctor" : "Add proctor"}
      busy={busy}
      wide
      onCancel={onClose}
    >
      <FormAlert error={formError} id={errorId} />
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="proctor-name">Full name *</label>
          <input
            id="proctor-name"
            ref={nameInputRef}
            type="text"
            required
            maxLength={200}
            value={name}
            aria-invalid={formError?.fields.includes("name") || undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className="field">
            <label htmlFor="proctor-code">Proctor code</label>
            <input
              id="proctor-code"
              type="text"
              placeholder="e.g. PRC-01"
              maxLength={64}
              value={code}
              aria-invalid={formError?.fields.includes("code") || undefined}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="proctor-email">Contact email</label>
            <input
              id="proctor-email"
              type="email"
              placeholder="proctor@example.com"
              maxLength={320}
              value={email}
              aria-invalid={formError?.fields.includes("email") || undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="proctor-qualifications">Qualifications</label>
          <input
            id="proctor-qualifications"
            type="text"
            placeholder="e.g. Proctor L1 (comma separated)"
            value={qualificationsText}
            onChange={(e) => setQualificationsText(e.target.value)}
          />
        </div>

        <LanguageSelector
          selected={languages}
          onChange={setLanguages}
          hasError={formError?.fields.includes("languages")}
        />

        <div className="field">
          <label className="check-label">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
        </div>

        <div className="dialog-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create proctor"}
          </button>
          <button
            type="button"
            className="button-quiet"
            data-dialog-cancel
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeactivateProctorDialog({
  proctor,
  onClose,
  onDeactivated,
}: {
  proctor: ProctorRecord;
  onClose: () => void;
  onDeactivated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleDeactivate = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      await deactivateProctor(proctor.id);
      onDeactivated();
    } catch (err) {
      setErrorText(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Deactivate proctor" busy={busy} onCancel={onClose}>
      {errorText && (
        <p className="form-error" role="alert">
          {errorText}
        </p>
      )}
      <p>
        Are you sure you want to deactivate <strong>{proctor.name}</strong>?
      </p>
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={handleDeactivate}>
          {busy ? "Deactivating…" : "Deactivate proctor"}
        </button>
        <button
          type="button"
          className="button-quiet"
          data-dialog-cancel
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
