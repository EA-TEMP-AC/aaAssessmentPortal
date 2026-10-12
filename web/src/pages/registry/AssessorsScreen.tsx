import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAssessor,
  deactivateAssessor,
  listAssessors,
  updateAssessor,
  type AssessorRecord,
  type CreateAssessorInput,
  type PatchAssessorInput,
} from "../../api/assessors";
import { errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { canWriteRegistry } from "../../routing/access";
import { Dialog, FormAlert } from "../masterData/dialog";
import { LanguageSelector } from "./common";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormError = {
  id: number;
  message: string;
  fields: readonly string[];
};

type DialogState =
  | { type: "create" }
  | { type: "edit"; assessor: AssessorRecord }
  | { type: "deactivate"; assessor: AssessorRecord };

export function AssessorsScreen() {
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
    queryKey: ["assessors", queryParams],
    queryFn: ({ signal }) => listAssessors(queryParams, signal),
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
        item.languages.some((l) => l.toLowerCase().includes(term)) ||
        (item.toa?.certNo && item.toa.certNo.toLowerCase().includes(term))
      );
    });
  }, [data?.items, search]);

  return (
    <section aria-labelledby="assessors-heading">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <h2 id="assessors-heading" style={{ margin: 0 }}>
            Assessors
          </h2>
          <p style={{ margin: "0.25rem 0 0", color: "#4a5568" }}>
            Assessor registry, qualifications, languages, and Training of Assessor (ToA) validity.
          </p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setDialogState({ type: "create" })}>
            Add assessor
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
          <label htmlFor="assessor-search">Search</label>
          <input
            id="assessor-search"
            type="search"
            placeholder="Search by name, code, contact, language, sector…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="assessor-status-filter">Status</label>
          <select
            id="assessor-status-filter"
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

      {isLoading && <p role="status">Loading assessors…</p>}

      {error && (
        <div role="alert" className="form-error">
          <p style={{ margin: "0 0 0.5rem" }}>Failed to load assessors: {errorMessage(error)}</p>
          <button type="button" className="button-quiet" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && (
        <>
          <p className="users-summary">
            {filteredItems.length === 1 ? "1 assessor" : `${filteredItems.length} assessors`}
            {data?.total && data.total !== filteredItems.length ? ` (filtered from ${data.total})` : ""}.
          </p>

          {filteredItems.length === 0 ? (
            <p role="status">
              {search || activeFilter ? "No assessors match the current filters." : "No assessors registered yet."}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="users-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Code</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Qualifications / Sector</th>
                    <th scope="col">Languages</th>
                    <th scope="col">ToA Validity</th>
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
                        {item.toa ? (
                          <span>
                            <strong>{item.toa.certNo}</strong>
                            <br />
                            <small>
                              {item.toa.issuedOn} to {item.toa.expiresOn}
                            </small>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
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
                              onClick={() => setDialogState({ type: "edit", assessor: item })}
                            >
                              Edit
                            </button>
                            {item.active && (
                              <button
                                type="button"
                                className="button-quiet"
                                onClick={() => setDialogState({ type: "deactivate", assessor: item })}
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
        <AssessorFormDialog
          state={dialogState}
          onClose={() => setDialogState(null)}
          onSaved={(msg) => {
            setDialogState(null);
            setNotice(msg);
            queryClient.invalidateQueries({ queryKey: ["assessors"] });
          }}
        />
      )}

      {dialogState?.type === "deactivate" && (
        <DeactivateAssessorDialog
          assessor={dialogState.assessor}
          onClose={() => setDialogState(null)}
          onDeactivated={() => {
            setDialogState(null);
            setNotice(`Assessor ${dialogState.assessor.name} deactivated.`);
            queryClient.invalidateQueries({ queryKey: ["assessors"] });
          }}
        />
      )}
    </section>
  );
}

function AssessorFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { type: "create" } | { type: "edit"; assessor: AssessorRecord };
  onClose: () => void;
  onSaved: (notice: string) => void;
}) {
  const isEdit = state.type === "edit";
  const assessor = isEdit ? state.assessor : null;

  const [name, setName] = useState(assessor?.name ?? "");
  const [code, setCode] = useState(assessor?.code ?? "");
  const [email, setEmail] = useState(assessor?.email ?? "");
  const [qualificationsText, setQualificationsText] = useState(
    assessor ? assessor.qualifications.join(", ") : "",
  );
  const [languages, setLanguages] = useState<string[]>(assessor ? [...assessor.languages] : []);
  const [hasToa, setHasToa] = useState(Boolean(assessor?.toa));
  const [toaCertNo, setToaCertNo] = useState(assessor?.toa?.certNo ?? "");
  const [toaIssuedOn, setToaIssuedOn] = useState(assessor?.toa?.issuedOn ?? "");
  const [toaExpiresOn, setToaExpiresOn] = useState(assessor?.toa?.expiresOn ?? "");
  const [yearsOfExperience, setYearsOfExperience] = useState(
    assessor?.yearsOfExperience !== null && assessor?.yearsOfExperience !== undefined
      ? String(assessor.yearsOfExperience)
      : "",
  );
  const [otherAaCount, setOtherAaCount] = useState(
    assessor?.otherAaCount !== undefined ? String(assessor.otherAaCount) : "0",
  );
  const [undertaking, setUndertaking] = useState(assessor?.undertaking ?? false);
  const [active, setActive] = useState(assessor?.active ?? true);

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

    let toaPayload = null;
    if (hasToa || toaCertNo.trim() || toaIssuedOn || toaExpiresOn) {
      const certNo = toaCertNo.trim();
      const issued = toaIssuedOn.trim();
      const expires = toaExpiresOn.trim();

      if (!certNo) {
        setFormError({
          id: Date.now(),
          message: "Enter a ToA certificate number.",
          fields: ["toaCertNo"],
        });
        return;
      }
      if (!DATE_REGEX.test(issued)) {
        setFormError({
          id: Date.now(),
          message: "Enter a valid issued date (YYYY-MM-DD).",
          fields: ["toaIssuedOn"],
        });
        return;
      }
      if (!DATE_REGEX.test(expires)) {
        setFormError({
          id: Date.now(),
          message: "Enter a valid expiry date (YYYY-MM-DD).",
          fields: ["toaExpiresOn"],
        });
        return;
      }
      if (expires < issued) {
        setFormError({
          id: Date.now(),
          message: "Expiry date must be on or after issued date.",
          fields: ["toaExpiresOn"],
        });
        return;
      }
      toaPayload = { certNo, issuedOn: issued, expiresOn: expires };
    }

    let yearsNum: number | null = null;
    if (yearsOfExperience.trim() !== "") {
      const parsed = parseInt(yearsOfExperience.trim(), 10);
      if (isNaN(parsed) || parsed < 0 || parsed > 80) {
        setFormError({
          id: Date.now(),
          message: "Years of experience must be between 0 and 80.",
          fields: ["yearsOfExperience"],
        });
        return;
      }
      yearsNum = parsed;
    }

    const otherAas = parseInt(otherAaCount.trim() || "0", 10);
    if (isNaN(otherAas) || otherAas < 0 || otherAas > 99) {
      setFormError({
        id: Date.now(),
        message: "Other AA count must be between 0 and 99.",
        fields: ["otherAaCount"],
      });
      return;
    }

    setBusy(true);
    try {
      if (isEdit && assessor) {
        const patch: PatchAssessorInput = {
          name: trimmedName,
          code: trimmedCode || null,
          email: trimmedEmail || null,
          qualifications,
          languages,
          toa: toaPayload,
          yearsOfExperience: yearsNum,
          otherAaCount: otherAas,
          undertaking,
          active,
        };
        await updateAssessor(assessor.id, patch);
        onSaved(`Assessor ${trimmedName} updated.`);
      } else {
        const createInput: CreateAssessorInput = {
          name: trimmedName,
          code: trimmedCode || undefined,
          email: trimmedEmail || undefined,
          qualifications,
          languages,
          toa: toaPayload,
          yearsOfExperience: yearsNum,
          otherAaCount: otherAas,
          undertaking,
          active,
        };
        await createAssessor(createInput);
        onSaved(`Assessor ${trimmedName} created.`);
      }
    } catch (err) {
      setFormError({ id: Date.now(), message: errorMessage(err), fields: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={isEdit ? "Edit assessor" : "Add assessor"}
      busy={busy}
      wide
      onCancel={onClose}
    >
      <FormAlert error={formError} id={errorId} />
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="assessor-name">Full name *</label>
          <input
            id="assessor-name"
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
            <label htmlFor="assessor-code">Assessor code</label>
            <input
              id="assessor-code"
              type="text"
              placeholder="e.g. ASR-01"
              maxLength={64}
              value={code}
              aria-invalid={formError?.fields.includes("code") || undefined}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="assessor-email">Contact email</label>
            <input
              id="assessor-email"
              type="email"
              placeholder="assessor@example.com"
              maxLength={320}
              value={email}
              aria-invalid={formError?.fields.includes("email") || undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="assessor-qualifications">Qualifications / Sector</label>
          <input
            id="assessor-qualifications"
            type="text"
            placeholder="e.g. Electrician L4, Electronics (comma separated)"
            value={qualificationsText}
            onChange={(e) => setQualificationsText(e.target.value)}
          />
          <p className="field-hint">Comma-separated list of certified qualifications or sectors.</p>
        </div>

        <LanguageSelector
          selected={languages}
          onChange={setLanguages}
          hasError={formError?.fields.includes("languages")}
        />

        <fieldset className="field">
          <legend>Training of Assessor (ToA) validity</legend>
          <label className="check-label" style={{ marginBottom: "0.75rem" }}>
            <input
              type="checkbox"
              checked={hasToa}
              onChange={(e) => setHasToa(e.target.checked)}
            />
            Has ToA certificate
          </label>

          {hasToa && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label htmlFor="toa-cert-no">Certificate number *</label>
                <input
                  id="toa-cert-no"
                  type="text"
                  placeholder="e.g. TOA-1234"
                  maxLength={64}
                  value={toaCertNo}
                  aria-invalid={formError?.fields.includes("toaCertNo") || undefined}
                  onChange={(e) => setToaCertNo(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="toa-issued-on">Issued on (YYYY-MM-DD) *</label>
                <input
                  id="toa-issued-on"
                  type="text"
                  placeholder="YYYY-MM-DD"
                  maxLength={10}
                  value={toaIssuedOn}
                  aria-invalid={formError?.fields.includes("toaIssuedOn") || undefined}
                  onChange={(e) => setToaIssuedOn(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="toa-expires-on">Expires on (YYYY-MM-DD) *</label>
                <input
                  id="toa-expires-on"
                  type="text"
                  placeholder="YYYY-MM-DD"
                  maxLength={10}
                  value={toaExpiresOn}
                  aria-invalid={formError?.fields.includes("toaExpiresOn") || undefined}
                  onChange={(e) => setToaExpiresOn(e.target.value)}
                />
              </div>
            </div>
          )}
        </fieldset>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className="field">
            <label htmlFor="assessor-experience">Years of experience</label>
            <input
              id="assessor-experience"
              type="number"
              min={0}
              max={80}
              placeholder="e.g. 5"
              value={yearsOfExperience}
              aria-invalid={formError?.fields.includes("yearsOfExperience") || undefined}
              onChange={(e) => setYearsOfExperience(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="assessor-other-aas">Other AAs count</label>
            <input
              id="assessor-other-aas"
              type="number"
              min={0}
              max={99}
              value={otherAaCount}
              aria-invalid={formError?.fields.includes("otherAaCount") || undefined}
              onChange={(e) => setOtherAaCount(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label className="check-label">
            <input
              type="checkbox"
              checked={undertaking}
              onChange={(e) => setUndertaking(e.target.checked)}
            />
            Assessor undertaking submitted
          </label>
        </div>

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
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create assessor"}
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

function DeactivateAssessorDialog({
  assessor,
  onClose,
  onDeactivated,
}: {
  assessor: AssessorRecord;
  onClose: () => void;
  onDeactivated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleDeactivate = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      await deactivateAssessor(assessor.id);
      onDeactivated();
    } catch (err) {
      setErrorText(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Deactivate assessor" busy={busy} onCancel={onClose}>
      {errorText && (
        <p className="form-error" role="alert">
          {errorText}
        </p>
      )}
      <p>
        Are you sure you want to deactivate <strong>{assessor.name}</strong>?
      </p>
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={handleDeactivate}>
          {busy ? "Deactivating…" : "Deactivate assessor"}
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
