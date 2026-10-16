import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../api/client";
import { getAttempt, submitAttempt, type Attempt, type AttemptQuestion } from "../api/attempts";
import { useAutosave, type ClosedReason } from "./useAutosave";
import { formatRemaining, spokenRemaining, useExamClock, WARN_SECONDS } from "./useExamClock";
import { debugStripWanted } from "../proctoring/debug";
import { ProctorDebugStrip } from "./ProctorDebugStrip";
import { useProctoring } from "./useProctoring";
import type { FaceStart } from "./faceEvidence";
import { fullscreenSupported, requestExamFullscreen } from "./fullscreen";
import { FlagNotice } from "./FlagNotice";
import { ProctorStatusChip } from "./ProctorStatusChip";
import { QuestionPalette } from "./QuestionPalette";

/** Text size steps for the A- and A+ buttons, in percent. Not saved anywhere. */
const TEXT_SIZES = [100, 115, 130, 150] as const;

/** While paused, the page asks the server this often whether an unlock has happened. */
export const PAUSE_POLL_MS = 10_000;

const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type ExamOutcome = "submitted" | "timed_out" | "closed";

type Props = {
  attempt: Attempt;
  stream: MediaStream | null;
  /** P-09: ID card photo, selfie and matcher from the camera check. */
  face?: FaceStart | null;
  onFinished: (outcome: ExamOutcome) => void;
  autosaveDebounceMs?: number;
  /**
   * X-08: off in the exam window. When on, the exam asks for full screen, shows the "return to
   * full screen" notice and the engine raises fullscreen_exit. Kept so a batch setting can turn it back on.
   */
  requireFullscreen?: boolean;
};

const TYPE_HINTS: Record<string, string> = {
  short_answer: "Type a short answer.",
  scenario: "Read the scenario and type your answer.",
  viva: "Type your answer. Your assessor may also ask you about it.",
  practical: "Type your answer or the notes your assessor asked for.",
};

function isAnswered(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function QuestionBody({
  question,
  value,
  disabled,
  positional,
  onChange,
}: {
  question: AttemptQuestion;
  value: string;
  disabled: boolean;
  /** B-20: options are shuffled, so label them A, B, C by position. The answer sent is still the option key. */
  positional: boolean;
  onChange: (value: string) => void;
}) {
  if (question.type === "mcq") {
    return (
      <fieldset className="exam-options bare-fieldset">
        <legend className="visually-hidden">Choose one answer</legend>
        {question.options.map((option, position) => (
          <label key={option.key} className="exam-option">
            <input
              type="radio"
              name={`answer-${question.questionId}`}
              value={option.key}
              checked={value === option.key}
              onChange={() => onChange(option.key)}
              disabled={disabled}
            />
            <span className="exam-option-key">{positional ? (OPTION_LETTERS[position] ?? option.key) : option.key}.</span>{" "}
            {option.text}
          </label>
        ))}
      </fieldset>
    );
  }
  const hintId = `hint-${question.questionId}`;
  return (
    <div className="field">
      <label htmlFor={`answer-${question.questionId}`}>Your answer</label>
      <span id={hintId} className="field-hint">
        {TYPE_HINTS[question.type] ?? "Type your answer."}
      </span>
      <textarea
        id={`answer-${question.questionId}`}
        rows={8}
        maxLength={10000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hintId}
        disabled={disabled}
      />
    </div>
  );
}

export function ExamScreen({ attempt, stream, face, onFinished, autosaveDebounceMs, requireFullscreen = false }: Props) {
  const questions = attempt.questions;
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.questionId, q.answer ?? ""])),
  );
  const [index, setIndex] = useState(0);
  // Browser only: kept in memory, never sent or stored. Gone if the page is reloaded.
  const [review, setReview] = useState<ReadonlySet<string>>(() => new Set());
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [sizeStep, setSizeStep] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [paused, setPaused] = useState(attempt.paused);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const finished = useRef(false);
  const timeUpStarted = useRef(false);
  const announced = useRef(new Set<number>());
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const warningButton = useRef<HTMLButtonElement>(null);
  const pausedHeading = useRef<HTMLHeadingElement>(null);
  const wasPaused = useRef(attempt.paused);
  const firstRender = useRef(true);

  // X-12: an unlock can move the deadline out (the paused time is given back), so it is state.
  const [deadlineAt, setDeadlineAt] = useState(attempt.deadlineAt);
  const clockHeld = paused && attempt.settings.flagPolicy.extendOnUnlock;
  const remaining = useExamClock(deadlineAt, attempt.serverTime, clockHeld);
  const proctoring = useProctoring({ attemptId: attempt.id, batchId: attempt.batchId, stream, face, requireFullscreen });
  const { stop: stopProctoring } = proctoring;

  const finish = useCallback(
    (outcome: ExamOutcome) => {
      if (finished.current) return;
      finished.current = true;
      stopProctoring();
      onFinished(outcome);
    },
    [onFinished, stopProctoring],
  );

  const onClosed = useCallback(
    (reason: ClosedReason) => finish(reason === "time_up" ? "timed_out" : "closed"),
    [finish],
  );
  const onPaused = useCallback(() => setPaused(true), []);
  const autosave = useAutosave(attempt.id, { debounceMs: autosaveDebounceMs, onClosed, onPaused });
  const { flush, close: closeAutosave } = autosave;

  // Time up: send what is waiting (the server takes saves for a short grace period),
  // then end. The server closes the attempt as timed out, not as a submit.
  useEffect(() => {
    if (remaining > 0 || finished.current || timeUpStarted.current) return;
    timeUpStarted.current = true;
    setAnnouncement("Time is up. Your saved answers are being sent.");
    void flush().finally(() => {
      closeAutosave();
      finish("timed_out");
    });
  }, [remaining, flush, closeAutosave, finish]);

  useEffect(() => {
    for (const threshold of WARN_SECONDS) {
      if (remaining > 0 && remaining <= threshold && !announced.current.has(threshold)) {
        WARN_SECONDS.filter((t) => t >= threshold).forEach((t) => announced.current.add(t));
        setAnnouncement(`${spokenRemaining(threshold)} left.`);
        break;
      }
    }
  }, [remaining]);

  // B-20: the heartbeat is the usual way to learn about a pause or an unlock.
  const heartbeatPaused = proctoring.paused;
  useEffect(() => {
    if (heartbeatPaused !== null) setPaused(heartbeatPaused);
  }, [heartbeatPaused]);

  useEffect(() => {
    if (paused && !wasPaused.current) {
      setConfirming(false);
      setSubmitting(false);
      setAnnouncement("Your test is paused. Please contact your proctor.");
    }
    if (!paused && wasPaused.current) {
      setAnnouncement("Your test is unlocked. You can carry on.");
      void flush();
      // The server may have added the paused time to the deadline; take the new one.
      void getAttempt(attempt.id)
        .then((fresh) => {
          if (!finished.current) setDeadlineAt(fresh.deadlineAt);
        })
        .catch(() => {});
    }
    wasPaused.current = paused;
    if (paused) pausedHeading.current?.focus();
  }, [paused, flush, attempt.id]);

  // While paused, ask the server whether it was unlocked or the attempt ended meanwhile.
  useEffect(() => {
    if (!paused) return undefined;
    const timer = setInterval(() => {
      void getAttempt(attempt.id)
        .then((fresh) => {
          if (finished.current) return;
          if (fresh.status !== "in_progress") {
            closeAutosave();
            finish(fresh.status === "timed_out" ? "timed_out" : "closed");
          } else if (!fresh.paused) {
            setPaused(false);
          }
        })
        .catch(() => {});
    }, PAUSE_POLL_MS);
    return () => clearInterval(timer);
  }, [paused, attempt.id, closeAutosave, finish]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    questionHeading.current?.focus();
  }, [index]);

  useEffect(() => {
    if (confirming) confirmHeading.current?.focus();
  }, [confirming]);

  const currentWarning = proctoring.warnings[0] ?? null;
  useEffect(() => {
    if (currentWarning) warningButton.current?.focus();
  }, [currentWarning]);

  const question = questions[index];
  const timeUp = remaining <= 0;
  const answeredCount = questions.filter((q) => isAnswered(answers[q.questionId])).length;
  const unanswered = questions.length - answeredCount;
  const mustAnswerAll = attempt.settings.questionsMandatory;
  const blockedByMandatory = mustAnswerAll && unanswered > 0;
  const level = remaining <= 60 ? "exam-timer-critical" : remaining <= 300 ? "exam-timer-warn" : "";

  function toggleIn(set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
    if (set.has(id) === on) return set;
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  }

  /** Moves to a question. Leaving one unanswered marks it skipped; answering it later clears that. */
  function goTo(target: number) {
    if (target === index || target < 0 || target >= questions.length) return;
    if (question) setSkipped((cur) => toggleIn(cur, question.questionId, !isAnswered(answers[question.questionId])));
    setIndex(target);
  }

  async function saveAndNext() {
    await flush();
    setAnnouncement(index === questions.length - 1 ? "Your answers are saved." : "Saved. Next question.");
    goTo(index + 1);
  }

  function change(value: string) {
    if (!question || timeUp || submitting || paused) return;
    setAnswers((current) => ({ ...current, [question.questionId]: value }));
    autosave.queue(question.questionId, value);
  }

  async function confirmSubmit() {
    if (blockedByMandatory) return;
    setSubmitting(true);
    setSubmitError(null);
    const saved = await flush();
    if (finished.current) return;
    if (!saved) {
      setSubmitting(false);
      setSubmitError("Some answers are not saved yet. Check your connection, then select Submit now again.");
      return;
    }
    try {
      const result = await submitAttempt(attempt.id);
      closeAutosave();
      finish(result.status === "timed_out" ? "timed_out" : "submitted");
    } catch (error) {
      setSubmitting(false);
      if (error instanceof ApiError && error.code === "ATTEMPT_PAUSED") {
        setPaused(true);
        return;
      }
      setSubmitError(errorMessage(error));
    }
  }

  function goToFirstUnanswered() {
    const target = questions.findIndex((q) => !isAnswered(answers[q.questionId]));
    setConfirming(false);
    setSubmitError(null);
    if (target >= 0) goTo(target);
  }

  if (questions.length === 0) {
    return (
      <section aria-labelledby="exam-heading">
        <h1 id="exam-heading">Exam</h1>
        <p role="alert" className="form-error">
          This paper has no questions. Tell your assessor or proctor.
        </p>
      </section>
    );
  }

  return (
    <section className="exam-screen" aria-labelledby="exam-heading">
      <div className="exam-bar">
        <h1 id="exam-heading" tabIndex={-1}>
          Exam
        </h1>
        <p className={`exam-timer ${level}`}>
          <span className="visually-hidden">Time left: {spokenRemaining(remaining)}</span>
          <span role="timer" aria-hidden="true">
            Time left {formatRemaining(remaining)}
          </span>
        </p>
        <p className={`exam-save exam-save-${autosave.state}`} role="status">
          {autosave.state === "idle" && "No changes yet"}
          {autosave.state === "saving" && "Saving…"}
          {autosave.state === "saved" && "All answers saved"}
          {autosave.state === "error" && "Not saved"}
        </p>
        {autosave.state === "error" && !timeUp ? (
          <button type="button" onClick={() => void flush()}>
            Retry saving
          </button>
        ) : null}
      </div>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {remaining <= 300 && remaining > 0 ? (
        <p className="form-warning">
          {remaining <= 60 ? "Less than 1 minute left." : "Less than 5 minutes left."} Your answers save as you go.
        </p>
      ) : null}
      {autosave.state === "error" ? (
        <p className="form-error">Your last changes did not save. They will be sent again when you retry.</p>
      ) : null}

      <ProctorStatusChip status={proctoring.status} unavailable={proctoring.unavailable} stream={stream} />
      {proctoring.unavailable ? (
        <p className="form-warning" role="status">
          <strong>Proctoring unavailable.</strong> {proctoring.unavailable}
        </p>
      ) : null}

      {debugStripWanted() ? <ProctorDebugStrip status={proctoring.status} /> : null}

      {requireFullscreen && fullscreenSupported() && !isFullscreen && !timeUp ? (
        <div className="form-warning exam-fullscreen" role="alert">
          <p>You left full screen. Leaving full screen is recorded for the proctor. Please return to full screen.</p>
          <button type="button" onClick={requestExamFullscreen}>
            Return to full screen
          </button>
        </div>
      ) : null}

      <QuestionPalette
        questions={questions}
        currentIndex={index}
        status={(id) => ({ attempted: isAnswered(answers[id]), review: review.has(id), skipped: skipped.has(id) })}
        onSelect={goTo}
      />

      <article
        className="exam-question"
        aria-labelledby="question-heading"
        style={{ fontSize: `${TEXT_SIZES[sizeStep]}%` }}
      >
        <h2 id="question-heading" ref={questionHeading} tabIndex={-1}>
          Question {index + 1} of {questions.length}
        </h2>
        <p className="exam-stem">{question.stem}</p>
        <QuestionBody
          question={question}
          value={answers[question.questionId] ?? ""}
          disabled={timeUp || submitting || paused}
          positional={attempt.shuffleOptions}
          onChange={change}
        />
      </article>

      <div className="exam-tools">
        <label className="exam-review">
          <input
            type="checkbox"
            checked={review.has(question.questionId)}
            onChange={(event) => setReview((cur) => toggleIn(cur, question.questionId, event.target.checked))}
          />{" "}
          Mark for review
        </label>
        <button
          type="button"
          onClick={() => change("")}
          disabled={timeUp || submitting || paused || !isAnswered(answers[question.questionId])}
        >
          Reset
        </button>
        <span role="group" aria-label="Text size">
          <button
            type="button"
            aria-label="Smaller text"
            onClick={() => setSizeStep((n) => Math.max(0, n - 1))}
            disabled={sizeStep === 0}
          >
            A-
          </button>
          <button
            type="button"
            aria-label="Larger text"
            onClick={() => setSizeStep((n) => Math.min(TEXT_SIZES.length - 1, n + 1))}
            disabled={sizeStep === TEXT_SIZES.length - 1}
          >
            A+
          </button>
        </span>
      </div>

      <div className="dialog-actions">
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}>
          Previous
        </button>
        <button type="button" onClick={() => void saveAndNext()} disabled={submitting || paused}>
          Save and Next
        </button>
        <button type="button" onClick={() => setConfirming(true)} disabled={timeUp || submitting || paused}>
          Submit exam
        </button>
      </div>
      {mustAnswerAll ? (
        <p className="field-hint">You must answer every question before you can submit.</p>
      ) : null}

      {confirming ? (
        <div className="dialog-backdrop">
          <div className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-heading">
            <h2 id="confirm-heading" ref={confirmHeading} tabIndex={-1}>
              Submit your exam?
            </h2>
            <p>
              You have answered {answeredCount} of {questions.length} questions.
              {unanswered > 0 ? ` ${unanswered} ${unanswered === 1 ? "question is" : "questions are"} not answered.` : ""}
            </p>
            {blockedByMandatory ? (
              <p role="alert" className="form-error">
                You must answer every question before you submit. {unanswered}{" "}
                {unanswered === 1 ? "question is" : "questions are"} not answered.
              </p>
            ) : (
              <p>After you submit you cannot change your answers.</p>
            )}
            {submitError ? (
              <p role="alert" className="form-error">
                {submitError}
              </p>
            ) : null}
            <div className="dialog-actions">
              {blockedByMandatory ? (
                <button type="button" onClick={goToFirstUnanswered}>
                  Go to the first unanswered question
                </button>
              ) : (
                <button type="button" onClick={() => void confirmSubmit()} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit now"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setSubmitError(null);
                }}
                disabled={submitting}
              >
                Go back to the exam
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="dialog-backdrop">
          <div
            className="dialog-panel exam-paused"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="paused-heading"
            aria-describedby="paused-text"
          >
            <h2 id="paused-heading" ref={pausedHeading} tabIndex={-1}>
              Test paused
            </h2>
            <p id="paused-text">Your test is paused. Please contact your proctor.</p>
            <p>Your saved answers are safe. The timer keeps running. This page carries on when your proctor unlocks it.</p>
          </div>
        </div>
      ) : null}

      {proctoring.notice && !currentWarning && !paused ? (
        <FlagNotice type={proctoring.notice} onDismiss={proctoring.dismissNotice} />
      ) : null}

      {currentWarning && !paused ? (
        <div className="dialog-backdrop">
          <div
            className="dialog-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="warning-heading"
            aria-describedby="warning-text"
          >
            <h2 id="warning-heading">Warning from the proctor</h2>
            <p id="warning-text">{currentWarning.message}</p>
            <div className="dialog-actions">
              <button type="button" ref={warningButton} onClick={() => proctoring.acknowledge(currentWarning.id)}>
                I understand
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
