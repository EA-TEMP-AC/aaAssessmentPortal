import type { AttemptQuestion } from "../api/attempts";

export type PaletteStatus = { attempted: boolean; review: boolean; skipped: boolean };

type Props = {
  questions: AttemptQuestion[];
  currentIndex: number;
  status: (questionId: string) => PaletteStatus;
  onSelect: (index: number) => void;
};

function describe(s: PaletteStatus): string {
  const parts = [s.attempted ? "attempted" : "not attempted"];
  if (s.review) parts.push("marked for review");
  if (s.skipped) parts.push("skipped");
  return parts.join(", ");
}

/**
 * Question palette: numbered boxes, a legend and counts. Every state has a symbol and a word as
 * well as a colour. Review and skipped marks live in the page only.
 */
export function QuestionPalette({ questions, currentIndex, status, onSelect }: Props) {
  // A question that was skipped and then answered is simply attempted.
  const all = questions.map((q) => {
    const s = status(q.questionId);
    return { ...s, skipped: s.skipped && !s.attempted };
  });
  const attempted = all.filter((s) => s.attempted).length;
  const review = all.filter((s) => s.review).length;
  const skipped = all.filter((s) => s.skipped).length;

  return (
    <nav aria-label="Questions" className="exam-nav">
      <ol className="exam-palette">
        {questions.map((q, i) => {
          const s = all[i];
          return (
            <li key={q.questionId}>
              <button
                type="button"
                className={[
                  "exam-nav-item",
                  s.attempted ? "exam-nav-done" : "",
                  s.review ? "exam-nav-review" : "",
                  s.skipped ? "exam-nav-skipped" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={i === currentIndex ? "step" : undefined}
                aria-label={`Question ${i + 1}, ${describe(s)}`}
                onClick={() => onSelect(i)}
              >
                <span aria-hidden="true">
                  {i + 1}
                  <span className="exam-nav-mark">
                    {s.attempted ? "✓" : s.skipped ? "–" : ""}
                    {s.review ? "⚑" : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <ul className="exam-legend" aria-label="Legend">
        <li>
          <span aria-hidden="true">✓</span> Attempted
        </li>
        <li>
          <span aria-hidden="true">□</span> Not attempted
        </li>
        <li>
          <span aria-hidden="true">⚑</span> Review
        </li>
        <li>
          <span aria-hidden="true">–</span> Skipped
        </li>
      </ul>
      <p className="field-hint exam-counts">
        Attempted {attempted}, Not attempted {questions.length - attempted}, Review {review}, Skipped {skipped}
      </p>
    </nav>
  );
}
