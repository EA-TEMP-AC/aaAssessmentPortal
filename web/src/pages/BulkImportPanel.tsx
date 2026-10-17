import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { errorMessage } from "../api/client";
import {
  bulkImport,
  downloadBulkTemplate,
  type BulkImportResult,
  type BulkType,
} from "../api/masterImport";

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

/** X-43. Add many records at once from an Excel file. The template lists the columns. */
export function BulkImportPanel({
  type,
  label,
}: {
  type: BulkType;
  label: string;
}) {
  const queryClient = useQueryClient();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  async function template() {
    setError(null);
    try {
      saveBlob(await downloadBulkTemplate(type), `${type}-template.xlsx`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function upload() {
    if (!file) {
      setError("Choose an Excel (.xlsx) file first.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("The file is larger than 5 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await bulkImport(type, file));
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="bulk-import">
      <summary>Add many {label} from an Excel file</summary>
      <p className="field-hint">
        Download the template, fill one row per record, then upload it. A row
        that already exists is skipped; a row with a problem is listed and the
        rest are added.
      </p>
      <p>
        <button type="button" onClick={() => void template()}>
          Download template
        </button>
      </p>
      <div className="field">
        <label htmlFor={fileId}>Excel file for {label}</label>
        <input
          id={fileId}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
        />
      </div>
      <p>
        <button type="button" disabled={busy} onClick={() => void upload()}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </p>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status">
          <p>
            {result.created} added, {result.skipped} already there,{" "}
            {result.errors.length} with problems (of {result.totalRows} rows).
          </p>
          {result.errors.length > 0 ? (
            <ul>
              {result.errors.map((e) => (
                <li key={`${e.row}-${e.reason}`}>
                  Row {e.row}: {e.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
