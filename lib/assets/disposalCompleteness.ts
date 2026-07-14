/**
 * Client-side depreciation completeness check before disposal.
 */

export function requiredDepreciationMonths(
  purchaseDate: string,
  disposalDate: string
): string[] {
  const months: string[] = []
  const start = new Date(purchaseDate)
  const end = new Date(disposalDate)
  let y = start.getFullYear()
  let m = start.getMonth()
  const endY = end.getFullYear()
  const endM = end.getMonth()

  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m + 1).padStart(2, "0")}-01`)
    m++
    if (m > 11) {
      m = 0
      y++
    }
  }
  return months
}

export function missingDepreciationMonths(
  purchaseDate: string,
  disposalDate: string,
  postedEntries: Array<{ date: string; status?: string }>
): string[] {
  const postedDates = new Set(
    postedEntries
      .filter((e) => e.status === "posted" || e.status === "adjusted" || !e.status)
      .map((e) => e.date.slice(0, 10))
  )
  return requiredDepreciationMonths(purchaseDate, disposalDate).filter((d) => !postedDates.has(d))
}
