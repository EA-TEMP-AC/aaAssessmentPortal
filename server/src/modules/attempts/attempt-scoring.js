/**
 * Pure scoring maths for the attempt engine (E-03). No database, no clock.
 * MCQ is scored here against the stored key. Every other type waits for manual marks.
 */

/** Question types the server scores itself. */
export const AUTO_SCORED_TYPES = Object.freeze(["mcq"]);

export const round2 = (n) => Math.round(n * 100) / 100;

export function normaliseAnswer(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** One MCQ against its key. A missing key cannot be scored (null). */
export function scoreMcq(answer, correctAnswer, marks) {
  if (
    correctAnswer === null ||
    correctAnswer === undefined ||
    normaliseAnswer(correctAnswer) === ""
  ) {
    return null;
  }
  return normaliseAnswer(answer) === normaliseAnswer(correctAnswer) ? marks : 0;
}

/**
 * Scores the MCQ items and leaves the rest pending. Manual marks already given are kept.
 * @param {Array<object>} questions attempt items
 * @param {Map<string, string|null>} keys question id to correct answer
 */
export function scoreQuestions(questions, keys) {
  return questions.map((q) => {
    if (q.scoreStatus === "scored" && q.scoredBy === "manual") return { ...q };
    if (!AUTO_SCORED_TYPES.includes(q.type)) return { ...q, scoreStatus: "pending" };
    const awarded = scoreMcq(q.answer, keys.get(String(q.questionId)), q.marks);
    if (awarded === null) return { ...q, awardedMarks: null, scoreStatus: "pending" };
    return { ...q, awardedMarks: awarded, scoreStatus: "scored", scoredBy: "auto" };
  });
}

function group(items, keyOf) {
  const map = new Map();
  for (const q of items) {
    const key = keyOf(q);
    const g = map.get(key) ?? {
      key,
      maxMarks: 0,
      obtainedMarks: 0,
      pendingMarks: 0,
      pendingCount: 0,
    };
    g.maxMarks += q.marks;
    if (q.scoreStatus === "scored") g.obtainedMarks += q.awardedMarks ?? 0;
    else {
      g.pendingMarks += q.marks;
      g.pendingCount += 1;
    }
    map.set(key, g);
  }
  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => ({
      key: g.key,
      maxMarks: round2(g.maxMarks),
      obtainedMarks: round2(g.obtainedMarks),
      pendingMarks: round2(g.pendingMarks),
      pendingCount: g.pendingCount,
    }));
}

/** Totals, per NOS and per type. Pending items count in `pending*` and not in `obtainedMarks`. */
export function computeScores(questions) {
  const total = group(questions, () => "all")[0] ?? {
    maxMarks: 0,
    obtainedMarks: 0,
    pendingMarks: 0,
    pendingCount: 0,
  };
  return {
    maxMarks: total.maxMarks,
    obtainedMarks: total.obtainedMarks,
    pendingMarks: total.pendingMarks,
    pendingCount: total.pendingCount,
    complete: total.pendingCount === 0,
    byNos: group(questions, (q) => q.nosId),
    byType: group(questions, (q) => q.type),
  };
}

/** Deadline and the last instant the server still takes a save or submit. */
export function computeDeadlines(startedAt, durationMinutes, graceSeconds) {
  const deadlineAt = new Date(startedAt.getTime() + durationMinutes * 60_000);
  const acceptUntil = new Date(deadlineAt.getTime() + graceSeconds * 1000);
  return { deadlineAt, acceptUntil };
}

/** True when the server no longer takes anything from the candidate. */
export function isPastAcceptWindow(attempt, now) {
  return now.getTime() > new Date(attempt.acceptUntil).getTime();
}
