import { describe, expect, it } from "@jest/globals"
import {
  currentYearMonth,
  isCalendarMonthPeriod,
  parseDateOnly,
  yearMonthToEnd,
  yearMonthToStart,
} from "../vatPeriod"

describe("VAT period date-only helpers", () => {
  it("builds month boundaries without timezone shifts", () => {
    expect(yearMonthToStart("2026-03")).toBe("2026-03-01")
    expect(yearMonthToEnd("2026-03")).toBe("2026-03-31")
    expect(yearMonthToEnd("2026-02")).toBe("2026-02-28")
    expect(yearMonthToEnd("2024-02")).toBe("2024-02-29")
  })

  it("rejects invalid year-month values", () => {
    expect(yearMonthToStart("2026-13")).toBeNull()
    expect(yearMonthToEnd("not-a-month")).toBeNull()
    expect(parseDateOnly("2026-02-30")).toBeNull()
  })

  it("accepts full calendar months and rejects shifted periods", () => {
    expect(isCalendarMonthPeriod("2026-03-01", "2026-03-31")).toBe(true)
    expect(isCalendarMonthPeriod("2026-02-01", "2026-02-28")).toBe(true)
    expect(isCalendarMonthPeriod("2026-02-28", "2026-03-30")).toBe(false)
    expect(isCalendarMonthPeriod("2026-03-01", "2026-03-30")).toBe(false)
    expect(isCalendarMonthPeriod("2026-03-02", "2026-03-31")).toBe(false)
  })

  it("produces a valid current year-month", () => {
    expect(currentYearMonth(new Date("2026-11-08T12:00:00Z"))).toBe("2026-11")
  })
})
