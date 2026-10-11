import { useEffect, useId, useRef, type ReactNode } from "react";

function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.hasAttribute("disabled"));
}

export function Dialog({
  title,
  busy = false,
  wide = false,
  initialFocus = "first",
  onCancel,
  children,
}: {
  title: string;
  busy?: boolean;
  wide?: boolean;
  initialFocus?: "first" | "cancel";
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    if (initialFocus === "cancel") {
      root.querySelector<HTMLElement>("[data-dialog-cancel]")?.focus();
      return;
    }
    const first = focusableElements(root)[0];
    (first ?? titleRef.current)?.focus();
  }, [initialFocus]);

  useEffect(() => {
    if (busy) titleRef.current?.focus();
  }, [busy]);

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        className={wide ? "dialog-panel dialog-panel-wide" : "dialog-panel"}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!busy) onCancel();
            return;
          }
          if (event.key !== "Tab" || !dialogRef.current) return;
          const items = focusableElements(dialogRef.current);
          if (items.length === 0) {
            event.preventDefault();
            return;
          }
          const first = items[0];
          const last = items[items.length - 1];
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (event.shiftKey) {
            if (index <= 0) {
              event.preventDefault();
              last?.focus();
            }
          } else if (index === -1 || index === items.length - 1) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function FormAlert({ error, id }: { error: { id: number; message: string; fields: readonly string[] } | null; id: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!error || error.fields.length > 0) return;
    ref.current?.focus();
  }, [error]);

  if (!error) return null;
  return (
    <p id={id} ref={ref} tabIndex={-1} className="form-error" role="alert">
      {error.message}
    </p>
  );
}
