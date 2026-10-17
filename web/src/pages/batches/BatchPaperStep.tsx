import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/client";
import { listApprovedWeightProfiles, listPapers, paperTitle } from "../../api/testPapers";
import { nosOf, useQualifications } from "../questionBank/qualifications";
import { sameLanguage } from "./paperLanguage";
import { LATER_PLAN, MAX_BUILT_QUESTIONS, type PaperPlan } from "./paperPlan";

/**
 * X-18. Step 2 of creating a batch: the question paper. Three choices: decide later, use an
 * approved paper of the qualification, or build a new one from the question bank by saying how
 * many questions and which difficulty mix (an approved weight profile). A built paper is a
 * draft; it is sent for approval and can be attached to the batch once the reviewer approves it.
 */

type Props = {
  qualificationId: string;
  assessmentLanguage: string;
  plan: PaperPlan;
  onChange: (plan: PaperPlan) => void;
  disabled?: boolean;
};

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;

export function BatchPaperStep({ qualificationId, assessmentLanguage, plan, onChange, disabled }: Props) {
  const ids = useId();
  const ready = OBJECT_ID.test(qualificationId);
  const approved = useQuery({
    queryKey: ["papers", "approved-for", qualificationId],
    enabled: ready,
    queryFn: ({ signal }) => listPapers({ qualificationId, status: "approved", page: 1, pageSize: 100 }, signal),
  });
  const profiles = useQuery({
    queryKey: ["papers", "weight-profiles", qualificationId],
    enabled: ready && plan.mode === "build",
    queryFn: ({ signal }) => listApprovedWeightProfiles(qualificationId, signal),
  });
  const qualifications = useQualifications(ready && plan.mode === "build");

  const choices = (approved.data?.items ?? []).filter(
    (paper) => paper.complete && sameLanguage(paper.language, assessmentLanguage),
  );
  const nos = nosOf(qualifications.data, qualificationId);
  const buildPlan = plan.mode === "build" ? plan : null;

  return (
    <fieldset className="bare-fieldset" disabled={disabled}>
      <legend>Step 2: Question paper (optional)</legend>
      <p className="field-hint">
        A candidate can start only when the batch has an approved paper. You can also set it later on the batch page.
      </p>
      {!ready ? <p role="status">Choose a qualification above to see papers.</p> : null}
      <label className="check-label">
        <input
          type="radio"
          name={`${ids}-mode`}
          checked={plan.mode === "later"}
          onChange={() => onChange(LATER_PLAN)}
        />{" "}
        Decide later
      </label>
      <label className="check-label">
        <input
          type="radio"
          name={`${ids}-mode`}
          checked={plan.mode === "existing"}
          onChange={() => onChange({ mode: "existing", paperId: "" })}
        />{" "}
        Use an approved paper
      </label>
      {plan.mode === "existing" ? (
        <div className="field">
          <label htmlFor={`${ids}-paper`}>Approved paper</label>
          <select
            id={`${ids}-paper`}
            value={plan.paperId}
            onChange={(event) => onChange({ mode: "existing", paperId: event.target.value })}
          >
            <option value="">{approved.isPending && ready ? "Loading…" : "Choose an approved paper"}</option>
            {choices.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paperTitle(paper)} ({paper.totalMarks} marks)
              </option>
            ))}
          </select>
          {approved.isError ? <p role="status">Papers could not be loaded. {errorMessage(approved.error)}</p> : null}
          {approved.data && choices.length === 0 ? (
            <p role="status">
              There is no approved, complete paper for this qualification in {assessmentLanguage || "this language"}{" "}
              yet. Build one below, or <Link to="/papers">open the papers</Link>.
            </p>
          ) : null}
        </div>
      ) : null}
      <label className="check-label">
        <input
          type="radio"
          name={`${ids}-mode`}
          checked={plan.mode === "build"}
          onChange={() =>
            onChange({ mode: "build", totalQuestions: "", weightProfileId: "", durationMinutes: "", sendForApproval: true })
          }
        />{" "}
        Build a new paper from the question bank
      </label>
      {buildPlan ? (
        <div className="paper-build">
          <div className="field">
            <label htmlFor={`${ids}-total`}>Number of questions</label>
            <input
              id={`${ids}-total`}
              type="number"
              min={1}
              max={MAX_BUILT_QUESTIONS}
              step={1}
              value={buildPlan.totalQuestions}
              onChange={(event) => onChange({ ...buildPlan, totalQuestions: event.target.value })}
            />
            <p className="field-hint">
              Split evenly over the {nos.length > 0 ? nos.length : ""} NOS of the qualification. Only approved questions
              of the batch language are used.
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-profile`}>Difficulty mix</label>
            <select
              id={`${ids}-profile`}
              value={buildPlan.weightProfileId}
              onChange={(event) => onChange({ ...buildPlan, weightProfileId: event.target.value })}
            >
              <option value="">{profiles.isPending && ready ? "Loading…" : "No target (any difficulty)"}</option>
              {(profiles.data ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} (version {profile.version})
                </option>
              ))}
            </select>
            <p className="field-hint">
              An approved weight profile sets the share of easy, medium and tough questions. The generator comes as close
              as the bank allows and the paper shows the result.
            </p>
            {profiles.isError ? <p role="status">Difficulty mixes could not be loaded. {errorMessage(profiles.error)}</p> : null}
          </div>
          <div className="field">
            <label htmlFor={`${ids}-minutes`}>Duration in minutes (optional)</label>
            <input
              id={`${ids}-minutes`}
              inputMode="numeric"
              value={buildPlan.durationMinutes}
              onChange={(event) => onChange({ ...buildPlan, durationMinutes: event.target.value })}
            />
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={buildPlan.sendForApproval}
              onChange={(event) => onChange({ ...buildPlan, sendForApproval: event.target.checked })}
            />{" "}
            Send the new paper to the awarding body reviewer for approval
          </label>
          <p className="field-hint">
            The new paper is a draft until the reviewer approves it. Then set it on the batch page; candidates cannot
            start before that.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
