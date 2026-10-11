import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAvailableAssessors, listProctors } from "../../api/assessors";
import {
  acceptBatch,
  assignBatch,
  cancelBatch,
  completeBatch,
  reassignBatch,
  rejectBatch,
  type AssignBatchInput,
  type BatchRecord,
} from "../../api/batches";
import { ApiError, errorMessage } from "../../api/client";
import {
  isBlockableRuleCode,
  isSlaExpiredCode,
  overrideFieldForRule,
  slaExpiredPrompt,
  type OverrideField,
} from "../../api/ruleErrors";
import { Dialog, FormAlert } from "../masterData/dialog";
import { isAssignAction, needsReason, type BatchAction } from "./access";
import { BATCH_ACTION_DONE, BATCH_ACTION_LABELS } from "./labels";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const REASON_MAX = 2000;

type FormError = { id: number; message: string; fields: string[] };

type Props = {
  action: BatchAction;
  batch: BatchRecord;
  canOverride: boolean;
  onCancel: () => void;
  onSaved: (message: string, warnings?: BatchRecord["warnings"]) => void;
};

function optionalReason(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function ActionDialog({ action, batch, canOverride, onCancel, onSaved }: Props) {
  const [reason, setReason] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [assessorId, setAssessorId] = useState(action === "reassign" ? "" : (batch.assessorId ?? ""));
  const [proctorId, setProctorId] = useState(batch.proctorId ?? "");
  const [ratioOverrideReason, setRatioOverrideReason] = useState("");
  const [languageOverrideReason, setLanguageOverrideReason] = useState("");
  const [needLateReason, setNeedLateReason] = useState(false);
  const [latePrompt, setLatePrompt] = useState("");
  const [visibleOverrides, setVisibleOverrides] = useState<OverrideField[]>([]);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const errorId = useId();
  const reasonId = useId();
  const lateId = useId();
  const assessorIdField = useId();
  const proctorIdField = useId();
  const ratioId = useId();
  const languageId = useId();

  const available = useQuery({
    queryKey: ["assessors-available", batch.id],
    enabled: isAssignAction(action),
    queryFn: ({ signal }) => listAvailableAssessors({ batchId: batch.id }, signal),
  });

  const proctors = useQuery({
    queryKey: ["proctors-assign"],
    enabled: isAssignAction(action),
    queryFn: ({ signal }) => listProctors({ page: 1, pageSize: 100, active: true }, signal),
  });

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
    if (isSlaExpiredCode(error.code)) {
      setNeedLateReason(true);
      setLatePrompt(slaExpiredPrompt(error.code));
      showError(`${errorMessage(error)} ${slaExpiredPrompt(error.code)}`, ["lateReason"]);
      return;
    }
    const override = overrideFieldForRule(error.code);
    if (override && canOverride && isBlockableRuleCode(error.code)) {
      setVisibleOverrides((current) => (current.includes(override) ? current : [...current, override]));
      showError(errorMessage(error), [override]);
      return;
    }
    showError(errorMessage(error), []);
  }

  async function submitAction() {
    const late = optionalReason(lateReason);
    if (action === "accept") {
      return acceptBatch(batch.id, late ? { lateReason: late } : {});
    }
    if (action === "reject") {
      return rejectBatch(batch.id, { reason: reason.trim(), ...(late ? { lateReason: late } : {}) });
    }
    if (action === "cancel") {
      return cancelBatch(batch.id, { reason: reason.trim() });
    }
    if (action === "complete") {
      return completeBatch(batch.id, { reason: reason.trim() });
    }
    const payload: AssignBatchInput = {
      assessorId: assessorId.trim(),
      proctorId: proctorId.trim() ? proctorId.trim() : null,
    };
    const ratio = optionalReason(ratioOverrideReason);
    const language = optionalReason(languageOverrideReason);
    if (ratio) payload.ratioOverrideReason = ratio;
    if (language) payload.languageOverrideReason = language;
    if (late) payload.lateReason = late;
    return action === "reassign" ? reassignBatch(batch.id, payload) : assignBatch(batch.id, payload);
  }

  return (
    <Dialog title={BATCH_ACTION_LABELS[action]} busy={pending} wide={isAssignAction(action)} onCancel={onCancel}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const messages: string[] = [];
          const fields: string[] = [];
          if (needsReason(action)) {
            const trimmed = reason.trim();
            if (!trimmed) {
              messages.push("Enter a reason.");
              fields.push("reason");
            } else if (trimmed.length > REASON_MAX) {
              messages.push(`Reason must be ${REASON_MAX} characters or fewer.`);
              fields.push("reason");
            }
          }
          if (isAssignAction(action)) {
            if (!OBJECT_ID.test(assessorId.trim())) {
              messages.push("Choose an assessor or enter a 24-character assessor id.");
              fields.push("assessorId");
            }
            if (proctorId.trim() && !OBJECT_ID.test(proctorId.trim())) {
              messages.push("Proctor id must be a 24-character id, or blank.");
              fields.push("proctorId");
            }
          }
          if (needLateReason) {
            const trimmed = lateReason.trim();
            if (!trimmed) {
              messages.push("Enter a late reason.");
              fields.push("lateReason");
            } else if (trimmed.length > REASON_MAX) {
              messages.push(`Late reason must be ${REASON_MAX} characters or fewer.`);
              fields.push("lateReason");
            }
          }
          for (const field of visibleOverrides) {
            const value =
              field === "ratioOverrideReason" ? ratioOverrideReason : languageOverrideReason;
            if (!value.trim()) {
              messages.push("Enter an override reason to continue.");
              fields.push(field);
            } else if (value.trim().length > REASON_MAX) {
              messages.push(`Override reason must be ${REASON_MAX} characters or fewer.`);
              fields.push(field);
            }
          }
          if (messages.length > 0) {
            showError(messages.join(" "), fields);
            return;
          }

          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = await submitAction();
              if (!mounted.current) return;
              onSaved(BATCH_ACTION_DONE[action], saved.warnings);
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              applyServerError(error);
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          {needsReason(action) ? (
            <div className="field">
              <label htmlFor={reasonId}>Reason</label>
              <textarea
                id={reasonId}
                name="reason"
                value={reason}
                required
                maxLength={REASON_MAX}
                aria-invalid={formError?.fields.includes("reason") || undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}
          {isAssignAction(action) ? (
            <>
              <div className="field">
                <span id={assessorIdField}>Assessor</span>
                {available.isError ? (
                  <p role="status" className="field-hint">
                    The available-assessor list could not be loaded. Enter an assessor id.
                  </p>
                ) : null}
                {available.data && available.data.length === 0 ? (
                  <p role="status" className="field-hint">
                    No assessors are available for this batch window.
                  </p>
                ) : null}
                {available.data && available.data.length > 0 ? (
                  <ul className="choice-list" aria-labelledby={assessorIdField}>
                    {available.data.map((assessor) => (
                      <li key={assessor.id}>
                        <label className="check-label">
                          <input
                            type="radio"
                            name="assessorId"
                            value={assessor.id}
                            checked={assessorId === assessor.id}
                            onChange={() => {
                              setAssessorId(assessor.id);
                              setFormError(null);
                            }}
                          />
                          {assessor.name}
                          {assessor.languages.length > 0 ? ` (${assessor.languages.join(", ")})` : ""}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <input
                    id="assign-assessor-id"
                    name="assessorId"
                    value={assessorId}
                    aria-labelledby={assessorIdField}
                    aria-invalid={formError?.fields.includes("assessorId") || undefined}
                    onChange={(event) => {
                      setAssessorId(event.target.value);
                      setFormError(null);
                    }}
                  />
                )}
              </div>
              <div className="field">
                <label htmlFor={proctorIdField}>Proctor (optional)</label>
                {proctors.data && proctors.data.items.length > 0 ? (
                  <select
                    id={proctorIdField}
                    name="proctorId"
                    value={proctorId}
                    onChange={(event) => {
                      setProctorId(event.target.value);
                      setFormError(null);
                    }}
                  >
                    <option value="">No proctor</option>
                    {proctors.data.items.map((proctor) => (
                      <option key={proctor.id} value={proctor.id}>
                        {proctor.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={proctorIdField}
                    name="proctorId"
                    value={proctorId}
                    aria-invalid={formError?.fields.includes("proctorId") || undefined}
                    onChange={(event) => {
                      setProctorId(event.target.value);
                      setFormError(null);
                    }}
                  />
                )}
                {proctors.isError ? (
                  <p className="field-hint">The proctor list could not be loaded. Enter a proctor id or leave blank.</p>
                ) : null}
              </div>
            </>
          ) : null}
          {needLateReason ? (
            <div className="field">
              <label htmlFor={lateId}>Late reason</label>
              <p className="field-hint">{latePrompt}</p>
              <textarea
                id={lateId}
                name="lateReason"
                value={lateReason}
                required
                maxLength={REASON_MAX}
                aria-invalid={formError?.fields.includes("lateReason") || undefined}
                onChange={(event) => {
                  setLateReason(event.target.value);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}
          {visibleOverrides.includes("ratioOverrideReason") ? (
            <div className="field">
              <label htmlFor={ratioId}>Ratio override reason</label>
              <p className="field-hint">Only an AA admin can send this. It is stored and audit-logged.</p>
              <textarea
                id={ratioId}
                name="ratioOverrideReason"
                value={ratioOverrideReason}
                required
                maxLength={REASON_MAX}
                aria-invalid={formError?.fields.includes("ratioOverrideReason") || undefined}
                onChange={(event) => {
                  setRatioOverrideReason(event.target.value);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}
          {visibleOverrides.includes("languageOverrideReason") ? (
            <div className="field">
              <label htmlFor={languageId}>Language override reason</label>
              <p className="field-hint">Only an AA admin can send this. It is stored and audit-logged.</p>
              <textarea
                id={languageId}
                name="languageOverrideReason"
                value={languageOverrideReason}
                required
                maxLength={REASON_MAX}
                aria-invalid={formError?.fields.includes("languageOverrideReason") || undefined}
                onChange={(event) => {
                  setLanguageOverrideReason(event.target.value);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}
          <div className="dialog-actions">
            <button type="button" data-dialog-cancel onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">{needLateReason || visibleOverrides.length > 0 ? "Retry" : BATCH_ACTION_LABELS[action]}</button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
