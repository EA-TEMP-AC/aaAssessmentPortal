import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../api/client";
import { isPaperCode, startAttempt, type Attempt } from "../api/attempts";
import { listBatches, type BatchRecord } from "../api/batches";
import { ExamScreen, type ExamOutcome } from "../exam/ExamScreen";
import { exitExamFullscreen, requestExamFullscreen } from "../exam/fullscreen";
import { PrecheckScreen, type FrameCheckOptions } from "../exam/PrecheckScreen";
import { stopStream } from "../exam/precheck";

type Choice = { batch: BatchRecord; testPaperId: string };

type Phase =
  | { name: "choose" }
  | { name: "precheck"; choice: Choice }
  | { name: "exam"; attempt: Attempt; stream: MediaStream }
  | { name: "finished"; outcome: ExamOutcome };

type Props = {
  /** Tests swap the frame reader; the page uses the real one. */
  frameCheck?: FrameCheckOptions;
  autosaveDebounceMs?: number;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }).format(date);
}

function startErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "That paper code was not found for this batch. Check the code with your assessor or proctor.";
    }
    if (error.code === "ATTEMPT_BATCH_NOT_IN_PROGRESS") return "This batch is not open for exams right now.";
    if (error.code === "ATTEMPT_PAPER_UNAVAILABLE") return "This paper is not available. Tell your assessor or proctor.";
    if (error.status === 403) return "You are not on the list of candidates for this batch.";
  }
  return errorMessage(error);
}

function BatchCard({ batch, onContinue }: { batch: BatchRecord; onContinue: (testPaperId: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = `paper-${batch.id}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <li className="exam-batch">
      <h2>Batch {batch.id}</h2>
      <dl className="batch-facts">
        <div>
          <dt>Sector</dt>
          <dd>{batch.sector || "Not recorded"}</dd>
        </div>
        <div>
          <dt>Assessment dates</dt>
          <dd>
            {formatDate(batch.assessmentStartDate)} to {formatDate(batch.assessmentEndDate)}
          </dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{batch.assessmentLanguage || "Not recorded"}</dd>
        </div>
      </dl>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!isPaperCode(code)) {
            setError("Enter the 24-character paper code exactly as your assessor or proctor gave it.");
            return;
          }
          setError(null);
          onContinue(code.trim().toLowerCase());
        }}
      >
        <div className="field">
          <label htmlFor={inputId}>Paper code</label>
          <span id={hintId} className="field-hint">
            Your assessor or proctor gives you this code at the start of the exam. If you already started this paper,
            the same code takes you back to it.
          </span>
          <input
            id={inputId}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <span id={errorId} className="field-error">
              {error}
            </span>
          ) : null}
        </div>
        <button type="submit">Continue to the camera check</button>
      </form>
    </li>
  );
}

function BatchList({ onChoose }: { onChoose: (choice: Choice) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: ["exam", "batches"],
    queryFn: ({ signal }) => listBatches({ status: "in_progress", pageSize: 100 }, signal),
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="exam-list-heading">
      <h1 id="exam-list-heading" ref={headingRef} tabIndex={-1}>
        Exam
      </h1>
      <p>Your batches that are in progress are listed here. You need a working camera to take the exam.</p>
      {query.isPending ? <p role="status">Loading your batches…</p> : null}
      {query.isError ? (
        <div role="alert" className="form-error">
          <p>{errorMessage(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {query.isSuccess && query.data.items.length === 0 ? (
        <p role="status">
          You have no batches in progress right now. Your exam appears here once the assessment of your batch starts.
        </p>
      ) : null}
      {query.isSuccess && query.data.items.length > 0 ? (
        <ul className="exam-batches">
          {query.data.items.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              onContinue={(testPaperId) => onChoose({ batch, testPaperId })}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Finished({ outcome, onBack }: { outcome: ExamOutcome; onBack: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const title =
    outcome === "submitted" ? "Exam submitted" : outcome === "timed_out" ? "Time is up" : "This exam is closed";
  const text =
    outcome === "submitted"
      ? "Your answers have been submitted. Your results are shared after they are reviewed and published."
      : outcome === "timed_out"
        ? "The exam time has ended. The answers that were saved are kept and will be marked."
        : "This exam was already submitted or has ended. You cannot change the answers.";
  return (
    <section aria-labelledby="exam-done-heading">
      <h1 id="exam-done-heading" ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      <p>{text}</p>
      <p>The camera has been turned off. You may close this page.</p>
      <button type="button" onClick={onBack}>
        Back to my exams
      </button>
    </section>
  );
}

export function ExamPage({ frameCheck, autosaveDebounceMs }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "choose" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(
    () => () => {
      stopStream(streamRef.current);
      exitExamFullscreen();
    },
    [],
  );

  const finish = useCallback((outcome: ExamOutcome) => {
    stopStream(streamRef.current);
    streamRef.current = null;
    exitExamFullscreen();
    setPhase({ name: "finished", outcome });
  }, []);

  async function start(choice: Choice, stream: MediaStream) {
    streamRef.current = stream;
    // Full screen has to be asked for inside the click, before anything is awaited.
    requestExamFullscreen();
    setStarting(true);
    setStartError(null);
    try {
      const attempt = await startAttempt({ batchId: choice.batch.id, testPaperId: choice.testPaperId });
      setStarting(false);
      if (attempt.status !== "in_progress") {
        finish("closed");
        return;
      }
      setPhase({ name: "exam", attempt, stream });
    } catch (error) {
      exitExamFullscreen();
      setStarting(false);
      setStartError(startErrorText(error));
    }
  }

  if (phase.name === "precheck") {
    return (
      <PrecheckScreen
        heading={`Batch ${phase.choice.batch.id}`}
        starting={starting}
        startError={startError}
        frameCheck={frameCheck}
        onStart={(stream) => void start(phase.choice, stream)}
        onCancel={() => {
          setStartError(null);
          setPhase({ name: "choose" });
        }}
      />
    );
  }
  if (phase.name === "exam") {
    return (
      <ExamScreen
        attempt={phase.attempt}
        stream={phase.stream}
        onFinished={finish}
        autosaveDebounceMs={autosaveDebounceMs}
      />
    );
  }
  if (phase.name === "finished") {
    return <Finished outcome={phase.outcome} onBack={() => setPhase({ name: "choose" })} />;
  }
  return (
    <BatchList
      onChoose={(choice) => {
        setStartError(null);
        setPhase({ name: "precheck", choice });
      }}
    />
  );
}
