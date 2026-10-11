import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { BATCH_MODES, createBatch, type CreateBatchInput } from "../../api/batches";
import { errorMessage } from "../../api/client";
import {
  BATCH_TYPES,
  listAwardingBodies,
  listCentres,
  listQualifications,
  listTrainingPartners,
} from "../../api/masterData";
import { isBlockableRuleCode } from "../../api/ruleErrors";
import { useSession } from "../../api/session";
import { FormAlert } from "../masterData/dialog";
import { canCreateBatch } from "./access";

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_MAX = 2000;
const LANGUAGE_MAX = 80;

type FormError = { id: number; message: string; fields: string[] };

const FIELD_ORDER = [
  "abId",
  "qualificationId",
  "type",
  "mode",
  "assessmentStartDate",
  "assessmentEndDate",
  "tpId",
  "centreId",
  "candidateCount",
  "assessmentLanguage",
  "recognitionOverrideReason",
] as const;

export function BatchCreatePage() {
  const session = useSession();
  const navigate = useNavigate();
  const [draft, setDraft] = useState({
    abId: "",
    qualificationId: "",
    type: "STT",
    mode: "offline",
    assessmentStartDate: "",
    assessmentEndDate: "",
    tpId: "",
    centreId: "",
    candidateCount: "1",
    assessmentLanguage: "",
    recognitionOverrideReason: "",
  });
  const [needRecognitionOverride, setNeedRecognitionOverride] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const errorSeq = useRef(0);
  const mounted = useRef(true);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const errorId = useId();

  const awardingBodies = useQuery({
    queryKey: ["awarding-bodies", "batch-create"],
    enabled: Boolean(session),
    queryFn: ({ signal }) => listAwardingBodies({ page: 1, pageSize: 100, active: true }, signal),
  });
  const qualifications = useQuery({
    queryKey: ["qualifications", "batch-create"],
    enabled: Boolean(session),
    queryFn: ({ signal }) => listQualifications({ page: 1, pageSize: 100 }, signal),
  });
  const partners = useQuery({
    queryKey: ["training-partners", "batch-create"],
    enabled: Boolean(session),
    queryFn: ({ signal }) => listTrainingPartners({ page: 1, pageSize: 100, active: true }, signal),
  });
  const centres = useQuery({
    queryKey: ["centres", "batch-create", draft.tpId],
    enabled: Boolean(session && draft.tpId && OBJECT_ID.test(draft.tpId)),
    queryFn: ({ signal }) => listCentres({ page: 1, pageSize: 100, active: true, tpId: draft.tpId }, signal),
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!formError || formError.fields.length === 0) return;
    const first = FIELD_ORDER.find((key) => formError.fields.includes(key));
    const node = first ? fieldRefs.current[first] : null;
    node?.focus();
  }, [formError]);

  if (!session) return null;
  if (!canCreateBatch(session.user.role)) return <Navigate to="/batches" replace />;

  const canOverride = session.user.role === "aa_admin";

  function bind(key: string) {
    return (node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => {
      fieldRefs.current[key] = node;
    };
  }

  function showError(message: string, fields: string[]) {
    setFormError({ id: ++errorSeq.current, message, fields });
  }

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  return (
    <div className="batch-create">
      <p>
        <Link to="/batches">Back to batches</Link>
      </p>
      <h1>Create batch</h1>
      <p>Sector, ratio class, and state are copied by the server from the qualification and centre.</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const messages: string[] = [];
          const fields: string[] = [];
          const requiredIds: Array<[keyof typeof draft, string]> = [
            ["abId", "awarding body"],
            ["qualificationId", "qualification"],
            ["tpId", "training partner"],
            ["centreId", "centre"],
          ];
          for (const [key, label] of requiredIds) {
            if (!OBJECT_ID.test(draft[key].trim())) {
              messages.push(`Enter a 24-character ${label} id.`);
              fields.push(key);
            }
          }
          if (!draft.assessmentStartDate || !CALENDAR_DATE.test(draft.assessmentStartDate)) {
            messages.push("Enter an assessment start date.");
            fields.push("assessmentStartDate");
          }
          if (!draft.assessmentEndDate || !CALENDAR_DATE.test(draft.assessmentEndDate)) {
            messages.push("Enter an assessment end date.");
            fields.push("assessmentEndDate");
          } else if (draft.assessmentStartDate && draft.assessmentEndDate < draft.assessmentStartDate) {
            messages.push("Assessment end date must be on or after the start date.");
            fields.push("assessmentEndDate");
          }
          const count = Number(draft.candidateCount);
          if (!Number.isInteger(count) || count < 1) {
            messages.push("Candidate count must be a whole number of at least 1.");
            fields.push("candidateCount");
          }
          const language = draft.assessmentLanguage.trim();
          if (!language) {
            messages.push("Enter an assessment language.");
            fields.push("assessmentLanguage");
          } else if (language.length > LANGUAGE_MAX) {
            messages.push(`Assessment language must be ${LANGUAGE_MAX} characters or fewer.`);
            fields.push("assessmentLanguage");
          }
          if (needRecognitionOverride && canOverride) {
            const reason = draft.recognitionOverrideReason.trim();
            if (!reason) {
              messages.push("Enter a recognition override reason.");
              fields.push("recognitionOverrideReason");
            } else if (reason.length > REASON_MAX) {
              messages.push(`Override reason must be ${REASON_MAX} characters or fewer.`);
              fields.push("recognitionOverrideReason");
            }
          }
          if (messages.length > 0) {
            showError(messages.join(" "), fields);
            return;
          }

          const input: CreateBatchInput = {
            abId: draft.abId.trim(),
            qualificationId: draft.qualificationId.trim(),
            type: draft.type === "LTT" ? "LTT" : "STT",
            mode: draft.mode === "online" || draft.mode === "blended" ? draft.mode : "offline",
            assessmentStartDate: draft.assessmentStartDate,
            assessmentEndDate: draft.assessmentEndDate,
            tpId: draft.tpId.trim(),
            centreId: draft.centreId.trim(),
            candidateCount: count,
            assessmentLanguage: language,
          };
          const override = draft.recognitionOverrideReason.trim();
          if (canOverride && override) input.recognitionOverrideReason = override;

          setPending(true);
          setFormError(null);
          void (async () => {
            try {
              const saved = await createBatch(input);
              if (!mounted.current) return;
              navigate(`/batches/${saved.id}`, { replace: true });
            } catch (error) {
              if (!mounted.current) return;
              setPending(false);
              if (error && typeof error === "object" && "code" in error) {
                const code = String(error.code);
                if (code === "RULE_OUTSIDE_RECOGNITION" && canOverride && isBlockableRuleCode(code)) {
                  setNeedRecognitionOverride(true);
                  showError(errorMessage(error), ["recognitionOverrideReason"]);
                  return;
                }
              }
              showError(errorMessage(error), []);
            }
          })();
        }}
      >
        <fieldset disabled={pending} className="bare-fieldset">
          <FormAlert error={formError} id={errorId} />
          <div className="field">
            <label htmlFor="create-ab">Awarding body</label>
            {awardingBodies.data && awardingBodies.data.items.length > 0 ? (
              <select
                id="create-ab"
                ref={bind("abId")}
                name="abId"
                value={draft.abId}
                onChange={(event) => update("abId", event.target.value)}
              >
                <option value="">Select an awarding body</option>
                {awardingBodies.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="create-ab"
                ref={bind("abId")}
                name="abId"
                value={draft.abId}
                aria-invalid={formError?.fields.includes("abId") || undefined}
                onChange={(event) => update("abId", event.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="create-qualification">Qualification</label>
            {qualifications.data && qualifications.data.items.length > 0 ? (
              <select
                id="create-qualification"
                ref={bind("qualificationId")}
                name="qualificationId"
                value={draft.qualificationId}
                onChange={(event) => update("qualificationId", event.target.value)}
              >
                <option value="">Select a qualification</option>
                {qualifications.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} — {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="create-qualification"
                ref={bind("qualificationId")}
                name="qualificationId"
                value={draft.qualificationId}
                aria-invalid={formError?.fields.includes("qualificationId") || undefined}
                onChange={(event) => update("qualificationId", event.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="create-type">Type</label>
            <select
              id="create-type"
              ref={bind("type")}
              name="type"
              value={draft.type}
              onChange={(event) => update("type", event.target.value)}
            >
              {BATCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="create-mode">Mode</label>
            <select
              id="create-mode"
              ref={bind("mode")}
              name="mode"
              value={draft.mode}
              onChange={(event) => update("mode", event.target.value)}
            >
              {BATCH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="create-start">Assessment start date</label>
            <input
              id="create-start"
              ref={bind("assessmentStartDate")}
              name="assessmentStartDate"
              type="date"
              value={draft.assessmentStartDate}
              aria-invalid={formError?.fields.includes("assessmentStartDate") || undefined}
              onChange={(event) => update("assessmentStartDate", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="create-end">Assessment end date</label>
            <input
              id="create-end"
              ref={bind("assessmentEndDate")}
              name="assessmentEndDate"
              type="date"
              value={draft.assessmentEndDate}
              aria-invalid={formError?.fields.includes("assessmentEndDate") || undefined}
              onChange={(event) => update("assessmentEndDate", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="create-tp">Training partner</label>
            {partners.data && partners.data.items.length > 0 ? (
              <select
                id="create-tp"
                ref={bind("tpId")}
                name="tpId"
                value={draft.tpId}
                onChange={(event) => update("tpId", event.target.value)}
              >
                <option value="">Select a training partner</option>
                {partners.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="create-tp"
                ref={bind("tpId")}
                name="tpId"
                value={draft.tpId}
                aria-invalid={formError?.fields.includes("tpId") || undefined}
                onChange={(event) => update("tpId", event.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="create-centre">Centre</label>
            {centres.data && centres.data.items.length > 0 ? (
              <select
                id="create-centre"
                ref={bind("centreId")}
                name="centreId"
                value={draft.centreId}
                onChange={(event) => update("centreId", event.target.value)}
              >
                <option value="">Select a centre</option>
                {centres.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="create-centre"
                ref={bind("centreId")}
                name="centreId"
                value={draft.centreId}
                aria-invalid={formError?.fields.includes("centreId") || undefined}
                onChange={(event) => update("centreId", event.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="create-count">Candidate count</label>
            <input
              id="create-count"
              ref={bind("candidateCount")}
              name="candidateCount"
              type="number"
              min={1}
              step={1}
              value={draft.candidateCount}
              aria-invalid={formError?.fields.includes("candidateCount") || undefined}
              onChange={(event) => update("candidateCount", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="create-language">Assessment language</label>
            <input
              id="create-language"
              ref={bind("assessmentLanguage")}
              name="assessmentLanguage"
              value={draft.assessmentLanguage}
              required
              maxLength={LANGUAGE_MAX}
              aria-invalid={formError?.fields.includes("assessmentLanguage") || undefined}
              onChange={(event) => update("assessmentLanguage", event.target.value)}
            />
          </div>
          {needRecognitionOverride && canOverride ? (
            <div className="field">
              <label htmlFor="create-recognition-override">Recognition override reason</label>
              <p className="field-hint">Only an AA admin can send this. It is stored and audit-logged.</p>
              <textarea
                id="create-recognition-override"
                ref={bind("recognitionOverrideReason")}
                name="recognitionOverrideReason"
                value={draft.recognitionOverrideReason}
                required
                maxLength={REASON_MAX}
                aria-invalid={formError?.fields.includes("recognitionOverrideReason") || undefined}
                onChange={(event) => update("recognitionOverrideReason", event.target.value)}
              />
            </div>
          ) : null}
          <div className="dialog-actions">
            <button type="submit">{needRecognitionOverride ? "Create with override" : "Create batch"}</button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
