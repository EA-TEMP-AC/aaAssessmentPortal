import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../../api/client";
import {
  downloadImportTemplate,
  importQuestions,
  importReportFromError,
  type ImportResult,
} from "../../api/questionBank";
import { Dialog } from "../masterData/dialog";

const MAX_BYTES = 5 * 1024 * 1024;

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ImportDialog({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  /** Called after rows were saved, so the list can reload. */
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [validOnly, setValidOnly] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(true);
  const fileId = useId();
  const hintId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (result) reportRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  async function template() {
    setTemplateError(null);
    try {
      const blob = await downloadImportTemplate();
      saveBlob(blob, "question-import-template.xlsx");
    } catch (error) {
      if (mounted.current) setTemplateError(errorMessage(error));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setResult(null);
    setProblem(null);
    setRefused(false);
    if (!file) {
      setProblem("Choose an .xlsx file first.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setProblem("Only .xlsx files can be imported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setProblem("The file is larger than 5 MB.");
      return;
    }
    setPending(true);
    try {
      const done = await importQuestions(file, validOnly);
      if (!mounted.current) return;
      setPending(false);
      setResult(done);
      if (done.importedCount > 0) onImported();
    } catch (error) {
      if (!mounted.current) return;
      setPending(false);
      const report = importReportFromError(error);
      if (report) {
        setRefused(true);
        setResult(report);
      } else {
        setProblem(errorMessage(error));
      }
    }
  }

  const summary = result
    ? refused
      ? `Nothing was imported. ${result.errorCount} of ${result.totalRows} rows have errors. Fix them and upload again, or tick "Import valid rows only".`
      : `${result.importedCount} of ${result.totalRows} rows imported as drafts.${
          result.errorCount > 0 ? ` ${result.errorCount} rows were skipped.` : ""
        }`
    : null;

  return (
    <Dialog title="Import questions from Excel" busy={pending} wide onCancel={onCancel}>
      <p>
        Use the template so the columns match. Up to 5,000 rows and 5 MB. Imported questions start as drafts.
      </p>
      <p>
        <button type="button" onClick={() => void template()}>
          Download template (.xlsx)
        </button>
      </p>
      {templateError ? (
        <p className="form-error" role="alert">
          {templateError}
        </p>
      ) : null}
      <form noValidate aria-label="Import questions" onSubmit={(e) => void submit(e)}>
        {problem ? (
          <p ref={problemRef} tabIndex={-1} className="form-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={fileId}>Excel file</label>
          <input
            id={fileId}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={hintId}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setProblem(null);
            }}
          />
          <p id={hintId} className="field-hint">
            One question per row. Row numbers in the report match the spreadsheet rows.
          </p>
        </div>
        <label className="check-label">
          <input type="checkbox" checked={validOnly} onChange={(e) => setValidOnly(e.target.checked)} />
          Import valid rows only (skip rows with errors)
        </label>
        {result ? (
          <div ref={reportRef} tabIndex={-1} role="status" aria-label="Import report">
            <h3>Import report</h3>
            <p>{summary}</p>
            {result.errors.length > 0 ? (
              <div className="table-scroll">
                <table className="master-table">
                  <caption className="visually-hidden">Rows with errors</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">What to fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((item) => (
                      <tr key={item.row}>
                        <th scope="row">{item.row}</th>
                        <td>{item.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" data-dialog-cancel onClick={onCancel} disabled={pending}>
            {result && !refused ? "Close" : "Cancel"}
          </button>
          <button type="submit" disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
