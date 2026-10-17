import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBatchSettings,
  RUBRIC_LEVELS,
  type BatchSettings,
} from "../../api/batchSettings";
import type { BatchRecord } from "../../api/batches";
import { listCandidates, type CandidateRecord } from "../../api/candidates";
import { ApiError, errorMessage } from "../../api/client";
import { getQualification, type Qualification } from "../../api/masterData";
import {
  MARK_COMPONENTS,
  getResults,
  listAttendance,
  publishResult,
  returnForCorrection,
  saveResults,
  submitResult,
  validateResult,
  type MarkComponent,
  type ResultRecord,
  type ResultStatus,
} from "../../api/results";
import { slaExpiredPrompt } from "../../api/ruleErrors";
import {
  RESULTS_ROLES,
  canReadCandidates,
  type Role,
} from "../../routing/access";
import { Dialog } from "../masterData/dialog";
import { formatMasterDataError } from "../masterData/formatApiError";
import { canReadMasterCollection } from "../masterDataAccess";
import {
  canEditMarks,
  canReturnForCorrection,
  checkRow,
  draftFromRow,
  incompleteDetails,
  isAssessed,
  isResultStage,
  markKey,
  markProblem,
  nosColumns,
  nosColumnsFromResult,
  reviewActionFor,
  rowInput,
  sameDraft,
  type DraftRow,
  type NosColumn,
  type ReviewAction,
} from "./resultMarks";
import { formatInstant } from "./sla";

type Props = {
  batch: BatchRecord;
  role: Role;
};

type Banner = { id: number; message: string };

const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  validated: "Validated",
  published: "Published",
};

const COMPONENT_LABELS: Record<MarkComponent, string> = {
  theory: "Theory",
  practical: "Practical",
  viva: "Viva",
};

const REVIEW_LABELS: Record<ReviewAction, { button: string; done: string }> = {
  validate: { button: "Validate result", done: "Result validated." },
  publish: { button: "Publish result", done: "Result published." },
};

const REASON_MAX = 2000;

/** candidate and tp read a result only once it is published (Q125). */
function isPublishedOnlyRole(role: Role): boolean {
  return role === "candidate" || role === "tp";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateName(
  names: Map<string, string>,
  candidateId: string,
): string {
  return names.get(candidateId) ?? `Candidate ${candidateId}`;
}

function componentHeading(column: NosColumn, component: MarkComponent): string {
  const ceiling = column.ceilings?.[component];
  if (ceiling === 0) return `${COMPONENT_LABELS[component]} (not assessed)`;
  if (ceiling == null) return COMPONENT_LABELS[component];
  return `${COMPONENT_LABELS[component]} (max ${ceiling})`;
}

function PassMarkNote({
  qualification,
  settings,
}: {
  qualification: Qualification;
  settings: BatchSettings | undefined;
}) {
  if (settings && settings.passCriteria !== "qualification") {
    const rule =
      settings.passCriteria === "overall"
        ? "overall (the marks of all NOS added together)"
        : "NOS wise";
    return (
      <p className="field-hint">
        This batch has its own pass rule: {settings.passPercentage} percent in
        theory, practical and viva, judged {rule}. The pass marks of the
        qualification {qualification.code} are not used. The server works out
        every outcome.
      </p>
    );
  }
  const unit =
    qualification.passMarkUnit === "percent"
      ? "percent of the ceiling"
      : "absolute marks";
  const mode =
    qualification.passCriteriaMode === "overall"
      ? "overall (each component summed across NOS)"
      : "NOS-wise";
  const { theory, practical, viva } = qualification.passMarks;
  return (
    <p className="field-hint">
      Pass marks for {qualification.code} are in {unit}: theory {theory},
      practical {practical}, viva {viva}. Pass criteria: {mode}. The server
      works out every outcome.
    </p>
  );
}

function GridHead({
  columns,
  withWarnings,
}: {
  columns: NosColumn[];
  withWarnings: boolean;
}) {
  return (
    <thead>
      <tr>
        <th scope="col" rowSpan={2}>
          Candidate
        </th>
        {columns.map((column) => (
          <th
            key={column.nosId}
            scope="colgroup"
            colSpan={MARK_COMPONENTS.length}
          >
            {column.label}
          </th>
        ))}
        <th scope="col" rowSpan={2}>
          Outcome
        </th>
        {withWarnings ? (
          <th scope="col" rowSpan={2}>
            Warnings
          </th>
        ) : null}
      </tr>
      <tr>
        {columns.flatMap((column) =>
          MARK_COMPONENTS.map((component) => (
            <th key={`${column.nosId}-${component}`} scope="col">
              {componentHeading(column, component)}
            </th>
          )),
        )}
      </tr>
    </thead>
  );
}

function ReadOnlyGrid({
  result,
  columns,
  names,
}: {
  result: ResultRecord;
  columns: NosColumn[];
  names: Map<string, string>;
}) {
  if (result.rows.length === 0)
    return <p role="status">This result has no rows.</p>;
  return (
    <div className="table-scroll">
      <table className="result-table batches-table">
        <caption className="visually-hidden">
          Marks and outcomes, read only
        </caption>
        <GridHead columns={columns} withWarnings={false} />
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.candidateId}>
              <th scope="row">{candidateName(names, row.candidateId)}</th>
              {row.absent ? (
                <td
                  colSpan={Math.max(columns.length * MARK_COMPONENTS.length, 1)}
                >
                  Absent
                </td>
              ) : (
                columns.flatMap((column) => {
                  const entry = row.nos.find(
                    (item) => item.nosId === column.nosId,
                  );
                  return MARK_COMPONENTS.map((component) => (
                    <td key={`${column.nosId}-${component}`}>
                      {entry?.[component] ?? "None"}
                    </td>
                  ));
                })
              )}
              <td>{row.outcome ?? "No outcome"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type EditorProps = {
  batch: BatchRecord;
  result: ResultRecord | null;
  candidates: CandidateRecord[];
  columns: NosColumn[];
  /** candidateId → present. No entry means no attendance row. */
  attendance: Map<string, boolean>;
  /** X-29: how practical and viva are marked in this batch. */
  rubric: { practical: boolean; viva: boolean };
  onSaved: (result: ResultRecord) => void;
  onSubmitted: (result: ResultRecord) => void;
};

function MarksEditor({
  batch,
  result,
  candidates,
  columns,
  attendance,
  rubric,
  onSaved,
  onSubmitted,
}: EditorProps) {
  const reasonId = useId();
  const lateId = useId();
  const submitHintId = useId();
  const saved = useMemo(() => {
    const rows = new Map(
      (result?.rows ?? []).map((row) => [row.candidateId, row]),
    );
    return Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        draftFromRow(rows.get(candidate.id)),
      ]),
    );
  }, [result, candidates]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>(saved);
  const [changeReason, setChangeReason] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [needLateReason, setNeedLateReason] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<Banner | null>(null);
  const [errorSeq, setErrorSeq] = useState(0);

  const names = new Map(
    candidates.map((candidate) => [candidate.id, candidate.name]),
  );
  const savedRows = new Map(
    (result?.rows ?? []).map((row) => [row.candidateId, row]),
  );

  function showError(message: string) {
    setErrorSeq(errorSeq + 1);
    setError({ id: errorSeq + 1, message });
  }

  function rowState(candidate: CandidateRecord) {
    const draft = drafts[candidate.id] ?? { absent: false, marks: {} };
    const present = attendance.get(candidate.id);
    const absent = present === false || (present === undefined && draft.absent);
    const check = absent
      ? { missing: 0, total: 0, invalid: [] }
      : checkRow(draft, columns);
    const dirty = !sameDraft(
      draft,
      saved[candidate.id] ?? { absent: false, marks: {} },
    );
    return {
      draft,
      present,
      absent,
      check,
      dirty,
      hasRow: savedRows.has(candidate.id),
    };
  }

  const states = candidates.map((candidate) => ({
    candidate,
    ...rowState(candidate),
  }));
  const dirty = states.some((row) => row.dirty);
  const invalidCount = states.reduce(
    (sum, row) => sum + row.check.invalid.length,
    0,
  );
  const incompleteCount = states.filter((row) => row.check.missing > 0).length;
  const unsavedRows = states.some((row) => !row.hasRow);

  let submitBlock: string | null = null;
  if (!result) submitBlock = "Save a draft before you submit.";
  else if (dirty || unsavedRows)
    submitBlock = "Save your changes before you submit.";
  else if (incompleteCount > 0) {
    submitBlock = `${incompleteCount} candidate(s) still have marks missing. Submit stays closed until every row is complete.`;
  }

  function setMark(candidateId: string, key: string, value: string) {
    setDrafts((current) => {
      const row = current[candidateId] ?? { absent: false, marks: {} };
      return {
        ...current,
        [candidateId]: { ...row, marks: { ...row.marks, [key]: value } },
      };
    });
  }

  function setAbsent(candidateId: string, absent: boolean) {
    setDrafts((current) => {
      const row = current[candidateId] ?? { absent: false, marks: {} };
      return { ...current, [candidateId]: { ...row, absent } };
    });
  }

  function describeError(err: unknown): string {
    const base = formatMasterDataError(err).message;
    if (!(err instanceof ApiError)) return base;
    if (err.code === "RESULT_PASS_MARK_INVALID" && isRecord(err.details)) {
      const { candidateId, nosId, component, max } = err.details;
      if (typeof candidateId === "string") {
        return `${base} ${candidateName(names, candidateId)}, ${String(nosId)}, ${String(component)}: the ceiling is ${String(max)}.`;
      }
    }
    if (err.code === "RESULT_INCOMPLETE") {
      const { missingCandidates, incompleteMarks } = incompleteDetails(
        err.details,
      );
      const parts = [];
      if (missingCandidates.length > 0) {
        parts.push(
          `No row for: ${missingCandidates.map((id) => candidateName(names, id)).join(", ")}.`,
        );
      }
      if (incompleteMarks.length > 0) {
        parts.push(
          `Marks missing for: ${incompleteMarks.map((id) => candidateName(names, id)).join(", ")}.`,
        );
      }
      return [base, ...parts].join(" ");
    }
    if (err.code === "SLA_RESULT_EXPIRED")
      return `${base} ${slaExpiredPrompt(err.code)}`;
    return base;
  }

  async function handleSave() {
    if (busy) return;
    if (invalidCount > 0) {
      showError(
        `${invalidCount} mark(s) are above the ceiling or not valid. Correct them before you save.`,
      );
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const reason = changeReason.trim();
      const next = await saveResults(batch.id, {
        rows: states.map((row) =>
          rowInput(row.candidate.id, row.draft, columns, row.present),
        ),
        ...(reason ? { changeReason: reason } : {}),
      });
      onSaved(next);
    } catch (err) {
      showError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit() {
    if (busy || submitBlock) return;
    const late = lateReason.trim();
    if (needLateReason && !late) {
      showError("Enter a late reason to submit after the result due time.");
      return;
    }
    setBusy("submit");
    setError(null);
    try {
      onSubmitted(
        await submitResult(batch.id, late ? { lateReason: late } : {}),
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === "SLA_RESULT_EXPIRED")
        setNeedLateReason(true);
      showError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="result-editor">
      {error ? (
        <p key={error.id} className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}
      {candidates.length === 0 ? (
        <p role="status">No active candidates on this roster.</p>
      ) : (
        <div className="table-scroll">
          <table className="result-table batches-table">
            <caption className="visually-hidden">
              Marks per candidate and NOS
            </caption>
            <GridHead columns={columns} withWarnings />
            <tbody>
              {states.map(
                ({
                  candidate,
                  draft,
                  present,
                  absent,
                  check,
                  dirty: rowDirty,
                  hasRow,
                }) => {
                  const savedRow = savedRows.get(candidate.id);
                  const span = Math.max(
                    columns.length * MARK_COMPONENTS.length,
                    1,
                  );
                  let outcome = "No outcome";
                  if (rowDirty || !hasRow) outcome = "Not saved";
                  else if (savedRow?.outcome) outcome = savedRow.outcome;
                  const warnings: string[] = [];
                  if (check.invalid.length > 0) {
                    warnings.push(
                      `${check.invalid.length} mark(s) above the ceiling or not valid.`,
                    );
                  }
                  if (check.missing > 0) {
                    warnings.push(
                      `Incomplete: ${check.missing} of ${check.total} marks missing.`,
                    );
                  }
                  return (
                    <tr key={candidate.id}>
                      <th scope="row">
                        {candidate.name}
                        {present === undefined ? (
                          <label className="check-label result-absent-check">
                            <input
                              type="checkbox"
                              aria-label={`Absent: ${candidate.name} (no attendance row)`}
                              checked={draft.absent}
                              onChange={(event) =>
                                setAbsent(candidate.id, event.target.checked)
                              }
                            />
                            <span>Absent (no attendance row)</span>
                          </label>
                        ) : null}
                      </th>
                      {absent ? (
                        <td colSpan={span}>
                          {present === false
                            ? "Absent in attendance. Marks cannot be entered."
                            : "Marked absent."}
                        </td>
                      ) : (
                        columns.flatMap((column) =>
                          MARK_COMPONENTS.map((component) => {
                            const key = markKey(column.nosId, component);
                            const ceiling =
                              column.ceilings?.[component] ?? null;
                            const label = `${candidate.name}, ${column.label}, ${COMPONENT_LABELS[component]}`;
                            if (!isAssessed(column, component)) {
                              return <td key={key}>Not assessed</td>;
                            }
                            const text = draft.marks[key] ?? "";
                            if (
                              ceiling != null &&
                              ceiling > 0 &&
                              (component === "practical"
                                ? rubric.practical
                                : component === "viva" && rubric.viva)
                            ) {
                              const picked = RUBRIC_LEVELS.find(
                                (level) =>
                                  text !== "" &&
                                  Math.abs(
                                    (ceiling * level.percent) / 100 -
                                      Number(text),
                                  ) < 1e-9,
                              );
                              return (
                                <td key={key}>
                                  <select
                                    className="result-mark"
                                    aria-label={label}
                                    aria-invalid={
                                      text !== "" && !picked ? true : undefined
                                    }
                                    value={picked ? picked.key : ""}
                                    onChange={(event) => {
                                      const level = RUBRIC_LEVELS.find(
                                        (l) => l.key === event.target.value,
                                      );
                                      setMark(
                                        candidate.id,
                                        key,
                                        level
                                          ? String(
                                              (ceiling * level.percent) / 100,
                                            )
                                          : "",
                                      );
                                    }}
                                  >
                                    <option value="">Choose a level</option>
                                    {RUBRIC_LEVELS.map((level) => (
                                      <option key={level.key} value={level.key}>
                                        {level.label} (
                                        {(ceiling * level.percent) / 100})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            }
                            return (
                              <td key={key}>
                                <input
                                  className="result-mark"
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={ceiling ?? undefined}
                                  step="any"
                                  aria-label={label}
                                  aria-invalid={
                                    markProblem(text, ceiling)
                                      ? true
                                      : undefined
                                  }
                                  value={text}
                                  onChange={(event) =>
                                    setMark(
                                      candidate.id,
                                      key,
                                      event.target.value,
                                    )
                                  }
                                />
                              </td>
                            );
                          }),
                        )
                      )}
                      <td>
                        {absent && !rowDirty && hasRow ? "Absent" : outcome}
                      </td>
                      <td>
                        {warnings.length > 0 ? (
                          <span className="result-warning">
                            {warnings.join(" ")}
                          </span>
                        ) : (
                          "None"
                        )}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="field">
        <label htmlFor={reasonId}>Change reason (optional)</label>
        <input
          id={reasonId}
          type="text"
          maxLength={2000}
          value={changeReason}
          onChange={(event) => setChangeReason(event.target.value)}
        />
      </div>
      {needLateReason ? (
        <div className="field">
          <label htmlFor={lateId}>Late reason</label>
          <textarea
            id={lateId}
            maxLength={2000}
            required
            value={lateReason}
            onChange={(event) => setLateReason(event.target.value)}
          />
          <p className="field-hint">{slaExpiredPrompt("SLA_RESULT_EXPIRED")}</p>
        </div>
      ) : null}
      <div className="row-actions">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void handleSave()}
        >
          {busy === "save" ? "Saving draft" : "Save draft"}
        </button>
        <button
          type="button"
          disabled={busy !== null || submitBlock !== null}
          aria-describedby={submitBlock ? submitHintId : undefined}
          onClick={() => void handleSubmit()}
        >
          {busy === "submit" ? "Submitting result" : "Submit result"}
        </button>
      </div>
      {submitBlock ? (
        <p id={submitHintId} className="form-warning">
          {submitBlock}
        </p>
      ) : null}
    </div>
  );
}

function ReturnDialog({
  batch,
  onCancel,
  onReturned,
}: {
  batch: BatchRecord;
  onCancel: () => void;
  onReturned: () => void;
}) {
  const reasonId = useId();
  const errorId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Banner | null>(null);
  const errorSeq = useRef(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > REASON_MAX) {
      setError({
        id: ++errorSeq.current,
        message: `Enter a reason of 1 to ${REASON_MAX} characters.`,
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await returnForCorrection(batch.id, { reason: trimmed });
      onReturned();
    } catch (err) {
      setError({ id: ++errorSeq.current, message: errorMessage(err) });
      setBusy(false);
    }
  }

  return (
    <Dialog title="Return for correction" busy={busy} onCancel={onCancel}>
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <p>
          The result goes back to the assessment agency as a draft. The marks
          are kept, and the agency must submit again.
        </p>
        {error ? (
          <p key={error.id} id={errorId} className="form-error" role="alert">
            {error.message}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={reasonId}>Reason</label>
          <textarea
            id={reasonId}
            name="reason"
            value={reason}
            required
            maxLength={REASON_MAX}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            data-dialog-cancel
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            Return result
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReviewPanel({
  batch,
  action,
  canReturn,
  onMoved,
  onReturned,
}: {
  batch: BatchRecord;
  action: ReviewAction;
  canReturn: boolean;
  onMoved: (result: ResultRecord, message: string) => void;
  onReturned: () => void;
}) {
  const reasonId = useId();
  const returnButton = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  async function handleReview() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = reason.trim() ? { reason: reason.trim() } : {};
      const moved =
        action === "validate"
          ? await validateResult(batch.id, input)
          : await publishResult(batch.id, input);
      onMoved(moved, REVIEW_LABELS[action].done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="result-review">
      <h3>Awarding body review</h3>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={reasonId}>Reason (optional)</label>
        <textarea
          id={reasonId}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="row-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleReview()}
        >
          {REVIEW_LABELS[action].button}
        </button>
        {canReturn ? (
          <button
            ref={returnButton}
            type="button"
            className="button-quiet"
            disabled={busy}
            onClick={() => setReturning(true)}
          >
            Return for correction
          </button>
        ) : null}
      </div>
      {returning ? (
        <ReturnDialog
          batch={batch}
          onCancel={() => {
            setReturning(false);
            returnButton.current?.focus();
          }}
          onReturned={() => {
            setReturning(false);
            onReturned();
          }}
        />
      ) : null}
    </div>
  );
}

export function ResultSection({ batch, role }: Props) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Banner | null>(null);
  const [noticeSeq, setNoticeSeq] = useState(0);

  const canRead = RESULTS_ROLES.includes(role);
  const stage = isResultStage(batch.status);
  const publishedOnly = isPublishedOnlyRole(role);
  const readsQualification = canReadMasterCollection(role, "qualifications");

  const resultQuery = useQuery({
    queryKey: ["batch-results", batch.id],
    enabled: canRead && stage,
    queryFn: ({ signal }) => getResults(batch.id, signal),
  });
  const result = resultQuery.data ?? null;
  const loaded = resultQuery.isSuccess;
  const editable = loaded && canEditMarks(role, batch.status, result);
  const showGrid = loaded && (editable || result !== null);

  const candidatesQuery = useQuery({
    queryKey: ["batch-candidates", batch.id, "all"],
    enabled: showGrid && canReadCandidates(role),
    queryFn: ({ signal }) => listCandidates(batch.id, undefined, signal),
  });
  const qualificationQuery = useQuery({
    queryKey: ["qualification", batch.qualificationId],
    enabled: showGrid && readsQualification,
    queryFn: ({ signal }) => getQualification(batch.qualificationId, signal),
  });
  // X-29: the batch's pass rule and marking type. Failing to read it only means the plain grid.
  const settingsQuery = useQuery({
    queryKey: ["batch-settings", batch.id],
    enabled: showGrid && role === "aa_admin",
    retry: false,
    queryFn: ({ signal }) => getBatchSettings(batch.id, signal),
  });
  const batchSettings = settingsQuery.data;
  const attendanceQuery = useQuery({
    queryKey: ["batch-attendance", batch.id],
    enabled: editable,
    queryFn: ({ signal }) => listAttendance(batch.id, signal),
  });

  function heading(body: JSX.Element) {
    return (
      <section className="result-section" aria-labelledby="result-heading">
        <h2 id="result-heading">Result</h2>
        {body}
      </section>
    );
  }

  if (!canRead)
    return heading(
      <p role="status">Results are not available for this role.</p>,
    );
  if (publishedOnly && (!stage || (loaded && !result))) {
    return heading(<p role="status">No published result for this batch.</p>);
  }
  if (!stage) {
    return heading(
      <p role="status">
        Marks can be entered once the assessment is completed.
      </p>,
    );
  }

  function announce(message: string) {
    setNoticeSeq(noticeSeq + 1);
    setNotice({ id: noticeSeq + 1, message });
  }

  function storeResult(next: ResultRecord, message: string, moved: boolean) {
    queryClient.setQueryData(["batch-results", batch.id], next);
    announce(message);
    void queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
    if (moved) void queryClient.invalidateQueries({ queryKey: ["batches"] });
  }

  /** The batch and the result both moved back, so both are read again. */
  function handleReturned() {
    announce("Result returned for correction.");
    void queryClient.invalidateQueries({
      queryKey: ["batch-results", batch.id],
    });
    void queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
    void queryClient.invalidateQueries({ queryKey: ["batches"] });
  }

  const qualification = qualificationQuery.data;
  const columns = qualification
    ? nosColumns(qualification)
    : nosColumnsFromResult(result);
  const candidates = candidatesQuery.data?.items ?? [];
  const names = new Map(
    candidates.map((candidate) => [candidate.id, candidate.name]),
  );
  const review = reviewActionFor(role, batch.status);
  const loadError = [
    resultQuery,
    candidatesQuery,
    qualificationQuery,
    attendanceQuery,
  ].find((query) => query.isError);
  const editorReady =
    candidatesQuery.isSuccess &&
    qualificationQuery.isSuccess &&
    attendanceQuery.isSuccess;

  return heading(
    <>
      {notice ? (
        <p key={notice.id} className="form-notice" role="status">
          {notice.message}
        </p>
      ) : null}
      {loadError ? (
        <p className="form-error" role="alert">
          {errorMessage(loadError.error)}
        </p>
      ) : null}
      {resultQuery.isLoading ? <p role="status">Loading result.</p> : null}
      {loaded ? (
        <p>
          Result status:{" "}
          {result ? RESULT_STATUS_LABELS[result.status] : "Not started"}.
          {result?.submittedAt
            ? ` Submitted ${formatInstant(result.submittedAt)}.`
            : ""}
          {result?.validatedAt
            ? ` Validated ${formatInstant(result.validatedAt)}.`
            : ""}
          {result?.publishedAt
            ? ` Published ${formatInstant(result.publishedAt)}.`
            : ""}
        </p>
      ) : null}
      {loaded && !result && !editable ? (
        <p role="status">No result has been entered for this batch.</p>
      ) : null}
      {showGrid && qualification ? (
        <PassMarkNote qualification={qualification} settings={batchSettings} />
      ) : null}
      {editable && !editorReady && !loadError ? (
        <p role="status">Loading marks grid.</p>
      ) : null}
      {editable && editorReady ? (
        <MarksEditor
          key={result?.updatedAt ?? "new"}
          batch={batch}
          result={result}
          candidates={candidates.filter((candidate) => candidate.active)}
          columns={columns}
          attendance={
            new Map(
              (attendanceQuery.data ?? []).map((row) => [
                row.candidateId,
                row.present,
              ]),
            )
          }
          rubric={{
            practical: batchSettings?.practicalMarking === "rubric",
            viva: batchSettings?.vivaMarking === "rubric",
          }}
          onSaved={(next) => storeResult(next, "Draft saved.", false)}
          onSubmitted={(next) =>
            storeResult(next, "Result submitted to the awarding body.", true)
          }
        />
      ) : null}
      {!editable && result ? (
        <>
          <p className="field-hint">
            {role === "aa_admin"
              ? "Marks are read only once the result is submitted."
              : "This view is read only."}
          </p>
          <ReadOnlyGrid result={result} columns={columns} names={names} />
        </>
      ) : null}
      {review && result ? (
        <ReviewPanel
          key={review}
          batch={batch}
          action={review}
          canReturn={canReturnForCorrection(role, batch.status, result)}
          onMoved={(next, message) => storeResult(next, message, true)}
          onReturned={handleReturned}
        />
      ) : null}
    </>,
  );
}
