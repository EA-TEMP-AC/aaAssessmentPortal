import { QUESTION_DIFFICULTIES } from "../../models/question.model.js";
import { BLOOM_LEVELS } from "../../models/weight-profile.model.js";

export const UNCLASSIFIED = "unclassified";

/** Percentages are compared in hundredths so 33.33 + 33.33 + 33.34 is exactly 100. */
export function weightsSumToHundred(weights) {
  const hundredths = Object.values(weights).reduce((s, v) => s + Math.round(v * 100), 0);
  return hundredths === 10000;
}

export const difficultyOf = (q) =>
  QUESTION_DIFFICULTIES.includes(q.difficulty) ? q.difficulty : UNCLASSIFIED;

export function bloomOf(q) {
  const level = String(q.bloomLevel ?? "")
    .trim()
    .toLowerCase();
  return BLOOM_LEVELS.includes(level) ? level : UNCLASSIFIED;
}

/**
 * Whole-question targets for n items: largest remainder, ties go to the earlier category.
 * Counts always add up to n.
 */
export function targetCounts(weights, categories, n) {
  const exact = categories.map((c) => ({ c, v: ((weights[c] ?? 0) * n) / 100 }));
  const out = Object.fromEntries(exact.map(({ c, v }) => [c, Math.floor(v + 1e-9)]));
  let left = n - Object.values(out).reduce((s, v) => s + v, 0);
  const order = exact
    .map(({ c, v }, idx) => ({ c, idx, frac: v - Math.floor(v + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left -= 1) out[order[i].c] += 1;
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100;

function dimensionReport(weights, categories, targets, achieved, n) {
  const rows = {};
  let maxDeviation = 0;
  for (const c of categories) {
    const got = achieved[c] ?? 0;
    const achievedPercent = n === 0 ? 0 : round2((got * 100) / n);
    const targetPercent = weights[c] ?? 0;
    maxDeviation = Math.max(maxDeviation, Math.abs(achievedPercent - targetPercent));
    rows[c] = {
      targetPercent,
      targetCount: targets[c],
      achievedCount: got,
      achievedPercent,
      differenceCount: got - targets[c],
    };
  }
  const un = achieved[UNCLASSIFIED] ?? 0;
  rows[UNCLASSIFIED] = { achievedCount: un, achievedPercent: n === 0 ? 0 : round2((un * 100) / n) };
  return { rows, maxDeviation: round2(maxDeviation) };
}

/** Target versus achieved mix of the chosen items. Unclassified items are listed, never hidden. */
export function buildMixReport(profile, items) {
  const n = items.length;
  const count = (fn) => {
    const acc = {};
    for (const i of items) {
      const k = fn(i);
      acc[k] = (acc[k] ?? 0) + 1;
    }
    return acc;
  };
  const dTargets = targetCounts(profile.difficultyWeights, QUESTION_DIFFICULTIES, n);
  const bTargets = targetCounts(profile.bloomWeights, BLOOM_LEVELS, n);
  const d = dimensionReport(
    profile.difficultyWeights,
    QUESTION_DIFFICULTIES,
    dTargets,
    count(difficultyOf),
    n,
  );
  const b = dimensionReport(profile.bloomWeights, BLOOM_LEVELS, bTargets, count(bloomOf), n);
  const unclassifiedDifficulty = d.rows[UNCLASSIFIED].achievedCount;
  const unclassifiedBloom = b.rows[UNCLASSIFIED].achievedCount;
  const exact = (rows, cats) => cats.every((c) => rows[c].differenceCount === 0);
  return {
    totalItems: n,
    difficulty: d.rows,
    bloom: b.rows,
    maxDifficultyDeviationPoints: d.maxDeviation,
    maxBloomDeviationPoints: b.maxDeviation,
    unclassifiedDifficulty,
    unclassifiedBloom,
    matched:
      exact(d.rows, QUESTION_DIFFICULTIES) &&
      exact(b.rows, BLOOM_LEVELS) &&
      unclassifiedDifficulty === 0 &&
      unclassifiedBloom === 0,
  };
}

/** Penalty for an item with no usable value on a dimension, so it is taken last. */
const UNCLASSIFIED_PENALTY = 1000;

/** How much the paper still needs this item's class on both dimensions. Higher is better. */
export function deficitScore(item, state) {
  const d = difficultyOf(item);
  const b = bloomOf(item);
  const dScore = d === UNCLASSIFIED ? -UNCLASSIFIED_PENALTY : state.dTargets[d] - state.dCount[d];
  const bScore = b === UNCLASSIFIED ? -UNCLASSIFIED_PENALTY : state.bTargets[b] - state.bCount[b];
  return dScore + bScore;
}

export function newMixState(profile, n) {
  return {
    dTargets: targetCounts(profile.difficultyWeights, QUESTION_DIFFICULTIES, n),
    bTargets: targetCounts(profile.bloomWeights, BLOOM_LEVELS, n),
    dCount: Object.fromEntries(QUESTION_DIFFICULTIES.map((c) => [c, 0])),
    bCount: Object.fromEntries(BLOOM_LEVELS.map((c) => [c, 0])),
  };
}

export function recordPick(item, state) {
  const d = difficultyOf(item);
  const b = bloomOf(item);
  if (d !== UNCLASSIFIED) state.dCount[d] += 1;
  if (b !== UNCLASSIFIED) state.bCount[b] += 1;
}
