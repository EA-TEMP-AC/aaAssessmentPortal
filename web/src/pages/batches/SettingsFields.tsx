import { useId, type ReactNode } from "react";
import {
  INFO_FIELD_LABELS,
  INFO_FIELDS,
  INTERVAL_MAX_SECONDS,
  INTERVAL_MIN_SECONDS,
  LOCATION_ROLE_LABELS,
  LOCATION_ROLES,
  PASS_PERCENTAGE_MAX,
  PASS_PERCENTAGE_MIN,
  PAUSE_AFTER_MAX,
  PAUSE_AFTER_MIN,
} from "../../api/batchSettings";
import type { Draft, Problems } from "./settingsDraft";

/**
 * The exam switches, shared by the batch settings page and step 3 of creating a batch (X-19).
 * The caller owns the draft; this only draws the fields.
 */

/** X-28: shown on a switch that is saved but does not change anything yet. */
const SOON =
  "Saved for this batch, but not applied yet: it starts working when that part of the portal is built. ";

function Toggle({
  label,
  help,
  checked,
  disabled,
  soon,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  /** The switch is stored but the feature behind it is not built yet. */
  soon?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="yn-row">
        <label className="check-label" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            aria-describedby={`${id}-help`}
            onChange={(event) => onChange(event.target.checked)}
          />{" "}
          {label}
        </label>
        <span className={checked ? "yn yn-yes" : "yn yn-no"} aria-hidden="true">
          {checked ? "Yes" : "No"}
        </span>
      </div>
      <p id={`${id}-help`} className="field-hint">
        {soon ? SOON : ""}
        {help}
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="settings-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function SettingsFields({
  draft,
  set,
  problems,
  hidePaperGroup = false,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  problems: Problems;
  /** The wizard shows the paper switch in its own paper step. */
  hidePaperGroup?: boolean;
}) {
  const ids = {
    pass: useId(),
    after: useId(),
    unlock: useId(),
    interval: useId(),
    fields: useId(),
  };
  const popupOn = draft.popupEnabled;
  return (
    <>
      <Group title="Shuffling">
        <Toggle
          label="Shuffle the questions"
          help="Each candidate sees the questions in their own order. The order stays the same if they resume."
          checked={draft.shuffleQuestions}
          onChange={(v) => set("shuffleQuestions", v)}
        />
        <Toggle
          label="Shuffle the answer options"
          help="Each candidate sees the options of a multiple choice question in their own order. Marking does not depend on the order."
          checked={draft.shuffleOptions}
          onChange={(v) => set("shuffleOptions", v)}
        />
      </Group>

      <Group title="Result display">
        <Toggle
          label="Show marks to the candidate"
          help="After the exam closes, the candidate sees their total marks. Off means they see no marks."
          checked={draft.showMarksToCandidate}
          onChange={(v) => set("showMarksToCandidate", v)}
        />
        <Toggle
          label="Show marks only after the awarding body validates the result"
          help="On: even with the switch above on, the candidate sees marks only once the result of this batch is validated. Off: marks appear as soon as the exam closes. Use off for mock tests."
          checked={draft.marksAfterValidation}
          onChange={(v) => set("marksAfterValidation", v)}
        />
        <Toggle
          label="Every question must be answered"
          help="The candidate cannot submit while a question is unanswered. When the time ends, the exam still closes."
          checked={draft.questionsMandatory}
          onChange={(v) => set("questionsMandatory", v)}
        />
      </Group>

      <Group title="Proctoring">
        <fieldset className="bare-fieldset">
          <legend>Proctoring type</legend>
          <label className="check-label">
            <input
              type="radio"
              name="proctoring-type"
              checked={draft.proctoringType === "automatic"}
              onChange={() => set("proctoringType", "automatic")}
            />{" "}
            Automatic
          </label>
          <p className="field-hint">
            The exam page raises flags by itself, and a person reviews them.
          </p>
          <label className="check-label">
            <input
              type="radio"
              name="proctoring-type"
              checked={draft.proctoringType === "manual"}
              onChange={() => set("proctoringType", "manual")}
            />{" "}
            Manual
          </label>
          <p className="field-hint">
            A proctor watches the candidates. The camera and microphone checks
            raise no flags; tab, window and screen sharing flags still do.
          </p>
        </fieldset>
        <Toggle
          label="Proctoring by AI"
          help="On: the exam page checks the camera and microphone for faces, phones, looking away and talking. Off: none of those flags are raised, whatever the proctoring type."
          checked={draft.aiEnabled}
          onChange={(v) => set("aiEnabled", v)}
        />
        <fieldset className="bare-fieldset" disabled={!draft.recordVideo}>
          <legend>Evidence kept with a flag</legend>
          <label className="check-label">
            <input
              type="radio"
              name="ufm-evidence"
              checked={draft.ufmEvidence === "image"}
              onChange={() => set("ufmEvidence", "image")}
            />{" "}
            Image
          </label>
          <label className="check-label">
            <input
              type="radio"
              name="ufm-evidence"
              checked={draft.ufmEvidence === "video"}
              onChange={() => set("ufmEvidence", "video")}
            />{" "}
            Video
          </label>
          <p className="field-hint">
            Image: a camera picture with each flag (always taken). Video:
            besides the picture, the person reviewing a flag can jump to its
            moment in the exam video. Needs Record exam video below.
          </p>
        </fieldset>
        <Toggle
          label="Download session video"
          help="Allows the people who can watch the recording to save a copy. Every download is recorded in the access log. Needs Record exam video."
          checked={draft.downloadSessionVideo}
          disabled={!draft.recordVideo}
          onChange={(v) => set("downloadSessionVideo", v)}
        />
        <Toggle
          label="Download flag video"
          help="Allows saving a short video of a flag. Needs Record exam video."
          checked={draft.downloadFlagVideo}
          disabled={!draft.recordVideo}
          soon
          onChange={(v) => set("downloadFlagVideo", v)}
        />
        {problems.videoOptions ? (
          <p role="alert" className="form-error">
            {problems.videoOptions}
          </p>
        ) : null}
      </Group>

      <Group title="Flags">
        <fieldset className="bare-fieldset">
          <legend>When a flag is raised</legend>
          <label className="check-label">
            <input
              type="radio"
              name="flag-action"
              checked={draft.action === "record"}
              onChange={() => set("action", "record")}
            />{" "}
            Record only
          </label>
          <p className="field-hint">
            Nothing interrupts the candidate. Flags are saved for a person to
            review.
          </p>
          <label className="check-label">
            <input
              type="radio"
              name="flag-action"
              checked={draft.action === "pause"}
              onChange={() => set("action", "pause")}
            />{" "}
            Pause the exam
          </label>
          <p className="field-hint">
            When the counted flags reach the limit, the candidate is told to
            contact the proctor. Saved answers stay safe, and a pause never
            fails or changes a result. The aa_admin or the batch proctor unlocks
            it from the proctoring page.
          </p>
        </fieldset>
        <div className="field">
          <label htmlFor={ids.after}>
            Pause after this many flags ({PAUSE_AFTER_MIN} to {PAUSE_AFTER_MAX})
          </label>
          <input
            id={ids.after}
            type="text"
            inputMode="numeric"
            value={draft.pauseAfterFlags}
            disabled={draft.action !== "pause"}
            aria-invalid={problems.pauseAfterFlags ? true : undefined}
            aria-describedby={
              problems.pauseAfterFlags ? `${ids.after}-error` : undefined
            }
            onChange={(event) => set("pauseAfterFlags", event.target.value)}
          />
          {problems.pauseAfterFlags ? (
            <p id={`${ids.after}-error`} className="field-error">
              {problems.pauseAfterFlags}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={ids.unlock}>
            Flags allowed after an unlock ({PAUSE_AFTER_MIN} to{" "}
            {PAUSE_AFTER_MAX})
          </label>
          <input
            id={ids.unlock}
            type="text"
            inputMode="numeric"
            value={draft.pauseAfterUnlock}
            disabled={draft.action !== "pause"}
            aria-invalid={problems.pauseAfterUnlock ? true : undefined}
            aria-describedby={
              problems.pauseAfterUnlock
                ? `${ids.unlock}-error`
                : `${ids.unlock}-help`
            }
            onChange={(event) => set("pauseAfterUnlock", event.target.value)}
          />
          <p id={`${ids.unlock}-help`} className="field-hint">
            After the exam has been unlocked once, it pauses again when this
            many counted flags are raised.
          </p>
          {problems.pauseAfterUnlock ? (
            <p id={`${ids.unlock}-error`} className="field-error">
              {problems.pauseAfterUnlock}
            </p>
          ) : null}
        </div>
        <div className="settings-subgroup">
          <Toggle
            label="Give back the paused time when the exam is unlocked"
            help="On: the exam clock stops while the exam is paused, and an unlock adds the paused time to the candidate's deadline. Off: the clock keeps running during a pause. Only matters when the exam is paused after flags."
            checked={draft.extendOnUnlock}
            onChange={(v) => set("extendOnUnlock", v)}
          />
        </div>
        <fieldset className="bare-fieldset" disabled={draft.action !== "pause"}>
          <legend>Flags that count towards the limit</legend>
          <label className="check-label">
            <input
              type="radio"
              name="flag-severity"
              checked={!draft.countMedium}
              onChange={() => set("countMedium", false)}
            />{" "}
            High flags only
          </label>
          <label className="check-label">
            <input
              type="radio"
              name="flag-severity"
              checked={draft.countMedium}
              onChange={() => set("countMedium", true)}
            />{" "}
            Medium and high flags
          </label>
          <p className="field-hint">
            Low flags are never counted. After an unlock the count starts again
            from zero.
          </p>
        </fieldset>
      </Group>

      <Group title="Camera images">
        <Toggle
          label="Take pictures during the exam"
          help="Off: no camera picture is saved while the exam runs. Pictures with flags and at the start and the end have their own settings."
          checked={draft.imageEnabled}
          onChange={(v) => set("imageEnabled", v)}
        />
        <div className="field">
          <label htmlFor={ids.interval}>
            Take a camera image every (seconds, {INTERVAL_MIN_SECONDS} to{" "}
            {INTERVAL_MAX_SECONDS})
          </label>
          <input
            id={ids.interval}
            type="text"
            inputMode="numeric"
            value={draft.intervalSeconds}
            aria-invalid={problems.intervalSeconds ? true : undefined}
            aria-describedby={
              problems.intervalSeconds
                ? `${ids.interval}-error`
                : `${ids.interval}-help`
            }
            onChange={(event) => set("intervalSeconds", event.target.value)}
          />
          <p id={`${ids.interval}-help`} className="field-hint">
            How often the exam page saves a picture for the proctor.
          </p>
          {problems.intervalSeconds ? (
            <p id={`${ids.interval}-error`} className="field-error">
              {problems.intervalSeconds}
            </p>
          ) : null}
        </div>
        <Toggle
          label="Also take images at the start and the end"
          help="Sent to the exam page with the other camera settings."
          checked={draft.atStartAndEnd}
          onChange={(v) => set("atStartAndEnd", v)}
        />
      </Group>

      {hidePaperGroup ? null : (
        <Group title="Question paper">
          <Toggle
            label="Mock test: use a paper without the reviewer's approval"
            help="Off (normal): only a paper approved by the awarding body reviewer can be set on the batch. On: any complete paper of the qualification and language can be used, for example a draft built for a mock test."
            checked={draft.skipPaperApproval}
            onChange={(v) => set("skipPaperApproval", v)}
          />
        </Group>
      )}

      <Group title="Behaviour checks">
        <Toggle
          label="Check for looking away"
          help="Raises a medium flag when the candidate's head stays turned to the side for 2 seconds. The flag is saved for a person to review."
          checked={draft.detectLookingAway}
          onChange={(v) => set("detectLookingAway", v)}
        />
        <Toggle
          label="Check for talking"
          help="Raises a medium flag when the microphone hears talking for 2 seconds. Only the loudness is measured: nothing is recorded or sent. When this is off, the microphone is not asked for."
          checked={draft.detectVoice}
          onChange={(v) => set("detectVoice", v)}
        />
        <Toggle
          label="Require screen sharing"
          help="The candidate must share the whole screen before the exam starts. A high flag is recorded if sharing stops. On its own, nothing from the screen is recorded or sent."
          checked={draft.requireScreenShare}
          onChange={(v) => {
            set("requireScreenShare", v);
            if (!v && draft.recordVideo) {
              set("recordVideo", false);
              set("ufmEvidence", "image");
              set("downloadSessionVideo", false);
              set("downloadFlagVideo", false);
            }
          }}
        />
        <Toggle
          label="Record exam video"
          help="Records the candidate's camera and shared screen for the whole exam and keeps them on the server for 90 days, then deletes them. Needs screen sharing, which is turned on with it."
          checked={draft.recordVideo}
          onChange={(v) => {
            set("recordVideo", v);
            if (v) set("requireScreenShare", true);
            else {
              set("ufmEvidence", "image");
              set("downloadSessionVideo", false);
              set("downloadFlagVideo", false);
            }
          }}
        />
        {problems.recordVideo ? (
          <p role="alert" className="form-error">
            {problems.recordVideo}
          </p>
        ) : null}
        {draft.recordVideo ? (
          <>
            <div className="field">
              <label htmlFor={`${ids.after}-videofail`}>
                If the video cannot be recorded
              </label>
              <select
                id={`${ids.after}-videofail`}
                value={draft.videoFailureAction}
                onChange={(event) =>
                  set(
                    "videoFailureAction",
                    event.target.value === "require" ? "require" : "continue",
                  )
                }
              >
                <option value="continue">
                  Let the exam continue and raise a flag
                </option>
                <option value="require">
                  Do not let the candidate start until recording works
                </option>
              </select>
            </div>
            <fieldset className="bare-fieldset">
              <legend>Who can watch the recording</legend>
              <p className="field-hint">
                The AA admin always can. Others only for batches they belong to,
                and every look is recorded in the access log.
              </p>
              {LOCATION_ROLES.map((role) => (
                <label key={role} className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.videoVisibleTo.includes(role)}
                    onChange={(event) =>
                      set(
                        "videoVisibleTo",
                        event.target.checked
                          ? [...draft.videoVisibleTo, role]
                          : draft.videoVisibleTo.filter((r) => r !== role),
                      )
                    }
                  />{" "}
                  {LOCATION_ROLE_LABELS[role]}
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
      </Group>

      <Group title="Candidate pop-up">
        <Toggle
          label="Ask the candidate for their details before the exam"
          help="Shown after the candidate agrees to the camera check and before the exam starts. Answers are kept encrypted and only the AA admin and the training partner of this batch can read them."
          checked={draft.popupEnabled}
          onChange={(v) => set("popupEnabled", v)}
        />
        <fieldset
          className="bare-fieldset"
          disabled={!popupOn}
          aria-describedby={
            problems.popupFields ? `${ids.fields}-error` : `${ids.fields}-help`
          }
        >
          <legend>Details to ask for</legend>
          {INFO_FIELDS.map((field) => (
            <label key={field} className="check-label">
              <input
                type="checkbox"
                checked={draft.popupFields.includes(field)}
                onChange={(event) =>
                  set(
                    "popupFields",
                    event.target.checked
                      ? [...draft.popupFields, field]
                      : draft.popupFields.filter((f) => f !== field),
                  )
                }
              />{" "}
              {INFO_FIELD_LABELS[field]}
            </label>
          ))}
          <p id={`${ids.fields}-help`} className="field-hint">
            National ID numbers (Aadhaar, PAN, voter id, passport) are never
            asked for.
          </p>
          {problems.popupFields ? (
            <p id={`${ids.fields}-error`} className="field-error">
              {problems.popupFields}
            </p>
          ) : null}
        </fieldset>
      </Group>

      <Group title="Location">
        <Toggle
          label="Capture the candidate's location"
          help="Switches the setting on or off for this batch. Nothing is tracked by this switch alone."
          checked={draft.captureLocation}
          onChange={(v) => set("captureLocation", v)}
        />
        <fieldset className="bare-fieldset">
          <legend>Who can see the location of a flag photo</legend>
          <p className="field-hint">
            The AA admin always can. Others see it only for batches they belong
            to, and every look is recorded in the access log.
          </p>
          {LOCATION_ROLES.map((role) => (
            <label key={role} className="check-label">
              <input
                type="checkbox"
                checked={draft.locationVisibleTo.includes(role)}
                onChange={(event) =>
                  set(
                    "locationVisibleTo",
                    event.target.checked
                      ? [...draft.locationVisibleTo, role]
                      : draft.locationVisibleTo.filter((r) => r !== role),
                  )
                }
              />{" "}
              {LOCATION_ROLE_LABELS[role]}
            </label>
          ))}
        </fieldset>
      </Group>

      <Group title="Pass rule and marking">
        <fieldset className="bare-fieldset">
          <legend>Passing criteria</legend>
          {(
            [
              [
                "qualification",
                "As set on the qualification",
                "The pass marks of the qualification decide.",
              ],
              [
                "nos_wise",
                "NOS wise",
                "Every NOS must reach the percentage below, in theory, practical and viva.",
              ],
              [
                "overall",
                "Overall",
                "The marks of all NOS added together must reach the percentage below.",
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <div key={value}>
              <label className="check-label">
                <input
                  type="radio"
                  name="pass-criteria"
                  checked={draft.passCriteria === value}
                  onChange={() => set("passCriteria", value)}
                />{" "}
                {label}
              </label>
              <p className="field-hint">{hint}</p>
            </div>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor={ids.pass}>
            Passing percentage ({PASS_PERCENTAGE_MIN} to {PASS_PERCENTAGE_MAX})
          </label>
          <input
            id={ids.pass}
            type="text"
            inputMode="numeric"
            value={draft.passPercentage}
            disabled={draft.passCriteria === "qualification"}
            aria-invalid={problems.passPercentage ? true : undefined}
            aria-describedby={
              problems.passPercentage ? `${ids.pass}-error` : `${ids.pass}-help`
            }
            onChange={(event) => set("passPercentage", event.target.value)}
          />
          <p id={`${ids.pass}-help`} className="field-hint">
            One percentage for theory, practical and viva. It cannot be changed
            after marks have been saved for the batch.
          </p>
          {problems.passPercentage ? (
            <p id={`${ids.pass}-error`} className="field-error">
              {problems.passPercentage}
            </p>
          ) : null}
        </div>
        {(
          [
            ["practicalMarking", "Practical marking", draft.practicalMarking],
            ["vivaMarking", "Viva marking", draft.vivaMarking],
          ] as const
        ).map(([key, label, value]) => (
          <fieldset key={key} className="bare-fieldset">
            <legend>{label}</legend>
            <label className="check-label">
              <input
                type="radio"
                name={key}
                checked={value === "marks"}
                onChange={() => set(key, "marks")}
              />{" "}
              Type the marks
            </label>
            <label className="check-label">
              <input
                type="radio"
                name={key}
                checked={value === "rubric"}
                onChange={() => set(key, "rubric")}
              />{" "}
              Three levels: Good (100%), Satisfactory (70%), Poor (10%)
            </label>
          </fieldset>
        ))}
        <p className="field-hint">
          With three levels, the assessor picks a level for each NOS and the
          marks are that share of the maximum.
        </p>
      </Group>

      <Group title="Practical and viva">
        <Toggle
          label="Allow practical test video"
          help="Video files from the assessor are accepted for this batch. They are refused when both the practical and the viva video are off."
          checked={draft.allowPracticalVideo}
          onChange={(v) => set("allowPracticalVideo", v)}
        />
        <Toggle
          label="Allow viva test video"
          help="Video files from the assessor are accepted for this batch. They are refused when both the practical and the viva video are off."
          checked={draft.allowVivaVideo}
          onChange={(v) => set("allowVivaVideo", v)}
        />
      </Group>

      <Group title="Assessor">
        <Toggle
          label="Allow assessor geolocation"
          help="On: the assessor's location is kept with the files they upload. Off: the location is dropped when a file is saved."
          checked={draft.assessorGeolocation}
          onChange={(v) => set("assessorGeolocation", v)}
        />
        <Toggle
          label="Allow assessor Annexure M"
          help="The assessor fills in Annexure M for this batch."
          checked={draft.assessorAnnexureM}
          soon
          onChange={(v) => set("assessorAnnexureM", v)}
        />
        <Toggle
          label="Allow assessor feedback"
          help="The assessor gives feedback on the assessment."
          checked={draft.assessorFeedback}
          soon
          onChange={(v) => set("assessorFeedback", v)}
        />
        <Toggle
          label="Check the assessor's identity card"
          help="Turns on the Aadhaar card check for the assessor. Only the result is kept; the card number is never entered or stored."
          checked={draft.assessorIdCardCheck}
          soon
          onChange={(v) => set("assessorIdCardCheck", v)}
        />
        <Toggle
          label="Check the name on the assessor's identity card"
          help="Turns on the name check against the Aadhaar card. Only the result is kept; the card number is never entered or stored."
          checked={draft.assessorIdNameCheck}
          soon
          onChange={(v) => set("assessorIdNameCheck", v)}
        />
      </Group>

      <Group title="Student">
        <Toggle
          label="Allow student attendance"
          help="Off: the assessor's attendance upload is refused for this batch. Candidates are then marked absent by hand in the marks grid."
          checked={draft.studentAttendance}
          onChange={(v) => set("studentAttendance", v)}
        />
        <Toggle
          label="Allow student feedback"
          help="Off: learner feedback cannot be recorded for this batch."
          checked={draft.studentFeedback}
          onChange={(v) => set("studentFeedback", v)}
        />
      </Group>

      <Group title="More than one language">
        <Toggle
          label="Design the theory test in more than one language"
          help="The theory paper can be built in several languages for this batch."
          checked={draft.langTheory}
          soon
          onChange={(v) => set("langTheory", v)}
        />
        <Toggle
          label="Design the practical test in more than one language"
          help="The practical test can be built in several languages for this batch."
          checked={draft.langPractical}
          soon
          onChange={(v) => set("langPractical", v)}
        />
        <Toggle
          label="Design the viva test in more than one language"
          help="The viva can be built in several languages for this batch."
          checked={draft.langViva}
          soon
          onChange={(v) => set("langViva", v)}
        />
      </Group>

      <Group title="On-the-job training">
        <Toggle
          label="Allow upload of OJT pictures"
          help="On: pictures of on-the-job training can be uploaded to this batch. Off: they are refused."
          checked={draft.allowOjtImages}
          onChange={(v) => set("allowOjtImages", v)}
        />
      </Group>
    </>
  );
}
