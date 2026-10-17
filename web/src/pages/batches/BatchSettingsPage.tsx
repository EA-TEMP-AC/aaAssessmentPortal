import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getBatchSettings, saveBatchSettings, type BatchSettings } from "../../api/batchSettings";
import { buildPatch, describeChanges, toDraft, validateDraft, type Draft, type Problems } from "./settingsDraft";
import { errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { Dialog } from "../masterData/dialog";
import { SettingsFields } from "./SettingsFields";

function SettingsForm({ batchId, saved }: { batchId: string; saved: BatchSettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [problems, setProblems] = useState<Problems>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraft(toDraft(saved));
  }, [saved]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice(null);
  };
  const changes = describeChanges(saved, draft);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const found = validateDraft(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      window.setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    if (changes.length === 0) return;
    setConfirming(true);
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const next = await saveBatchSettings(batchId, buildPatch(saved, draft));
      queryClient.setQueryData(["batch-settings", batchId], next);
      setConfirming(false);
      setNotice("Batch settings saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const problemList = Object.values(problems);
  return (
    <form onSubmit={onSubmit} noValidate aria-describedby={problemList.length > 0 ? "settings-problems" : undefined}>
      {notice ? (
        <p ref={noticeRef} tabIndex={-1} className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {problemList.length > 0 ? (
        <div id="settings-problems" ref={summaryRef} tabIndex={-1} className="form-error" role="alert">
          <p>Please fix these before saving:</p>
          <ul>
            {problemList.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <SettingsFields draft={draft} set={set} problems={problems} />


      <div className="dialog-actions">
        <button type="submit" ref={saveRef} disabled={changes.length === 0 || saving}>
          Save settings
        </button>
        {changes.length === 0 ? <span className="field-hint">No changes to save.</span> : null}
      </div>

      {confirming ? (
        <Dialog
          title="Save batch settings?"
          busy={saving}
          onCancel={() => {
            setConfirming(false);
            setError(null);
            window.setTimeout(() => saveRef.current?.focus(), 0);
          }}
        >
          <p>These changes apply to this batch only, and each change is recorded in the audit log:</p>
          <ul>
            {changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" onClick={() => void confirm()} disabled={saving}>
              {saving ? "Saving…" : "Confirm and save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirming(false);
                setError(null);
                window.setTimeout(() => saveRef.current?.focus(), 0);
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </form>
  );
}

export function BatchSettingsPage() {
  const session = useSession();
  const { id } = useParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isAdmin = session?.user.role === "aa_admin";
  const query = useQuery({
    queryKey: ["batch-settings", id],
    enabled: Boolean(session && id && isAdmin),
    queryFn: ({ signal }) => getBatchSettings(id ?? "", signal),
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (!session || !id) return null;
  return (
    <div className="batch-detail settings-page">
      <p>
        <Link to={`/batches/${id}`}>Back to batch</Link>
      </p>
      <h1 ref={headingRef} tabIndex={-1}>
        Batch settings
      </h1>
      <p>
        Batch {id}. These settings change how the exam works for this batch only. A batch you have not changed keeps the
        normal behaviour.
      </p>
      {!isAdmin ? (
        <p className="form-error" role="alert">
          Only an AA admin can change batch settings.
        </p>
      ) : null}
      {isAdmin && query.isPending ? <p role="status">Loading batch settings…</p> : null}
      {isAdmin && query.isError ? (
        <div className="form-error" role="alert">
          <p>{errorMessage(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {isAdmin && query.data ? <SettingsForm batchId={id} saved={query.data} /> : null}
    </div>
  );
}
