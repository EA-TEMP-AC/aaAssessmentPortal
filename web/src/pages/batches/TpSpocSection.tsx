import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { saveTpSpoc, type BatchRecord } from "../../api/batches";
import { errorMessage } from "../../api/client";
import type { Role } from "../../routing/access";

/** X-29. Who may set the training partner's contact person. The server checks the batch as well. */
const TP_SPOC_ROLES: readonly Role[] = ["aa_admin", "mis", "tp"];

const PHONE = /^\+?\d[\d ]{6,18}\d$/;

/**
 * The training partner's contact person (name and phone) for one batch. Personal data: shown only
 * to staff who can read the batch, never written to the audit log.
 */
export function TpSpocSection({
  batch,
  role,
}: {
  batch: BatchRecord;
  role: Role;
}) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const phoneId = useId();
  const [name, setName] = useState(batch.tpSpoc?.name ?? "");
  const [contact, setContact] = useState(batch.tpSpoc?.contact ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [problems, setProblems] = useState<{ name?: string; contact?: string }>(
    {},
  );
  const canEdit = TP_SPOC_ROLES.includes(role);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof problems = {};
    if (name.trim() === "") next.name = "Enter the name of the contact person.";
    if (contact.trim() !== "" && !PHONE.test(contact.trim())) {
      next.contact =
        "Enter a phone number with 8 to 20 digits. A leading + and spaces are allowed.";
    }
    setProblems(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveTpSpoc(batch.id, {
        name: name.trim(),
        contact: contact.trim() === "" ? null : contact.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
      setMessage({ kind: "ok", text: "Contact person saved." });
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="tp-spoc-heading">
      <h2 id="tp-spoc-heading">Training partner contact</h2>
      {batch.tpSpoc ? (
        <p>
          {batch.tpSpoc.name}
          {batch.tpSpoc.contact
            ? `, ${batch.tpSpoc.contact}`
            : ", no phone number"}
        </p>
      ) : (
        <p className="field-hint">
          No contact person has been set for this batch.
        </p>
      )}
      {canEdit ? (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="field">
            <label htmlFor={nameId}>Contact person name</label>
            <input
              id={nameId}
              type="text"
              maxLength={120}
              value={name}
              aria-invalid={problems.name ? true : undefined}
              aria-describedby={problems.name ? `${nameId}-error` : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {problems.name ? (
              <p id={`${nameId}-error`} className="field-error">
                {problems.name}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor={phoneId}>Contact phone number (optional)</label>
            <input
              id={phoneId}
              type="tel"
              inputMode="tel"
              value={contact}
              aria-invalid={problems.contact ? true : undefined}
              aria-describedby={
                problems.contact ? `${phoneId}-error` : undefined
              }
              onChange={(event) => setContact(event.target.value)}
            />
            {problems.contact ? (
              <p id={`${phoneId}-error`} className="field-error">
                {problems.contact}
              </p>
            ) : null}
          </div>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save contact person"}
          </button>
          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={message.kind === "error" ? "form-error" : "field-hint"}
            >
              {message.text}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
