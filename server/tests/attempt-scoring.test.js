import {
  computeDeadlines,
  computeScores,
  isPastAcceptWindow,
  scoreMcq,
  scoreQuestions,
} from "../src/modules/attempts/attempt-scoring.js";

const q = (over) => ({
  questionId: over.questionId,
  nosId: "NOS-01",
  type: "mcq",
  marks: 1,
  answer: null,
  awardedMarks: null,
  scoreStatus: "pending",
  scoredBy: null,
  ...over,
});

describe("attempt scoring maths", () => {
  it("scores one MCQ, ignoring case and spaces, and gives zero for wrong or empty", () => {
    expect(scoreMcq("a", "A", 2)).toBe(2);
    expect(scoreMcq(" A ", "a", 2)).toBe(2);
    expect(scoreMcq("B", "A", 2)).toBe(0);
    expect(scoreMcq(null, "A", 2)).toBe(0);
  });

  it("cannot score an MCQ that has no key", () => {
    expect(scoreMcq("A", null, 1)).toBeNull();
    expect(scoreMcq("A", "  ", 1)).toBeNull();
  });

  it("scores MCQ and leaves every other type pending", () => {
    const keys = new Map([
      ["1", "A"],
      ["2", "B"],
    ]);
    const out = scoreQuestions(
      [
        q({ questionId: "1", answer: "A", marks: 2 }),
        q({ questionId: "2", answer: "A", marks: 2 }),
        q({ questionId: "3", type: "short_answer", answer: "text", marks: 3 }),
        q({ questionId: "4", type: "scenario", marks: 4 }),
        q({ questionId: "5", type: "viva", marks: 5 }),
        q({ questionId: "6", type: "practical", marks: 6 }),
      ],
      keys,
    );
    expect(out.map((x) => [x.scoreStatus, x.awardedMarks, x.scoredBy])).toEqual([
      ["scored", 2, "auto"],
      ["scored", 0, "auto"],
      ["pending", null, null],
      ["pending", null, null],
      ["pending", null, null],
      ["pending", null, null],
    ]);
  });

  it("keeps manual marks when scoring runs again", () => {
    const manual = q({
      questionId: "3",
      type: "viva",
      marks: 5,
      awardedMarks: 4,
      scoreStatus: "scored",
      scoredBy: "manual",
    });
    const [kept] = scoreQuestions([manual], new Map());
    expect(kept.awardedMarks).toBe(4);
    expect(kept.scoredBy).toBe("manual");
  });

  it("totals, per NOS and per type, with pending marks apart", () => {
    const items = [
      q({ questionId: "1", nosId: "NOS-01", marks: 1, awardedMarks: 1, scoreStatus: "scored" }),
      q({ questionId: "2", nosId: "NOS-01", marks: 1, awardedMarks: 0, scoreStatus: "scored" }),
      q({ questionId: "3", nosId: "NOS-02", marks: 0.5, awardedMarks: 0.5, scoreStatus: "scored" }),
      q({ questionId: "4", nosId: "NOS-02", type: "viva", marks: 5 }),
    ];
    const s = computeScores(items);
    expect(s).toMatchObject({
      maxMarks: 7.5,
      obtainedMarks: 1.5,
      pendingMarks: 5,
      pendingCount: 1,
      complete: false,
    });
    expect(s.byNos).toEqual([
      { key: "NOS-01", maxMarks: 2, obtainedMarks: 1, pendingMarks: 0, pendingCount: 0 },
      { key: "NOS-02", maxMarks: 5.5, obtainedMarks: 0.5, pendingMarks: 5, pendingCount: 1 },
    ]);
    expect(s.byType.map((g) => g.key)).toEqual(["mcq", "viva"]);
  });

  it("avoids float drift in totals", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      q({ questionId: String(i), marks: 0.1, awardedMarks: 0.1, scoreStatus: "scored" }),
    );
    expect(computeScores(items).obtainedMarks).toBe(1);
  });

  it("is complete when nothing is pending, and for an empty paper", () => {
    expect(computeScores([]).complete).toBe(true);
    const done = [q({ questionId: "1", awardedMarks: 1, scoreStatus: "scored" })];
    expect(computeScores(done).complete).toBe(true);
  });
});

describe("attempt timer maths", () => {
  const start = new Date("2026-11-20T05:00:00.000Z");

  it("adds the duration, then the grace", () => {
    const { deadlineAt, acceptUntil } = computeDeadlines(start, 90, 30);
    expect(deadlineAt.toISOString()).toBe("2026-11-20T06:30:00.000Z");
    expect(acceptUntil.toISOString()).toBe("2026-11-20T06:30:30.000Z");
  });

  it("takes input up to and including the last grace instant, not after", () => {
    const attempt = computeDeadlines(start, 1, 30);
    expect(isPastAcceptWindow(attempt, new Date(attempt.deadlineAt.getTime() + 1))).toBe(false);
    expect(isPastAcceptWindow(attempt, attempt.acceptUntil)).toBe(false);
    expect(isPastAcceptWindow(attempt, new Date(attempt.acceptUntil.getTime() + 1))).toBe(true);
  });

  it("with no grace the deadline is the limit", () => {
    const attempt = computeDeadlines(start, 1, 0);
    expect(attempt.acceptUntil.getTime()).toBe(attempt.deadlineAt.getTime());
  });
});
