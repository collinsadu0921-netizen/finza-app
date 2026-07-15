import {
  getCalendarMonthBounds,
  getLastCalendarMonthRange,
  getThisCalendarMonthRange,
} from "@/lib/accounting/calendarDateRange"

describe("calendarDateRange", () => {
  it("returns full calendar month bounds", () => {
    expect(getCalendarMonthBounds(2026, 7)).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    })
    expect(getCalendarMonthBounds(2026, 2)).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    })
  })

  it("uses business timezone for this month (UTC)", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-15T12:00:00Z"))
    expect(getThisCalendarMonthRange("UTC")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    })
    jest.useRealTimers()
  })

  it("uses business timezone for last month (UTC)", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-15T12:00:00Z"))
    expect(getLastCalendarMonthRange("UTC")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    })
    jest.useRealTimers()
  })
})
