/** Edad del snapshot para copy de UI (relativo, locale-aware). */
export function formatDashboardSnapshotAge(
  ageMs: number,
  locale: string
): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "";
  }
  const secTotal = Math.floor(ageMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (secTotal < 60) {
    return rtf.format(-Math.max(1, secTotal), "second");
  }
  const min = Math.floor(secTotal / 60);
  if (min < 60) {
    return rtf.format(-min, "minute");
  }
  const hours = Math.floor(min / 60);
  if (hours < 48) {
    return rtf.format(-hours, "hour");
  }
  const days = Math.floor(hours / 24);
  return rtf.format(-days, "day");
}
