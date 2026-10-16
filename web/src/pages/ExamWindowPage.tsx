import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import {
  getAttempt,
  startAttempt,
  type Attempt,
  type AttemptMarks,
} from "../api/attempts";
import { getCandidateInfoStatus, type InfoField } from "../api/batchSettings";
import { CandidateInfoForm } from "../exam/CandidateInfoForm";
import { listAvailableAssessments } from "../api/availableAssessments";
import { ExamScreen, type ExamOutcome } from "../exam/ExamScreen";
import { reasonText, startErrorText } from "../exam/examText";
import {
  adoptOpenerSession,
  closeExamWindow,
  connectToOpener,
  hasLiveOpener,
} from "../exam/examWindow";
import { exitExamFullscreen, requestExamFullscreen } from "../exam/fullscreen";
import type { FaceStart } from "../exam/faceEvidence";
import {
  PrecheckScreen,
  type FaceCheckOptions,
  type FrameCheckOptions,
} from "../exam/PrecheckScreen";
import { stopStream } from "../exam/precheck";
import { createLocationProvider } from "../proctoring/location";

/**
 * X-08: open the exam with browser full screen. Off: the exam has its own window instead.
 * Kept so a batch setting can switch it back on later (DECISIONS 841). When on, the page asks
 * for full screen inside the Start click, the exam shows the "return to full screen" notice and
 * the proctoring engine raises fullscreen_exit.
 */
export const REQUIRE_FULLSCREEN = false;

/** Route wrapper: takes the session from the dashboard window before the sign-in guard runs. */
export function ExamWindowGate() {
  useState(() => {
    adoptOpenerSession();
    return true;
  });
  useEffect(() => connectToOpener(), []);
  return <Outlet />;
}

type Phase =
  | { name: "precheck" }
  | { name: "info"; stream: MediaStream; face: FaceStart; fields: InfoField[] }
  | { name: "exam"; attempt: Attempt; stream: MediaStream; face: FaceStart }
  | {
      name: "finished";
      outcome: ExamOutcome;
      attemptId: string | null;
      showMarks: boolean;
    };

type Props = {
  /** Tests swap the frame reader; the page uses the real one. */
  frameCheck?: FrameCheckOptions;
  /** Tests swap the face matcher and camera helpers. */
  faceChecks?: FaceCheckOptions;
  autosaveDebounceMs?: number;
  requireFullscreen?: boolean;
};

function useFocusOnMount() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function CloseWindowButton({ label }: { label: string }) {
  const navigate = useNavigate();
  const [stayedOpen, setStayedOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!hasLiveOpener()) {
            // Opened by hand, not from the dashboard: there is no window to close or refresh.
            navigate("/exam");
            return;
          }
          closeExamWindow();
          // A browser that refuses to close the window leaves it open.
          setTimeout(() => setStayedOpen(true), 300);
        }}
      >
        {label}
      </button>
      {stayedOpen ? (
        <p role="status">
          Your browser did not close this window. You can close it yourself.
        </p>
      ) : null}
    </>
  );
}

/** B-20. The candidate's total, only when the batch shows marks and the server returns them. */
function MarksLine({ attemptId }: { attemptId: string }) {
  const query = useQuery({
    queryKey: ["exam", "marks", attemptId],
    queryFn: ({ signal }) => getAttempt(attemptId, signal),
    retry: false,
  });
  const marks: AttemptMarks | null | undefined = query.data?.marks;
  if (query.isPending) return <p role="status">Loading your marks…</p>;
  if (!marks) return null;
  return (
    <p role="status">
      Your marks: {marks.obtainedMarks} out of {marks.maxMarks}.
      {marks.complete
        ? ""
        : " Some answers are still to be marked by hand, so this total can change."}
    </p>
  );
}

function Finished({
  outcome,
  attemptId,
  showMarks,
}: {
  outcome: ExamOutcome;
  attemptId: string | null;
  showMarks: boolean;
}) {
  const headingRef = useFocusOnMount();
  const title =
    outcome === "submitted"
      ? "Exam submitted"
      : outcome === "timed_out"
        ? "Time is up"
        : "This exam is closed";
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
      {showMarks && attemptId ? <MarksLine attemptId={attemptId} /> : null}
      <p>The camera has been turned off.</p>
      <CloseWindowButton
        label={
          hasLiveOpener()
            ? "Close window and refresh dashboard"
            : "Back to my exams"
        }
      />
    </section>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  const headingRef = useFocusOnMount();
  return (
    <section aria-labelledby="exam-problem-heading">
      <h1 id="exam-problem-heading" ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      <div role="alert" className="form-error">
        {children}
      </div>
      <CloseWindowButton
        label={hasLiveOpener() ? "Close window" : "Back to my exams"}
      />
    </section>
  );
}

/** The whole exam, on its own: no sidebar, no admin links. Route /exam/window/:batchId/:paperId. */
export function ExamWindowPage({
  frameCheck,
  faceChecks,
  autosaveDebounceMs,
  requireFullscreen = REQUIRE_FULLSCREEN,
}: Props) {
  const { batchId = "", paperId = "" } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ name: "precheck" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceRef = useRef<FaceStart | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const query = useQuery({
    queryKey: ["exam", "available"],
    queryFn: ({ signal }) => listAvailableAssessments(signal),
  });

  useEffect(() => {
    document.title = "Exam";
  }, []);

  useEffect(
    () => () => {
      stopStream(streamRef.current);
      faceRef.current?.matcher?.clear();
      if (requireFullscreen) exitExamFullscreen();
    },
    [requireFullscreen],
  );

  const finish = useCallback(
    (outcome: ExamOutcome) => {
      stopStream(streamRef.current);
      streamRef.current = null;
      faceRef.current?.matcher?.clear();
      faceRef.current = null;
      if (requireFullscreen) exitExamFullscreen();
      const last = attemptRef.current;
      setPhase({
        name: "finished",
        outcome,
        attemptId: last?.id ?? null,
        showMarks: last?.settings.showMarksToCandidate === true,
      });
    },
    [requireFullscreen],
  );

  function release() {
    stopStream(streamRef.current);
    streamRef.current = null;
    faceRef.current?.matcher?.clear();
    faceRef.current = null;
    if (requireFullscreen) exitExamFullscreen();
  }

  /** Starts the attempt. The clock starts here, so the candidate's details are asked before this. */
  async function begin(stream: MediaStream, face: FaceStart) {
    setStarting(true);
    setStartError(null);
    try {
      const attempt = await startAttempt({ batchId, testPaperId: paperId });
      setStarting(false);
      attemptRef.current = attempt;
      if (attempt.status !== "in_progress") {
        finish("closed");
        return;
      }
      setPhase({ name: "exam", attempt, stream, face });
    } catch (error) {
      if (requireFullscreen) exitExamFullscreen();
      setStarting(false);
      setStartError(startErrorText(error));
    }
  }

  async function start(
    stream: MediaStream,
    face: FaceStart,
    captureLocation: boolean,
  ) {
    streamRef.current = stream;
    faceRef.current = face;
    // Only when full screen is switched on: it has to be asked for inside the click.
    if (requireFullscreen) requestExamFullscreen();
    // X-07: the browser asks about location once, here, not in the middle of the exam. The answer is
    // not waited for, and a refusal changes nothing.
    if (captureLocation) void createLocationProvider().get();
    setStarting(true);
    setStartError(null);
    // B-20: when the batch asks for the candidate's details, they come after the camera check
    // and before the exam clock starts. Not found means nothing is asked; the start reports it.
    try {
      const popup = await getCandidateInfoStatus(batchId);
      if (popup.enabled && !popup.submitted && popup.fields.length > 0) {
        setStarting(false);
        setPhase({ name: "info", stream, face, fields: popup.fields });
        return;
      }
    } catch (error) {
      if (!(
        error instanceof ApiError &&
        (error.status === 404 || error.status === 403)
      )) {
        if (requireFullscreen) exitExamFullscreen();
        setStarting(false);
        setStartError(
          "Could not check whether the exam needs more details from you. Try again.",
        );
        return;
      }
    }
    await begin(stream, face);
  }

  if (phase.name === "info") {
    return (
      <CandidateInfoForm
        batchId={batchId}
        fields={phase.fields}
        onDone={() => void begin(phase.stream, phase.face)}
        onCancel={() => {
          release();
          setStartError(null);
          setPhase({ name: "precheck" });
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
        requireFullscreen={requireFullscreen}
      />
    );
  }
  if (phase.name === "finished") {
    return (
      <Finished
        outcome={phase.outcome}
        attemptId={phase.attemptId}
        showMarks={phase.showMarks}
      />
    );
  }

  if (query.isPending) return <p role="status">Loading your exam…</p>;
  if (query.isError) {
    return (
      <section>
        <h1>Exam</h1>
        <div role="alert" className="form-error">
          <p>{errorMessage(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
        <CloseWindowButton
          label={hasLiveOpener() ? "Close window" : "Back to my exams"}
        />
      </section>
    );
  }
  const item = query.data.find(
    (row) => row.batchId === batchId && row.paperId === paperId,
  );
  if (!item) {
    return (
      <Problem title="Exam not found">
        This exam is not on your list. Close this window and open it again from
        your exams.
      </Problem>
    );
  }
  if (!item.startable.ok) {
    return (
      <Problem title="This exam cannot be started">
        <p>
          {item.paperName}: {reasonText(item.startable.reason)}
        </p>
      </Problem>
    );
  }
  return (
    <PrecheckScreen
      heading={item.paperName}
      captureLocation={item.captureLocation}
      starting={starting}
      startError={startError}
      frameCheck={frameCheck}
      faceChecks={faceChecks}
      onStart={(stream, face) => void start(stream, face, item.captureLocation)}
      cancelLabel={hasLiveOpener() ? "Close this window" : "Back to my exams"}
      onCancel={() => {
        if (hasLiveOpener()) closeExamWindow();
        else navigate("/exam");
      }}
    />
  );
}
