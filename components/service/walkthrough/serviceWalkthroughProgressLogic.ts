type ProgressRow = { tour_key: string; tour_version: number; status: string }
type ProgressStatus = "completed" | "skipped"

export function shouldSuppressTourFromProgress(
  row: ProgressRow | undefined,
  tourVersion: number
): boolean {
  if (!row) return false
  if (row.tour_version < tourVersion) return false
  return row.status === "completed" || row.status === "skipped"
}

export function withSavedTourProgress(
  prev: Map<string, ProgressRow>,
  row: { tour_key: string; tour_version: number; status: ProgressStatus }
): Map<string, ProgressRow> {
  const next = new Map(prev)
  next.set(row.tour_key, row)
  return next
}
