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

/** What the wizard asks the server for, or the reason it cannot. */
export function buildPaperRequest(
  plan: Extract<PaperPlan, { mode: "build" }>,
  qualificationId: string,
  batchLanguage: string,
  nos: readonly Pick<Nos, "nosId">[],
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
    quotas: evenQuotas(nos, total),
    allowPartial: false,
  };
  if (plan.weightProfileId) input.weightProfileId = plan.weightProfileId;
  if (minutes) input.durationMinutes = Number(minutes);
  return { input };
}

