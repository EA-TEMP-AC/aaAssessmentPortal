import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../api/client";
import {
  IDENTITY_DOC_LABELS,
  IDENTITY_DOC_TYPES,
  fetchLearnerFile,
  listLearnerFiles,
  uploadLearnerFile,
  type IdentityDocType,
  type LearnerFile,
} from "../../api/learnerFiles";

const PHOTO_MAX = 2 * 1024 * 1024;
const ID_MAX = 5 * 1024 * 1024;

type Slot = { key: string; label: string; kind: "photo" | "identity"; docType?: IdentityDocType };

const SLOTS: Slot[] = [
  { key: "photo", label: "Photo", kind: "photo" },
  ...IDENTITY_DOC_TYPES.map(
    (docType): Slot => ({
      key: docType,
      label: IDENTITY_DOC_LABELS[docType],
      kind: "identity",
      docType,
    }),
  ),
];

function FileSlot({
  learnerId,
  slot,
  current,
  onChanged,
}: {
  learnerId: string;
  slot: Slot;
  current: LearnerFile | undefined;
  onChanged: () => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = slot.kind === "photo" ? PHOTO_MAX : ID_MAX;
  const accept = slot.kind === "photo" ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf";

  async function upload() {
    setError(null);
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (file.size > max) {
      setError(`The file is larger than ${max / (1024 * 1024)} MB.`);
      return;
    }
    setBusy(true);
    try {
      await uploadLearnerFile(learnerId, { kind: slot.kind, docType: slot.docType, file });
      setFile(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function view() {
    if (!current) return;
    setError(null);
    try {
      const blob = await fetchLearnerFile(learnerId, current.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{slot.label}</label>
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        disabled={busy}
      />{" "}
      <button type="button" onClick={() => void upload()} disabled={busy}>
        {current ? "Replace" : "Upload"}
      </button>
      {current ? (
        <>
          {" "}
          <button type="button" className="button-quiet" onClick={() => void view()}>
            View {slot.label}
          </button>
        </>
      ) : null}
      <p className="field-hint">
        {current ? "A file is saved." : "Nothing saved yet."}{" "}
        {slot.kind === "photo" ? "JPEG or PNG, up to 2 MB." : "JPEG, PNG or PDF, up to 5 MB."}
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

/** X-47. Photo and identity card pictures for one saved student. */
export function LearnerFilesPanel({ learnerId }: { learnerId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["learner-files", learnerId],
    queryFn: ({ signal }) => listLearnerFiles(learnerId, signal),
    retry: false,
  });
  const files = query.data ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["learner-files", learnerId] });
  return (
    <fieldset>
      <legend>Photo and identity cards</legend>
      {query.isLoading ? <p role="status">Loading saved files.</p> : null}
      {query.isError ? <p role="alert">{errorMessage(query.error)}</p> : null}
      {SLOTS.map((slot) => (
        <FileSlot
          key={slot.key}
          learnerId={learnerId}
          slot={slot}
          current={files.find((f) => f.kind === slot.kind && (f.docType ?? null) === (slot.docType ?? null))}
          onChanged={refresh}
        />
      ))}
    </fieldset>
  );
}
