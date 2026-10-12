import { useEffect, useId, useRef, useState } from "react";
import {
  addCandidate,
  patchCandidate,
  type CandidateRecord,
} from "../../api/candidates";
import { ApiError, errorMessage } from "../../api/client";
import {
  isBlockableRuleCode,
  overrideFieldForRule,
} from "../../api/ruleErrors";
import { Dialog, FormAlert } from "../masterData/dialog";

type FormError = { id: number; message: string; fields: string[] };

type Props = {
  mode: "add" | "edit";
  batchId: string;
  candidate?: CandidateRecord | null;
  canOverride: boolean;
  onCancel: () => void;
  onSaved: (message: string) => void;
};

export function CandidateDialog({
  mode,
  batchId,
  candidate,
  canOverride,
  onCancel,
  onSaved,
}: Props) {
  const [name, setName] = useState(candidate?.name ?? "");
  const [externalRef, setExternalRef] = useState(candidate?.externalRef ?? "");
  const [accommodationsText, setAccommodationsText] = useState(
    candidate?.accommodations?.join(", ") ?? "",
  );
  const [active, setActive] = useState(candidate?.active ?? true);
  const [ratioOverrideReason, setRatioOverrideReason] = useState("");
  const [showRatioOverride, setShowRatioOverride] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);

  const errorSeq = useRef(0);
  const mounted = useRef(true);

  const errorId = useId();
  const nameId = useId();
  const refId = useId();
  const accommId = useId();
  const activeId = useId();
  const ratioId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function showError(message: string, fields: string[]) {
    setFormError({ id: ++errorSeq.current, message, fields });
  }

  function applyServerError(error: unknown) {
    if (!(error instanceof ApiError)) {
      showError(errorMessage(error), []);
      return;
    }
    const override = overrideFieldForRule(error.code);
    if (override === "ratioOverrideReason" && canOverride && isBlockableRuleCode(error.code)) {
      setShowRatioOverride(true);
      showError(errorMessage(error), ["ratioOverrideReason"]);
      return;
    }
    showError(errorMessage(error), []);
  }

  function parseAccommodations(raw: string): string[] {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  async function handleSubmit() {
    const messages: string[] = [];
    const fields: string[] = [];

    if (mode === "add") {
      if (!name.trim()) {
        messages.push("Name is required.");
        fields.push("name");
      }
      if (!externalRef.trim()) {
        messages.push("External reference is required.");
        fields.push("externalRef");
      }
    }

    if (showRatioOverride) {
      if (!ratioOverrideReason.trim()) {
        messages.push("Enter a ratio override reason to continue.");
        fields.push("ratioOverrideReason");
      } else if (ratioOverrideReason.trim().length > 2000) {
        messages.push("Override reason must be 2000 characters or fewer.");
        fields.push("ratioOverrideReason");
      }
    }

    if (messages.length > 0) {
      showError(messages.join(" "), fields);
      return;
    }

    setPending(true);
    setFormError(null);

    const accommodations = parseAccommodations(accommodationsText);
    const ratioReason = ratioOverrideReason.trim() || undefined;

    try {
      if (mode === "add") {
        await addCandidate(batchId, {
          name: name.trim(),
          externalRef: externalRef.trim(),
          accommodations,
          ratioOverrideReason: ratioReason,
        });
        if (!mounted.current) return;
        onSaved("Candidate added to roster.");
      } else if (candidate) {
        await patchCandidate(batchId, candidate.id, {
          active,
          accommodations,
          ratioOverrideReason: ratioReason,
        });
        if (!mounted.current) return;
        onSaved("Candidate details updated.");
      }
    } catch (err) {
      if (!mounted.current) return;
      setPending(false);
      applyServerError(err);
    }
  }

  return (
    <Dialog
      title={mode === "add" ? "Add candidate" : "Edit candidate"}
      busy={pending}
      onCancel={onCancel}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) void handleSubmit();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />

          {mode === "add" ? (
            <>
              <div className="field">
                <label htmlFor={nameId}>Full name</label>
                <input
                  id={nameId}
                  name="name"
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  aria-invalid={formError?.fields.includes("name") || undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    setFormError(null);
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor={refId}>External reference</label>
                <input
                  id={refId}
                  name="externalRef"
                  type="text"
                  required
                  maxLength={64}
                  value={externalRef}
                  aria-invalid={formError?.fields.includes("externalRef") || undefined}
                  onChange={(event) => {
                    setExternalRef(event.target.value);
                    setFormError(null);
                  }}
                />
              </div>
            </>
          ) : (
            <div className="field">
              <p>
                <strong>Candidate:</strong> {candidate?.name} ({candidate?.externalRef || "No external ref"})
              </p>
            </div>
          )}

          <div className="field">
            <label htmlFor={accommId}>Accommodations</label>
            <p className="field-hint">Comma-separated list (e.g. Reader, Extra time). Leave blank if none.</p>
            <input
              id={accommId}
              name="accommodations"
              type="text"
              value={accommodationsText}
              onChange={(event) => {
                setAccommodationsText(event.target.value);
                setFormError(null);
              }}
            />
          </div>

          {mode === "edit" ? (
            <div className="field">
              <label className="check-label" htmlFor={activeId}>
                <input
                  id={activeId}
                  name="active"
                  type="checkbox"
                  checked={active}
                  onChange={(event) => {
                    setActive(event.target.checked);
                    setFormError(null);
                  }}
                />
                Active on roster
              </label>
              <p className="field-hint">Inactive candidates are not counted toward the batch candidate count.</p>
            </div>
          ) : null}

          {showRatioOverride ? (
            <div className="field">
              <label htmlFor={ratioId}>Ratio override reason</label>
              <p className="field-hint">Only an AA admin can send this. It is stored and audit-logged.</p>
              <textarea
                id={ratioId}
                name="ratioOverrideReason"
                required
                maxLength={2000}
                value={ratioOverrideReason}
                aria-invalid={formError?.fields.includes("ratioOverrideReason") || undefined}
                onChange={(event) => {
                  setRatioOverrideReason(event.target.value);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}

          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">
              {showRatioOverride ? "Retry" : mode === "add" ? "Add candidate" : "Save changes"}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
