import { getDateInTimezone } from "@/lib/accounting/businessDate"
import {
  isPeriodOnOrBefore,
  normalizePeriodStart,
  periodStartYearMonth,
  samePeriodStart,
} from "@/lib/accounting/periodDate"

describe("periodDate", () => {
  it("normalizes DATE and ISO period_start values to YYYY-MM-DD", () => {
    expect(normalizePeriodStart("2026-08-01")).toBe("2026-08-01")
    expect(normalizePeriodStart("2026-08-01T00:00:00.000Z")).toBe("2026-08-01")
    expect(normalizePeriodStart(" 2026-10-01 ")).toBe("2026-10-01")
    expect(normalizePeriodStart(null)).toBe("")
  })

  it("compares period starts on the date prefix only", () => {
    expect(samePeriodStart("2026-08-01T12:00:00.000Z", "2026-08-01")).toBe(true)
    expect(isPeriodOnOrBefore("2026-08-01", "2026-08-31")).toBe(true)
    expect(isPeriodOnOrBefore("2026-10-01", "2026-08-31")).toBe(false)
    expect(periodStartYearMonth("2026-10-01")).toBe("2026-10")
  })
})

describe("getDateInTimezone month-end boundary", () => {
  const lateAugustUtc = new Date("2026-08-31T23:30:00.000Z")

  it("uses the business timezone, not the host offset", () => {
    expect(getDateInTimezone(lateAugustUtc, "Africa/Accra")).toBe("2026-08-31")
    expect(getDateInTimezone(lateAugustUtc, "Africa/Johannesburg")).toBe("2026-09-01")
    expect(getDateInTimezone(lateAugustUtc, "UTC")).toBe("2026-08-31")
  })
})
