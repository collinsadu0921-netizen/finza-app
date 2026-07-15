/** Timeline month row used to build quarterly chart points. */
export type TrendsTimelineMonth = {
  period_start: string
  period_end: string
  revenue: number
  expenses: number
  netProfit: number
}

export type QuarterlyChartPoint = {
  /** Stable id, e.g. "2026-Q3". */
  key: string
  label: string
  year: number
  quarter: number
  revenue: number
  expenses: number
  netProfit: number
  /** Full calendar quarter bounds for expense-breakdown queries. */
  calendarStart: string
  calendarEnd: string
  /** Latest month period_end present in timeline for this quarter. */
  dataThroughEnd: string
  isQuarterToDate: boolean
}

const QUARTER_START_MONTHS = [1, 4, 7, 10] as const

/** Calendar year + quarter (1–4) from a period ISO start date. */
export function quarterOfPeriodStart(periodStart: string): { year: number; quarter: number } {
  const year = Number(periodStart.slice(0, 4))
  const month = Number(periodStart.slice(5, 7))
  return { year, quarter: Math.floor((month - 1) / 3) + 1 }
}

/** Inclusive calendar quarter bounds (month is 1–4). */
export function calendarQuarterBounds(
  year: number,
  quarter: number
): { start: string; end: string } {
  const startMonth = QUARTER_START_MONTHS[quarter - 1]
  const endMonth = startMonth + 2
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`
  const lastDay = new Date(year, endMonth, 0).getDate()
  const end = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  return { start, end }
}

const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** Display label for a calendar quarter span, e.g. "Jul–Sep 2026". */
export function quarterMonthRangeLabel(year: number, quarter: number): string {
  const startMonth = QUARTER_START_MONTHS[quarter - 1]
  const endMonth = startMonth + 2
  return `${MONTH_NAMES_SHORT[startMonth - 1]}–${MONTH_NAMES_SHORT[endMonth - 1]} ${year}`
}

/** Today as YYYY-MM-DD in local time. */
export function localTodayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** Short display date, e.g. "15 Jul 2026". */
export function formatShortDisplayDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00")
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/**
 * Aggregates timeline months into calendar quarters. Sums only existing months;
 * does not invent missing months. Marks incomplete current quarters as QTD.
 */
export function buildQuarterlyChartPoints(
  months: TrendsTimelineMonth[],
  todayIso: string = localTodayIso()
): QuarterlyChartPoint[] {
  const buckets = new Map<
    string,
    {
      year: number
      quarter: number
      revenue: number
      expenses: number
      netProfit: number
      months: TrendsTimelineMonth[]
    }
  >()

  for (const month of months) {
    const { year, quarter } = quarterOfPeriodStart(month.period_start)
    const key = `${year}-Q${quarter}`
    const existing = buckets.get(key)
    if (existing) {
      existing.revenue += month.revenue
      existing.expenses += month.expenses
      existing.netProfit += month.netProfit
      existing.months.push(month)
    } else {
      buckets.set(key, {
        year,
        quarter,
        revenue: month.revenue,
        expenses: month.expenses,
        netProfit: month.netProfit,
        months: [month],
      })
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bucket]) => {
      const sortedMonths = [...bucket.months].sort((a, b) =>
        a.period_start.localeCompare(b.period_start)
      )
      const { start: calendarStart, end: calendarEnd } = calendarQuarterBounds(
        bucket.year,
        bucket.quarter
      )
      const dataThroughEnd = sortedMonths[sortedMonths.length - 1]?.period_end ?? calendarStart
      const inCurrentQuarter = todayIso >= calendarStart && todayIso <= calendarEnd
      const isQuarterToDate = inCurrentQuarter && dataThroughEnd < calendarEnd

      return {
        key,
        label: `Q${bucket.quarter}`,
        year: bucket.year,
        quarter: bucket.quarter,
        revenue: bucket.revenue,
        expenses: bucket.expenses,
        netProfit: bucket.netProfit,
        calendarStart,
        calendarEnd,
        dataThroughEnd,
        isQuarterToDate,
      }
    })
}

export function resolveSelectedQuarterKey(
  quarterlyPoints: QuarterlyChartPoint[],
  selectedQuarterKey: string | null
): string | null {
  if (quarterlyPoints.length === 0) return null
  if (selectedQuarterKey && quarterlyPoints.some((q) => q.key === selectedQuarterKey)) {
    return selectedQuarterKey
  }
  return quarterlyPoints[quarterlyPoints.length - 1]?.key ?? null
}
