/** X-49. Plain YYYY-MM-DD arithmetic (IST civil dates, no time of day). */
export function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
