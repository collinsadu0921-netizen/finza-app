/**
 * Display label for an accounting period on the Service dashboard selector/charts.
 * Always uses a four-digit year (e.g. "Jul 2026", never "Jul 26").
 */
export function formatAccountingPeriodLabel(start: string, end: string): string {
  const sYM = start.slice(0, 7)
  const eYM = end.slice(0, 7)
  const s = new Date(start + "T12:00:00")
  const e = new Date(end + "T12:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" }
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return sYM === eYM ? start : `${start} – ${end}`
  }
  // en-US keeps month abbreviations stable in CI (e.g. "Jul 2026").
  if (sYM === eYM) {
    return s.toLocaleDateString("en-US", opts)
  }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`
}
