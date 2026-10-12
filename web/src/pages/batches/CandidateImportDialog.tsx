import { useEffect, useId, useRef, useState } from "react";
import {
  importCandidatesCsv,
  type CsvImportResponse,
} from "../../api/candidates";
import { ApiError, errorMessage } from "../../api/client";
import {
  isBlockableRuleCode,
  overrideFieldForRule,
} from "../../api/ruleErrors";
import { Dialog, FormAlert } from "../masterData/dialog";

type FormError = { id: number; message: string; fields: string[] };

type Props = {
  batchId: string;
  canOverride: boolean;
  onCancel: () => void;
  onImportComplete: (message: string, result: CsvImportResponse) => void;
};

export function CandidateImportDialog({
  batchId,
  canOverride,
  onCancel,
  onImportComplete,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [ratioOverrideReason, setRatioOverrideReason] = useState("");
  const [showRatioOverride, setShowRatioOverride] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [importResult, setImportResult] = useState<CsvImportResponse | null>(null);

  const errorSeq = useRef(0);
  const mounted = useRef(true);

  const errorId = useId();
  const fileId = useId();
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

  async function handleSubmit() {
    if (!file) {
      showError("Please select a CSV file to upload.", ["file"]);
      return;
    }

    if (showRatioOverride) {
      if (!ratioOverrideReason.trim()) {
        showError("Enter a ratio override reason to continue.", ["ratioOverrideReason"]);
        return;
      } else if (ratioOverrideReason.trim().length > 2000) {
        showError("Override reason must be 2000 characters or fewer.", ["ratioOverrideReason"]);
        return;
      }
    }

    setPending(true);
    setFormError(null);
    setImportResult(null);

    try {
      const result = await importCandidatesCsv(
        batchId,
        file,
        ratioOverrideReason.trim() || undefined,
      );
      if (!mounted.current) return;
      setPending(false);
      setImportResult(result);
      const msg = `Import complete: ${result.created} created, ${result.skipped} duplicate(s) skipped.`;
      onImportComplete(msg, result);
    } catch (err) {
      if (!mounted.current) return;
      setPending(false);
      applyServerError(err);
    }
  }

  return (
    <Dialog title="Import candidates from CSV" busy={pending} onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) void handleSubmit();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />

          <p className="field-hint">
            Upload a CSV file with columns <code>name,externalRef</code> in the header row.
          </p>
          <p className="field-hint">
            Note: Cells starting with <code>=</code>, <code>+</code>, <code>-</code>, or <code>@</code> are neutralised with a leading quote to prevent formula execution.
          </p>

          <div className="field">
            <label htmlFor={fileId}>CSV file</label>
            <input
              id={fileId}
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              aria-label="CSV file"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                setFormError(null);
                setImportResult(null);
              }}
            />
          </div>

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

          {importResult ? (
            <div className="import-results">
              <p className="form-notice" role="status">
                Import processed: {importResult.created} candidate(s) added, {importResult.skipped} duplicate(s) skipped.
              </p>
              {importResult.errors.length > 0 ? (
                <div className="form-error" role="alert">
                  <p><strong>Errors in {importResult.errors.length} row(s):</strong></p>
                  <ul>
                    {importResult.errors.map((err, idx) => (
                      <li key={`${err.row}-${idx}`}>
                        Row {err.row}: {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              {importResult ? "Close" : "Cancel"}
            </button>
            <button type="submit">
              {showRatioOverride ? "Retry upload" : "Upload and import"}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
