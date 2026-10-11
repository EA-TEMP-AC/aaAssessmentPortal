import type { BatchRecord } from "../../api/batches";
import { describeAllSla, describeSlaStep, type SlaTone } from "./sla";

function SlaFlag({
  tone,
  icon,
  label,
  text,
  announced,
}: {
  tone: SlaTone;
  icon: string;
  label: string;
  text: string;
  announced: string;
}) {
  return (
    <span className={`sla-flag sla-${tone}`}>
      <span className="visually-hidden">{announced}</span>
      <span aria-hidden="true">
        <span className="sla-icon">{icon}</span> {label}: {text}
      </span>
    </span>
  );
}

export function SlaColumn({ batch, now }: { batch: BatchRecord; now: number }) {
  const steps = describeAllSla(batch, now);
  return (
    <ul className="sla-column">
      {steps.map((step) => (
        <li key={step.key}>
          <SlaFlag
            tone={step.tone}
            icon={step.icon}
            label={step.label}
            text={step.countdown}
            announced={`${step.label} SLA: ${step.toneLabel}. ${step.countdown}.`}
          />
        </li>
      ))}
    </ul>
  );
}

export function SlaTimeline({ batch, now }: { batch: BatchRecord; now: number }) {
  const steps = describeAllSla(batch, now);
  return (
    <ol className="sla-timeline">
      {steps.map((step) => (
        <li key={step.key} className={`sla-timeline-item sla-${step.tone}`}>
          <SlaFlag
            tone={step.tone}
            icon={step.icon}
            label={step.label}
            text={step.countdown}
            announced={`${step.label} SLA: ${step.toneLabel}. ${step.countdown}.`}
          />
          {step.breached ? <p className="sla-breach">Stored breach flag: {step.label}.</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function PrimarySla({ batch, now }: { batch: BatchRecord; now: number }) {
  const open = describeAllSla(batch, now).find((step) => step.open);
  if (!open) return null;
  const step = describeSlaStep(batch, open.key, now);
  return (
    <p>
      <SlaFlag
        tone={step.tone}
        icon={step.icon}
        label={step.label}
        text={step.countdown}
        announced={`${step.label} SLA: ${step.toneLabel}. ${step.countdown}.`}
      />
    </p>
  );
}
