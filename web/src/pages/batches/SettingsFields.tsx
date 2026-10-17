import { useId, type ReactNode } from "react";
import {
  INFO_FIELD_LABELS,
  INFO_FIELDS,
  INTERVAL_MAX_SECONDS,
  INTERVAL_MIN_SECONDS,
  LOCATION_ROLE_LABELS,
  LOCATION_ROLES,
  PAUSE_AFTER_MAX,
  PAUSE_AFTER_MIN,
} from "../../api/batchSettings";
import type { Draft, Problems } from "./settingsDraft";

/**
 * The exam switches, shared by the batch settings page and step 3 of creating a batch (X-19).
 * The caller owns the draft; this only draws the fields.
 */

function Toggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field">
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
      <p id={`${id}-help`} className="field-hint">
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
  const ids = { after: useId(), interval: useId(), fields: useId() };
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
          <p className="field-hint">Nothing interrupts the candidate. Flags are saved for a person to review.</p>
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
            When the counted flags reach the limit, the candidate is told to contact the proctor. Saved answers stay safe,
            and a pause never fails or changes a result. The aa_admin or the batch proctor
            unlocks it from the proctoring page.
          </p>
        </fieldset>
        <div className="field">
          <label htmlFor={ids.after}>Pause after this many flags ({PAUSE_AFTER_MIN} to {PAUSE_AFTER_MAX})</label>
          <input
            id={ids.after}
            type="text"
            inputMode="numeric"
            value={draft.pauseAfterFlags}
            disabled={draft.action !== "pause"}
            aria-invalid={problems.pauseAfterFlags ? true : undefined}
            aria-describedby={problems.pauseAfterFlags ? `${ids.after}-error` : undefined}
            onChange={(event) => set("pauseAfterFlags", event.target.value)}
          />
          {problems.pauseAfterFlags ? (
            <p id={`${ids.after}-error`} className="field-error">
              {problems.pauseAfterFlags}
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
          <p className="field-hint">Low flags are never counted. After an unlock the count starts again from zero.</p>
        </fieldset>
      </Group>

      <Group title="Camera images">
        <div className="field">
          <label htmlFor={ids.interval}>
            Take a camera image every (seconds, {INTERVAL_MIN_SECONDS} to {INTERVAL_MAX_SECONDS})
          </label>
          <input
            id={ids.interval}
            type="text"
            inputMode="numeric"
            value={draft.intervalSeconds}
            aria-invalid={problems.intervalSeconds ? true : undefined}
            aria-describedby={problems.intervalSeconds ? `${ids.interval}-error` : `${ids.interval}-help`}
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
          help="The candidate must share the whole screen before the exam starts. A high flag is recorded if sharing stops. The screen is not recorded and no picture of it is sent."
          checked={draft.requireScreenShare}
          onChange={(v) => set("requireScreenShare", v)}
        />
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
          aria-describedby={problems.popupFields ? `${ids.fields}-error` : `${ids.fields}-help`}
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
            National ID numbers (Aadhaar, PAN, voter id, passport) are never asked for.
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
            The AA admin always can. Others see it only for batches they belong to, and every look is recorded in the
            access log.
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
    </>
  );
}
