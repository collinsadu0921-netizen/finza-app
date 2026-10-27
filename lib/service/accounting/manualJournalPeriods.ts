export type ManualJournalPeriod = {
  id: string
  period_start: string
  period_end: string
  status: string
}

function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number)
  if (!year || !month) return date
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function formatManualJournalPeriod(period: ManualJournalPeriod): string {
  return `${monthLabel(period.period_start)} · ${period.period_start} to ${period.period_end}`
}

export function sortManualJournalPeriods(
  periods: ManualJournalPeriod[]
): ManualJournalPeriod[] {
  return [...periods].sort((a, b) => {
    if (a.period_start !== b.period_start) {
      return a.period_start.localeCompare(b.period_start)
    }
    return a.period_end.localeCompare(b.period_end)
  })
}

export function periodForManualJournalDate(
  periods: ManualJournalPeriod[],
  entryDate: string
): ManualJournalPeriod | null {
  if (!entryDate) return null
  return (
    periods.find(
      (period) => period.period_start <= entryDate && entryDate <= period.period_end
    ) ?? null
  )
}
