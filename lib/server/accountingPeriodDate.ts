/** Normalize accounting period bounds to YYYY-MM-DD for keys, RPC args, and comparisons. */
export function toAccountingDateOnly(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(s)
  if (m) {
    const hours = Number(m[2])
    // DATE values rendered as local midnight behind UTC often arrive as 21:00–23:00Z previous day.
    if (hours >= 20) {
      const dt = new Date(`${m[1]}T00:00:00.000Z`)
      dt.setUTCDate(dt.getUTCDate() + 1)
      return dt.toISOString().slice(0, 10)
    }
    return m[1]
  }
  const parsed = new Date(s)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}
