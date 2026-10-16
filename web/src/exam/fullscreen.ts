/** Full screen helpers for the exam. A refused request is not an error; the exam shows a notice instead. */

export function fullscreenSupported(): boolean {
  return typeof document.documentElement.requestFullscreen === "function";
}

export function requestExamFullscreen(): void {
  if (!fullscreenSupported() || document.fullscreenElement) return;
  try {
    void document.documentElement.requestFullscreen().catch(() => {});
  } catch {
    // Some browsers refuse outside a click; the notice offers a button.
  }
}

export function exitExamFullscreen(): void {
  if (!document.fullscreenElement || typeof document.exitFullscreen !== "function") return;
  try {
    void document.exitFullscreen().catch(() => {});
  } catch {
    // Nothing to undo.
  }
}
