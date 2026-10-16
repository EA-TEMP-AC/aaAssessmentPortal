import {
  GENDER_CHOICES,
  INFO_FIELD_LABELS,
  type InfoField,
} from "../api/batchSettings";

/** Today in India (IST), as year-month-day. */
export function today(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Checks one field the way the server does. The server checks again. */
export function checkField(field: InfoField, raw: string): string | null {
  const value = raw.trim();
  if (value === "")
    return `Enter your ${INFO_FIELD_LABELS[field].toLowerCase()}.`;
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return "Enter a valid email address.";
  if (field === "fatherName" && value.length > 200)
    return "Use 200 characters or fewer.";
  if (
    field === "gender" &&
    !(GENDER_CHOICES as readonly string[]).includes(value)
  )
    return "Choose one of the options.";
  if (field === "dateOfBirth") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ) {
      return "Enter a date of birth as year-month-day.";
    }
    if (value > today()) return "The date of birth cannot be in the future.";
  }
  return null;
}
