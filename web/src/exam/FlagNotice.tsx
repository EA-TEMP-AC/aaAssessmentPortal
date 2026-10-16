import { useEffect, useRef } from "react";
import { FLAG_NOTICE_TEXT } from "./flagNotices";
import type { ProctorFlagType } from "./proctorBridge";

/**
 * Centred card shown when a flag is raised. It does not block: the timer keeps running and
 * answers stay editable behind it. Focus moves to OK and goes back when it closes.
 */
export function FlagNotice({ type, onDismiss }: { type: ProctorFlagType; onDismiss: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);

  useEffect(() => {
    before.current = document.activeElement;
    button.current?.focus();
    return () => {
      const el = before.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, [type]);

  return (
    <div className="flag-notice" role="alertdialog" aria-modal="false" aria-labelledby="flag-notice-text">
      <p id="flag-notice-text">{FLAG_NOTICE_TEXT[type]}</p>
      <button type="button" ref={button} onClick={onDismiss}>
        OK
      </button>
    </div>
  );
}
