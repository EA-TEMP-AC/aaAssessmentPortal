import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../api/client";
import { getAccessSettings, saveAccessSettings, type AadhaarVisibility } from "../api/settings";

export function SettingsAccessPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", "access"],
    queryFn: ({ signal }) => getAccessSettings(signal),
  });

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Local draft values reflecting current query data unless toggled
  const [draftPayments, setDraftPayments] = useState<boolean | null>(null);
  const [draftQueue, setDraftQueue] = useState<boolean | null>(null);

  const abReviewerCanReadAssessorPayments =
    draftPayments ?? query.data?.abReviewerCanReadAssessorPayments ?? false;
  const ncvetViewerCanSeeAbQueue =
    draftQueue ?? query.data?.ncvetViewerCanSeeAbQueue ?? false;

  useEffect(() => {
    if (query.data) {
      setDraftPayments(query.data.abReviewerCanReadAssessorPayments);
      setDraftQueue(query.data.ncvetViewerCanSeeAbQueue);
    }
  }, [query.data]);

  async function handleToggle(
    field: "abReviewerCanReadAssessorPayments" | "ncvetViewerCanSeeAbQueue",
    value: boolean,
  ) {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setNotice(null);
    if (field === "abReviewerCanReadAssessorPayments") setDraftPayments(value);
    if (field === "ncvetViewerCanSeeAbQueue") setDraftQueue(value);

    try {
      const saved = await saveAccessSettings({ [field]: value });
      queryClient.setQueryData(["settings", "access"], saved);
      await queryClient.invalidateQueries({ queryKey: ["settings", "access"] });
      setDraftPayments(saved.abReviewerCanReadAssessorPayments);
      setDraftQueue(saved.ncvetViewerCanSeeAbQueue);
      setNotice("Settings saved.");
    } catch (err) {
      // Revert to previous
      if (field === "abReviewerCanReadAssessorPayments") {
        setDraftPayments(query.data?.abReviewerCanReadAssessorPayments ?? false);
      }
      if (field === "ncvetViewerCanSeeAbQueue") {
        setDraftQueue(query.data?.ncvetViewerCanSeeAbQueue ?? false);
      }
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleAadhaar(value: AadhaarVisibility) {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const saved = await saveAccessSettings({ aadhaarVisibility: value });
      queryClient.setQueryData(["settings", "access"], saved);
      await queryClient.invalidateQueries({ queryKey: ["settings", "access"] });
      setNotice("Settings saved.");
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setNotice(null);

    try {
      const saved = await saveAccessSettings({
        abReviewerCanReadAssessorPayments,
        ncvetViewerCanSeeAbQueue,
      });
      queryClient.setQueryData(["settings", "access"], saved);
      await queryClient.invalidateQueries({ queryKey: ["settings", "access"] });
      setDraftPayments(saved.abReviewerCanReadAssessorPayments);
      setDraftQueue(saved.ncvetViewerCanSeeAbQueue);
      setNotice("Settings saved.");
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <h1>Access settings</h1>
      <p>Configure feature access and visibility across role portals.</p>

      {query.isPending ? <p role="status">Loading access settings.</p> : null}
      {query.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(query.error)}
        </p>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}

      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}

      {saving ? <p role="status">Saving settings...</p> : null}

      {query.data ? (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={saving} className="bare-fieldset">
            <div className="field">
              <label className="check-label" htmlFor="toggle-ab-payments">
                <input
                  id="toggle-ab-payments"
                  type="checkbox"
                  role="checkbox"
                  name="abReviewerCanReadAssessorPayments"
                  checked={abReviewerCanReadAssessorPayments}
                  disabled={saving}
                  onChange={(e) =>
                    handleToggle("abReviewerCanReadAssessorPayments", e.target.checked)
                  }
                />
                AB reviewers can read assessor payments
              </label>
              <p className="field-hint">
                Allow awarding body reviewers to view assessor payments for their batches.
              </p>
            </div>

            <div className="field">
              <label className="check-label" htmlFor="toggle-ncvet-queue">
                <input
                  id="toggle-ncvet-queue"
                  type="checkbox"
                  role="checkbox"
                  name="ncvetViewerCanSeeAbQueue"
                  checked={ncvetViewerCanSeeAbQueue}
                  disabled={saving}
                  onChange={(e) =>
                    handleToggle("ncvetViewerCanSeeAbQueue", e.target.checked)
                  }
                />
                NCVET viewers can see the AB queue
              </label>
              <p className="field-hint">
                Allow NCVET viewers to inspect the awarding body validation and publication queue.
              </p>
            </div>

            <div className="field">
              <label htmlFor="aadhaar-visibility">Who can see the Aadhaar number</label>
              <select
                id="aadhaar-visibility"
                name="aadhaarVisibility"
                value={query.data.aadhaarVisibility ?? "masked"}
                disabled={saving}
                onChange={(e) => void handleAadhaar(e.target.value as AadhaarVisibility)}
              >
                <option value="hidden">Nobody (not even the last four digits)</option>
                <option value="masked">Last four digits only</option>
                <option value="full">Full number for admin and MIS, last four for others</option>
              </select>
              <p className="field-hint">
                Also controls the Aadhaar card picture: it can be opened only when the full number is
                allowed. The number is always stored encrypted. Every read is logged.
              </p>
            </div>

            <div className="dialog-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </fieldset>
        </form>
      ) : null}
    </div>
  );
}
