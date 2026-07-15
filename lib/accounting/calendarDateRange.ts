import { getDateInTimezone } from "./businessDate"

/** Inclusive calendar month bounds as YYYY-MM-DD (month is 1–12). */
export function getCalendarMonthBounds(
  year: number,
  month: number
): { start: string; end: string } {
  const monthStr = String(month).padStart(2, "0")
  const start = `${year}-${monthStr}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`
  return { start, end }
}

/** Full calendar month containing today in the business timezone. */
export function getThisCalendarMonthRange(timezone: string): { start: string; end: string } {
  const today = getDateInTimezone(new Date(), timezone)
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return getCalendarMonthBounds(year, month)
}

/** Full calendar month immediately before today in the business timezone. */
export function getLastCalendarMonthRange(timezone: string): { start: string; end: string } {
  const today = getDateInTimezone(new Date(), timezone)
  const anchor = new Date(`${today}T12:00:00`)
  anchor.setDate(1)
  anchor.setMonth(anchor.getMonth() - 1)
  return getCalendarMonthBounds(anchor.getFullYear(), anchor.getMonth() + 1)
}
