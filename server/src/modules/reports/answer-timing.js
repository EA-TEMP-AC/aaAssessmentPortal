/**
 * X-09. Time spent per question, worked out from when each answer was last saved.
 * The first answered question counts from the attempt start; each later one from the answer
 * before it (in time order). Questions never answered get null. It is an estimate: the saved time
 * is the last save of that answer, and a candidate can revisit questions.
 * @param {{ startedAt: Date|string, questions: Array<{ questionId: unknown, answeredAt?: Date|string|null }> }} attempt
 * @returns {Map<string, number>} questionId -> seconds
 */
export function answerTimings(attempt) {
  const answered = attempt.questions
    .filter((q) => q.answeredAt)
    .map((q) => ({ id: String(q.questionId), at: new Date(q.answeredAt).getTime() }))
    .sort((a, b) => a.at - b.at);
  const out = new Map();
  let previous = new Date(attempt.startedAt).getTime();
  for (const row of answered) {
    out.set(row.id, Math.max(0, Math.round((row.at - previous) / 1000)));
    previous = row.at;
  }
  return out;
}
