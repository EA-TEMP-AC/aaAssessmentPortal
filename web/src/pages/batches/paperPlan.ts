import type { Nos } from "../../api/masterData";
import type { GenerateInput } from "../../api/testPapers";
import { languageKey } from "./paperLanguage";

/** X-18. The paper choice of the create-batch page, and what it asks the server for. */

export type PaperPlan =
  | { mode: "later" }
  | { mode: "existing"; paperId: string }
  | {
      mode: "build";
      totalQuestions: string;
      weightProfileId: string;
      durationMinutes: string;
      sendForApproval: boolean;
    };

export const LATER_PLAN: PaperPlan = { mode: "later" };

export const MAX_BUILT_QUESTIONS = 500;

/** The count split as evenly as possible over the NOS, the first ones getting the remainder. Zero counts are left out. */
export function evenQuotas(nos: readonly Pick<Nos, "nosId">[], total: number): { nosId: string; count: number }[] {
  if (nos.length === 0 || total < 1) return [];
  const base = Math.floor(total / nos.length);
  const extra = total % nos.length;
  return nos
    .map((item, index) => ({ nosId: item.nosId, count: base + (index < extra ? 1 : 0) }))
    .filter((row) => row.count > 0);
}

type NosWeight = Pick<Nos, "nosId"> & { maxMarks?: { theory?: number | null } | null };

/**
 * The count split by the theory marks of each NOS (a NOS worth 40% of the marks gets about 40% of
 * the questions), whole numbers by largest remainder. Used only when every NOS has theory marks;
 * otherwise the split is even. NCVET asks for tests mapped to NOS and PC with the marks "as per
 * the qualification", so the marks are the better guide when they are recorded.
 */
export function splitQuotas(nos: readonly NosWeight[], total: number): { nosId: string; count: number }[] {
  const weights = nos.map((item) => item.maxMarks?.theory ?? 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (nos.length === 0 || total < 1 || weights.some((w) => !(w > 0)) || sum <= 0) return evenQuotas(nos, total);
  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    counts[index] += 1;
    left -= 1;
  }
  return nos.map((item, index) => ({ nosId: item.nosId, count: counts[index] })).filter((row) => row.count > 0);
}

/** What the wizard asks the server for, or the reason it cannot. */
export function buildPaperRequest(
  plan: Extract<PaperPlan, { mode: "build" }>,
  qualificationId: string,
  batchLanguage: string,
  nos: readonly NosWeight[],
): { input: GenerateInput } | { problem: string } {
  const total = Number(plan.totalQuestions);
  if (!Number.isInteger(total) || total < 1 || total > MAX_BUILT_QUESTIONS) {
    return { problem: `Enter how many questions the paper needs, a whole number from 1 to ${MAX_BUILT_QUESTIONS}.` };
  }
  const minutes = plan.durationMinutes.trim();
  if (minutes && (!/^\d+$/.test(minutes) || Number(minutes) < 1 || Number(minutes) > 600)) {
    return { problem: "Duration must be a whole number of minutes from 1 to 600." };
  }
  if (nos.length === 0) return { problem: "This qualification has no NOS, so a paper cannot be built from the bank." };
  const input: GenerateInput = {
    qualificationId,
    language: languageKey(batchLanguage),
    quotas: splitQuotas(nos, total),
    allowPartial: false,
  };
  if (plan.weightProfileId) input.weightProfileId = plan.weightProfileId;
  if (minutes) input.durationMinutes = Number(minutes);
  return { input };
}

