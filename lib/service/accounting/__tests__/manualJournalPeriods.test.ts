import { describe, it, expect } from "@jest/globals"
import {
  formatManualJournalPeriod,
  periodForManualJournalDate,
  sortManualJournalPeriods,
} from "@/lib/service/accounting/manualJournalPeriods"

const periods = [
  { id: "later", period_start: "2026-11-01", period_end: "2026-11-30", status: "open" },
  { id: "oct", period_start: "2026-10-01", period_end: "2026-10-31", status: "open" },
  { id: "sep", period_start: "2026-09-01", period_end: "2026-09-30", status: "open" },
]

describe("manual journal period display", () => {
  it("sorts periods by start date ascending", () => {
    expect(sortManualJournalPeriods(periods).map((period) => period.id)).toEqual([
      "sep",
      "oct",
      "later",
    ])
  })

  it("matches a date inside an open period, including boundaries", () => {
    expect(periodForManualJournalDate(periods, "2026-10-01")?.id).toBe("oct")
    expect(periodForManualJournalDate(periods, "2026-10-31")?.id).toBe("oct")
    expect(periodForManualJournalDate(periods, "2026-10-15")?.id).toBe("oct")
  })

  it("returns null when the date is outside every open period", () => {
    expect(periodForManualJournalDate(periods, "2026-10-32")).toBeNull()
    expect(periodForManualJournalDate(periods, "2026-12-01")).toBeNull()
    expect(periodForManualJournalDate(periods, "")).toBeNull()
  })

  it("formats a period consistently", () => {
    expect(
      formatManualJournalPeriod({
        id: "oct",
        period_start: "2026-10-01",
        period_end: "2026-10-31",
        status: "open",
      })
    ).toBe("Oct 2026 · 2026-10-01 to 2026-10-31")
  })
})
