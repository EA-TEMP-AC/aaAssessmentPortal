import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../api/client";
import { listAvailableAssessments, type AvailableAssessment } from "../api/availableAssessments";
import { dateText, languageName, reasonText, timeLeftText } from "../exam/examText";
import { installDashboardBridge, openExamWindow } from "../exam/examWindow";

type TabId = "upcoming" | "ongoing" | "completed";
type View = "grid" | "list";

const TABS: { id: TabId; label: string; empty: string }[] = [
  { id: "upcoming", label: "Upcoming", empty: "No upcoming assessments right now." },
  { id: "ongoing", label: "Ongoing", empty: "No exam is in progress." },
  { id: "completed", label: "Completed", empty: "No completed assessments yet." },
];

/** Which tab an assessment sits in, from the candidate's own attempt. */
function tabOf(item: AvailableAssessment): TabId {
  if (item.attempt?.status === "in_progress") return "ongoing";
  if (item.attempt) return "completed";
  return "upcoming";
}

function matches(item: AvailableAssessment, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return item.paperName.toLowerCase().includes(needle) || item.batchName.toLowerCase().includes(needle);
}

type CardProps = {
  item: AvailableAssessment;
  /** Seconds left at the time the list was read, less the time since. */
  secondsLeft: number | null;
  onStart: (item: AvailableAssessment) => void;
};

function AssessmentCard({ item, secondsLeft, onStart }: CardProps) {
  const stateId = useId();
  const tab = tabOf(item);
  let stateLine: string;
  let label: string;
  let enabled: boolean;
  if (tab === "completed") {
    stateLine = item.attempt?.status === "timed_out" ? "Timed out. Your saved answers were submitted." : "Submitted.";
    label = "Completed";
    enabled = false;
  } else if (tab === "ongoing") {
    enabled = item.startable.ok;
    stateLine = item.startable.ok
      ? secondsLeft === null
        ? "In progress."
        : `In progress. ${timeLeftText(secondsLeft)}.`
      : `In progress, but ${reasonText(item.startable.reason)}`;
    label = "Resume";
  } else {
    enabled = item.startable.ok;
    stateLine = item.startable.ok ? "You can start today." : `Not available now: ${reasonText(item.startable.reason)}`;
    label = "Start exam";
  }
  return (
    <li className="exam-card" aria-labelledby={`${stateId}-title`}>
      <h3 id={`${stateId}-title`}>{item.paperName}</h3>
      <p className="exam-card-batch">{item.batchName}</p>
      <dl className="batch-facts">
        <div>
          <dt>Start date</dt>
          <dd>{dateText(item.assessmentStartDate)}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>{dateText(item.assessmentEndDate)}</dd>
        </div>
        <div>
          <dt>Time window</dt>
          <dd>All day, Indian time</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{item.durationMinutes} minutes</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{languageName(item.language)}</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{item.questionCount}</dd>
        </div>
      </dl>
      <p id={stateId} className="exam-card-state">
        {stateLine}
      </p>
      <button type="button" disabled={!enabled} aria-describedby={stateId} onClick={() => onStart(item)}>
        {label}
        <span className="visually-hidden"> {item.paperName}</span>
      </button>
    </li>
  );
}

export function ExamPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ upcoming: null, ongoing: null, completed: null });
  const examWindow = useRef<Window | null>(null);
  const idBase = useId();
  const [tab, setTab] = useState<TabId>("upcoming");
  const [view, setView] = useState<View>("grid");
  const [search, setSearch] = useState("");
  const [blocked, setBlocked] = useState<AvailableAssessment | null>(null);
  const [opened, setOpened] = useState<AvailableAssessment | null>(null);
  const query = useQuery({
    queryKey: ["exam", "available"],
    queryFn: ({ signal }) => listAvailableAssessments(signal),
    refetchOnMount: "always",
  });
  const refetch = query.refetch;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // The exam window reads the session from here and asks for a refresh when it closes.
  useEffect(() => installDashboardBridge(() => examWindow.current, () => void refetch()), [refetch]);

  // When the candidate closes the exam window by hand, the list is read again.
  useEffect(() => {
    if (!opened) return;
    const timer = setInterval(() => {
      if (!examWindow.current || examWindow.current.closed) {
        examWindow.current = null;
        setOpened(null);
        void refetch();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [opened, refetch]);

  // Called from the click itself: a pop-up opened later is blocked by the browser.
  function startExam(item: AvailableAssessment) {
    const child = openExamWindow(item.batchId, item.paperId);
    if (!child) {
      setBlocked(item);
      setOpened(null);
      return;
    }
    examWindow.current = child;
    setBlocked(null);
    setOpened(item);
  }

  const items = useMemo(() => query.data ?? [], [query.data]);
  const visible = useMemo(() => items.filter((item) => matches(item, search)), [items, search]);
  const byTab = (id: TabId) => visible.filter((item) => tabOf(item) === id);
  const shown = byTab(tab);
  // The list was read at dataUpdatedAt; time left counts down from there.
  const readAt = query.dataUpdatedAt;
  const secondsLeft = (item: AvailableAssessment): number | null => {
    const left = item.attempt?.remainingSeconds;
    if (left === null || left === undefined) return null;
    return Math.max(0, left - Math.floor((Date.now() - readAt) / 1000));
  };

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((t) => t.id === tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  return (
    <section aria-labelledby="exam-list-heading">
      <h1 id="exam-list-heading" ref={headingRef} tabIndex={-1}>
        Exam
      </h1>
      <p>
        The assessments you can take are listed here. Each exam opens in its own window and needs a working camera.
        Allow pop-ups for this site.
      </p>

      <div className="exam-toolbar">
        <div className="field">
          <label htmlFor={`${idBase}-search`}>Search assessments</label>
          <input
            id={`${idBase}-search`}
            type="search"
            value={search}
            placeholder="Paper or batch name"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div role="group" aria-label="Layout" className="exam-view-toggle">
          <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
            Grid view
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            List view
          </button>
        </div>
      </div>

      {blocked ? (
        <div role="alert" className="form-error">
          <p>
            Your browser blocked the exam window. Allow pop-ups for this site (look for the pop-up icon in the address
            bar), then select Try again.
          </p>
          <button type="button" onClick={() => startExam(blocked)}>
            Try again
          </button>
        </div>
      ) : null}
      {opened ? (
        <p role="status">
          {opened.paperName} is open in another window. When you finish, close that window to come back here.
        </p>
      ) : null}

      <div role="tablist" aria-label="Assessments" className="exam-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(element) => {
              tabRefs.current[t.id] = element;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${idBase}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="exam-tab"
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
            {query.isSuccess ? ` (${byTab(t.id).length})` : ""}
          </button>
        ))}
      </div>

      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${idBase}-panel-${t.id}`}
          aria-labelledby={`${idBase}-tab-${t.id}`}
          hidden={tab !== t.id}
          className="exam-tabpanel"
        >
          {tab !== t.id ? null : query.isPending ? (
            <p role="status">Loading your assessments…</p>
          ) : query.isError ? (
            <div role="alert" className="form-error">
              <p>{errorMessage(query.error)}</p>
              <button type="button" onClick={() => void refetch()}>
                Try again
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p role="status">
              {search.trim() && items.some((item) => tabOf(item) === t.id)
                ? "No assessments match your search."
                : t.empty}
            </p>
          ) : (
            <ul className={view === "grid" ? "exam-cards exam-cards-grid" : "exam-cards exam-cards-list"}>
              {shown.map((item) => (
                <AssessmentCard
                  key={`${item.batchId}-${item.paperId}`}
                  item={item}
                  secondsLeft={secondsLeft(item)}
                  onStart={startExam}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
