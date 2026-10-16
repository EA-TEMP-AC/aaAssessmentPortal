import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, errorMessage } from "../../api/client";
import { useSession } from "../../api/session";
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from "../../api/questionBank";
import {
  generatePaper,
  listApprovedWeightProfiles,
  shortageText,
  type GenerateInput,
  type Shortage,
} from "../../api/testPapers";
import { canWriteQuestions } from "../../routing/access";
import { nosOf, useQualifications } from "../questionBank/qualifications";

type QuotaRow = { rowId: number; nosId: string; type: string; count: string };

type Errors = {
  qualificationId?: string;
  language?: string;
  name?: string;
  quotas?: string;
  totalMarks?: string;
  durationMinutes?: string;
  seed?: string;
};

function wholeOrBlank(text: string, min: number, max: number): number | null | "bad" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= min && value <= max ? value : "bad";
}

function shortagesFrom(error: unknown): Shortage[] {
  if (!(error instanceof ApiError) || error.code !== "TEST_BANK_SHORTAGE") return [];
  const details = error.details as { shortages?: unknown } | undefined;
  if (!details || !Array.isArray(details.shortages)) return [];
  return details.shortages.flatMap((item): Shortage[] => {
    const row = item as Partial<Shortage>;
    return typeof row.nosId === "string" && typeof row.requested === "number" && typeof row.available === "number"
      ? [{ nosId: row.nosId, type: row.type ?? null, requested: row.requested, available: row.available }]
      : [];
  });
}

export function PaperCreatePage() {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const qualifications = useQualifications(Boolean(session));
  const [qualificationId, setQualificationId] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [quotas, setQuotas] = useState<QuotaRow[]>([{ rowId: 1, nosId: "", type: "", count: "1" }]);
  const [totalMarks, setTotalMarks] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [seed, setSeed] = useState("");
  const [weightProfileId, setWeightProfileId] = useState("");
  const [allowPartial, setAllowPartial] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [pending, setPending] = useState(false);
  const nextRow = useRef(2);
  const formRef = useRef<HTMLFormElement>(null);
  const serverRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const baseId = useId();
  const id = (part: string) => `${baseId}-${part}`;

  const profiles = useQuery({
    queryKey: ["papers", "weight-profiles", qualificationId],
    enabled: Boolean(session) && Boolean(qualificationId),
    queryFn: ({ signal }) => listApprovedWeightProfiles(qualificationId, signal),
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (serverError) serverRef.current?.focus();
  }, [serverError]);

  if (!session) return null;
  if (!canWriteQuestions(session.user.role)) return <Navigate to="/papers" replace />;

  const nosList = nosOf(qualifications.data, qualificationId);

  function validate(): { errors: Errors; body: GenerateInput | null } {
    const found: Errors = {};
    if (!qualificationId) found.qualificationId = "Choose a qualification.";
    if (!language.trim()) found.language = "Enter the language, for example en.";
    if (name.trim().length > 80) found.name = "The name can be at most 80 characters.";
    const marks = totalMarks.trim() ? Number(totalMarks) : null;
    if (marks !== null && (!Number.isFinite(marks) || marks <= 0)) found.totalMarks = "Total marks must be more than 0.";
    const minutes = wholeOrBlank(durationMinutes, 1, 600);
    if (minutes === "bad") found.durationMinutes = "Duration must be a whole number from 1 to 600 minutes.";
    const seedValue = wholeOrBlank(seed, 0, 4294967295);
    if (seedValue === "bad") found.seed = "The seed must be a whole number from 0 to 4294967295.";

    const seen = new Set<string>();
    const anyType = new Set<string>();
    const typed = new Set<string>();
    let quotaProblem: string | null = quotas.length === 0 ? "Add at least one quota." : null;
    for (const row of quotas) {
      const count = Number(row.count);
      if (!row.nosId) quotaProblem ??= "Choose a NOS in every quota row.";
      else if (!Number.isInteger(count) || count < 1) quotaProblem ??= "Every count must be a whole number, 1 or more.";
      else {
        const key = `${row.nosId}|${row.type}`;
        if (seen.has(key)) quotaProblem ??= "Two quota rows have the same NOS and type.";
        seen.add(key);
        (row.type ? typed : anyType).add(row.nosId);
      }
    }
    for (const nos of anyType) {
      if (typed.has(nos)) quotaProblem ??= "A NOS cannot have both an any-type row and a typed row.";
    }
    if (quotaProblem) found.quotas = quotaProblem;
    if (Object.keys(found).length > 0) return { errors: found, body: null };

    const body: GenerateInput = {
      qualificationId,
      language: language.trim(),
      quotas: quotas.map((row) => ({
        nosId: row.nosId,
        ...(row.type ? { type: row.type as QuestionType } : {}),
        count: Number(row.count),
      })),
    };
    if (name.trim()) body.name = name.trim();
    if (marks !== null) body.totalMarks = marks;
    if (typeof minutes === "number") body.durationMinutes = minutes;
    if (typeof seedValue === "number") body.seed = seedValue;
    if (weightProfileId) body.weightProfileId = weightProfileId;
    if (allowPartial) body.allowPartial = true;
    return { errors: found, body };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setServerError(null);
    setShortages([]);
    const { errors: found, body } = validate();
    setErrors(found);
    if (!body) {
      const order = ["qualificationId", "name", "language", "quotas", "totalMarks", "durationMinutes", "seed"] as const;
      const first = order.find((key) => found[key]);
      window.setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      }, 0);
      return;
    }
    setPending(true);
    try {
      const paper = await generatePaper(body);
      await queryClient.invalidateQueries({ queryKey: ["papers"] });
      if (mounted.current) navigate(`/papers/${paper.id}`, { state: { created: true } });
    } catch (error) {
      if (!mounted.current) return;
      setPending(false);
      setShortages(shortagesFrom(error));
      setServerError(errorMessage(error));
    }
  }

  function fieldError(key: keyof Errors) {
    return errors[key] ? (
      <p id={id(`${key}-error`)} className="form-error" role="alert">
        {errors[key]}
      </p>
    ) : null;
  }

  const invalid = (key: keyof Errors) =>
    errors[key] ? ({ "aria-invalid": true, "aria-describedby": id(`${key}-error`) } as const) : {};

  return (
    <div className="master-page">
      <h1>Create paper</h1>
      <p>
        <Link to="/papers">Back to papers</Link>
      </p>
      <p>
        The paper is drawn from approved, latest-version questions in the chosen language. The same seed and quotas give the
        same paper while the bank is unchanged.
      </p>
      <form ref={formRef} noValidate aria-label="Create paper" onSubmit={(e) => void submit(e)}>
        {serverError ? (
          <div ref={serverRef} tabIndex={-1} className="form-error" role="alert">
            <p>{serverError}</p>
            {shortages.length > 0 ? (
              <ul>
                {shortages.map((shortage, index) => (
                  <li key={index}>{shortageText(shortage)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={id("name")}>Paper name (optional)</label>
          <input
            id={id("name")}
            data-field="name"
            type="text"
            autoComplete="off"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={errors.name ? id("name-error") : id("name-hint")}
            aria-invalid={errors.name ? true : undefined}
          />
          <p id={id("name-hint")} className="field-hint">
            Up to 80 characters. With no name the paper is called after the qualification and language.
          </p>
          {fieldError("name")}
        </div>
        <div className="field">
          <label htmlFor={id("qualification")}>Qualification</label>
          <select
            id={id("qualification")}
            data-field="qualificationId"
            value={qualificationId}
            onChange={(e) => {
              setQualificationId(e.target.value);
              setWeightProfileId("");
              setQuotas([{ rowId: nextRow.current++, nosId: "", type: "", count: "1" }]);
            }}
            {...invalid("qualificationId")}
          >
            <option value="">Choose a qualification</option>
            {(qualifications.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} {item.name}
              </option>
            ))}
          </select>
          {qualifications.isPending ? <p className="field-hint">Loading qualifications…</p> : null}
          {qualifications.isError ? (
            <p className="form-error" role="alert">
              {errorMessage(qualifications.error)}
            </p>
          ) : null}
          {fieldError("qualificationId")}
        </div>
        <div className="field">
          <label htmlFor={id("language")}>Language</label>
          <input
            id={id("language")}
            data-field="language"
            type="text"
            autoComplete="off"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            {...invalid("language")}
          />
          {fieldError("language")}
        </div>
        <fieldset className="bare-fieldset" aria-describedby={errors.quotas ? id("quotas-error") : undefined}>
          <legend>Quotas per NOS and type</legend>
          {quotas.map((row, index) => (
            <div className="repeat-row" key={row.rowId}>
              <div className="field">
                <label htmlFor={id(`nos-${row.rowId}`)}>NOS (row {index + 1})</label>
                <select
                  id={id(`nos-${row.rowId}`)}
                  data-field={index === 0 ? "quotas" : undefined}
                  value={row.nosId}
                  disabled={!qualificationId}
                  onChange={(e) =>
                    setQuotas(quotas.map((r) => (r.rowId === row.rowId ? { ...r, nosId: e.target.value } : r)))
                  }
                >
                  <option value="">Choose a NOS</option>
                  {nosList.map((nos) => (
                    <option key={nos.nosId} value={nos.nosId}>
                      {nos.code} {nos.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={id(`type-${row.rowId}`)}>Type (row {index + 1})</label>
                <select
                  id={id(`type-${row.rowId}`)}
                  value={row.type}
                  onChange={(e) =>
                    setQuotas(quotas.map((r) => (r.rowId === row.rowId ? { ...r, type: e.target.value } : r)))
                  }
                >
                  <option value="">Any type</option>
                  {QUESTION_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {QUESTION_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={id(`count-${row.rowId}`)}>Questions (row {index + 1})</label>
                <input
                  id={id(`count-${row.rowId}`)}
                  type="number"
                  min="1"
                  step="1"
                  value={row.count}
                  onChange={(e) =>
                    setQuotas(quotas.map((r) => (r.rowId === row.rowId ? { ...r, count: e.target.value } : r)))
                  }
                />
              </div>
              {quotas.length > 1 ? (
                <button type="button" onClick={() => setQuotas(quotas.filter((r) => r.rowId !== row.rowId))}>
                  Remove row {index + 1}
                </button>
              ) : null}
            </div>
          ))}
          {fieldError("quotas")}
          <button
            type="button"
            onClick={() => setQuotas([...quotas, { rowId: nextRow.current++, nosId: "", type: "", count: "1" }])}
          >
            Add quota row
          </button>
        </fieldset>
        <div className="field">
          <label htmlFor={id("profile")}>Weight profile (optional)</label>
          <select
            id={id("profile")}
            value={weightProfileId}
            disabled={!qualificationId || profiles.isPending}
            onChange={(e) => setWeightProfileId(e.target.value)}
          >
            <option value="">None</option>
            {(profiles.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} (version {profile.version})
              </option>
            ))}
          </select>
          {profiles.isError ? (
            <p className="form-error" role="alert">
              Weight profiles could not be loaded. {errorMessage(profiles.error)}
            </p>
          ) : (
            <p className="field-hint">Only approved profiles for this qualification are listed. The quotas stay hard rules.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor={id("marks")}>Total marks target (optional)</label>
          <input
            id={id("marks")}
            data-field="totalMarks"
            type="number"
            min="0"
            step="any"
            value={totalMarks}
            onChange={(e) => setTotalMarks(e.target.value)}
            {...invalid("totalMarks")}
          />
          {fieldError("totalMarks")}
        </div>
        <div className="field">
          <label htmlFor={id("minutes")}>Duration in minutes (optional)</label>
          <input
            id={id("minutes")}
            data-field="durationMinutes"
            type="number"
            min="1"
            max="600"
            step="1"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            {...invalid("durationMinutes")}
          />
          {fieldError("durationMinutes")}
        </div>
        <div className="field">
          <label htmlFor={id("seed")}>Seed (optional)</label>
          <input
            id={id("seed")}
            data-field="seed"
            type="number"
            min="0"
            step="1"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            aria-describedby={errors.seed ? id("seed-error") : id("seed-hint")}
            aria-invalid={errors.seed ? true : undefined}
          />
          <p id={id("seed-hint")} className="field-hint">
            Leave empty and the server draws one and stores it.
          </p>
          {fieldError("seed")}
        </div>
        <label className="check-label">
          <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} />
          Save even if the bank is short (the paper is marked incomplete and cannot be approved)
        </label>
        <div className="dialog-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Generate paper"}
          </button>
        </div>
      </form>
    </div>
  );
}
