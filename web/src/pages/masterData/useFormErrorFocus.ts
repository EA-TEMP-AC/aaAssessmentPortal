import { useEffect } from "react";

type FormError = { id: number; fields: readonly string[] } | null;

export function useFormErrorFocus(
  error: FormError,
  fields: { current: Partial<Record<string, HTMLElement | null>> },
  order: readonly string[],
) {
  useEffect(() => {
    if (!error || error.fields.length === 0) return;
    const first = order.find((key) => error.fields.includes(key));
    if (first) fields.current[first]?.focus();
  }, [error, fields, order]);
}
