import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../api/client";
import { startAttempt, type Attempt } from "../api/attempts";
import { listAvailableAssessments, type AvailableAssessment } from "../api/availableAssessments";
import { ExamScreen, type ExamOutcome } from "../exam/ExamScreen";
import { exitExamFullscreen, requestExamFullscreen } from "../exam/fullscreen";
import type { FaceStart } from "../exam/faceEvidence";
import { PrecheckScreen, type FaceCheckOptions, type FrameCheckOptions } from "../exam/PrecheckScreen";
import { stopStream } from "../exam/precheck";

type Choice = { batchId: string; paperId: string; heading: string };

type Phase =
  | { name: "choose" }
  | { name: "precheck"; choice: Choice }
  | { name: "exam"; attempt: Attempt; stream: MediaStream; face: FaceStart }
  | { name: "finished"; outcome: ExamOutcome };

type Props = {
  /** Tests swap the frame reader; the page uses the real one. */
  frameCheck?: FrameCheckOptions;
  /** Tests swap the face matcher and camera helpers. */
  faceChecks?: FaceCheckOptions;
  autosaveDebounceMs?: number;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ne: "Nepali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
};

function languageName(value: string | null): string {
  if (!value) return "Not recorded";
  return LANGUAGE_NAMES[value.trim().toLowerCase()] ?? value;
}

/** Plain words for the reasons GET /attempts/available and POST /attempts/start share. */
function reasonText(code: string): string {
  switch (code) {
    case "ATTEMPT_OUTSIDE_ASSESSMENT_WINDOW":
      return "today is outside the assessment dates of your batch.";
    case "ATTEMPT_LANGUAGE_MISMATCH":
      return "this paper is not in the language of your batch. Tell your assessor or proctor.";
    case "ATTEMPT_CANDIDATE_ABSENT":
      return "you are marked absent for this batch. Speak to your assessor.";
    case "ATTEMPT_PAPER_UNAVAILABLE":
      return "this paper cannot be shown. Tell your assessor or proctor.";
    case "ATTEMPT_BATCH_NOT_IN_PROGRESS":
      return "this batch is not open for exams right now.";
    case "ATTEMPT_CLOSED":
      return "this exam is already closed.";
    default:
      return "it cannot be started right now. Ask your assessor or proctor.";
  }
}

function stateText(item: AvailableAssessment): string {
  if (item.attempt?.status === "in_progress") return "In progress";
  if (item.attempt?.status === "submitted") return "Submitted";
  if (item.attempt?.status === "timed_out") return "Timed out";
  if (item.startable.ok) return "Not started";
  return `Not available now: ${reasonText(item.startable.reason)}`;
}

function startErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "This paper was not found for your batch. Tell your assessor or proctor.";
    }
    if (error.code.startsWith("ATTEMPT_")) return `This exam cannot start: ${reasonText(error.code)}`;
    if (error.status === 403) return "You are not on the list of candidates for this batch.";
  }
  return errorMessage(error);
}

function PaperRow({ item, onChoose }: { item: AvailableAssessment; onChoose: (choice: Choice) => void }) {
  const stateId = `paper-${item.batchId}-${item.paperId}-state`;
  const resume = item.attempt?.status === "in_progress";
  const enabled = item.startable.ok && (item.attempt === null || resume);
  return (
    <li className="exam-paper">
      <h3>{item.paperName}</h3>
      <dl className="batch-facts">
        <div>
          <dt>Language</dt>
          <dd>{languageName(item.language)}</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{item.questionCount}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{item.durationMinutes} minutes</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd id={stateId}>{stateText(item)}</dd>
        </div>
      </dl>
      <button
        type="button"
        disabled={!enabled}
        aria-describedby={stateId}
        onClick={() =>
          onChoose({
            batchId: item.batchId,
            paperId: item.paperId,
            heading: item.paperName,
          })
        }
      >
        {resume ? "Resume" : "Start"}
        <span className="visually-hidden"> {item.paperName}</span>
      </button>
    </li>
  );
}

type BatchGroup = {
  batchId: string;
  batchName: string;
  items: AvailableAssessment[];
};

function groupByBatch(items: AvailableAssessment[]): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  for (const item of items) {
    const group = groups.get(item.batchId) ?? {
      batchId: item.batchId,
      batchName: item.batchName,
      items: [],
    };
    group.items.push(item);
    groups.set(item.batchId, group);
  }
  return [...groups.values()];
}

function AssessmentList({ onChoose }: { onChoose: (choice: Choice) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: ["exam", "available"],
    queryFn: ({ signal }) => listAvailableAssessments(signal),
    refetchOnMount: "always",
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="exam-list-heading">
      <h1 id="exam-list-heading" ref={headingRef} tabIndex={-1}>
        Exam
      </h1>
      <p>The assessments you can take are listed here. You need a working camera to take the exam.</p>
      {query.isPending ? <p role="status">Loading your assessments…</p> : null}
      {query.isError ? (
        <div role="alert" className="form-error">
          <p>{errorMessage(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {query.isSuccess && query.data.length === 0 ? (
        <p role="status">No assessments are available to you right now</p>
      ) : null}
      {query.isSuccess && query.data.length > 0 ? (
        <ul className="exam-batches">
          {groupByBatch(query.data).map((group) => (
            <li key={group.batchId} className="exam-batch">
              <h2>{group.batchName}</h2>
              <ul className="exam-papers">
                {group.items.map((item) => (
                  <PaperRow key={item.paperId} item={item} onChoose={onChoose} />
                ))}
              </ul>
            </li>
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

export function ExamPage({ frameCheck, faceChecks, autosaveDebounceMs }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "choose" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceRef = useRef<FaceStart | null>(null);

  useEffect(
    () => () => {
      stopStream(streamRef.current);
      faceRef.current?.matcher?.clear();
      exitExamFullscreen();
    },
    [],
  );

  const finish = useCallback((outcome: ExamOutcome) => {
    stopStream(streamRef.current);
    streamRef.current = null;
    faceRef.current?.matcher?.clear();
    faceRef.current = null;
    exitExamFullscreen();
    setPhase({ name: "finished", outcome });
  }, []);

  async function start(choice: Choice, stream: MediaStream, face: FaceStart) {
    streamRef.current = stream;
    faceRef.current = face;
    // Full screen has to be asked for inside the click, before anything is awaited.
    requestExamFullscreen();
    setStarting(true);
    setStartError(null);
    try {
      const attempt = await startAttempt({
        batchId: choice.batchId,
        testPaperId: choice.paperId,
      });
      setStarting(false);
      if (attempt.status !== "in_progress") {
        finish("closed");
        return;
      }
      setPhase({ name: "exam", attempt, stream, face });
    } catch (error) {
      exitExamFullscreen();
      setStarting(false);
      setStartError(startErrorText(error));
    }
  }

  if (phase.name === "precheck") {
    return (
      <PrecheckScreen
        heading={phase.choice.heading}
        starting={starting}
        startError={startError}
        frameCheck={frameCheck}
        faceChecks={faceChecks}
        onStart={(stream, face) => void start(phase.choice, stream, face)}
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
        face={phase.face}
        onFinished={finish}
        autosaveDebounceMs={autosaveDebounceMs}
      />
    );
  }
  if (phase.name === "finished") {
    return <Finished outcome={phase.outcome} onBack={() => setPhase({ name: "choose" })} />;
  }
  return (
    <AssessmentList
      onChoose={(choice) => {
        setStartError(null);
        setPhase({ name: "precheck", choice });
      }}
    />
  );
}
