import { toAccountingDateOnly } from "../accountingPeriodDate"

describe("toAccountingDateOnly", () => {
  it("passes through YYYY-MM-DD", () => {
    expect(toAccountingDateOnly("2026-07-01")).toBe("2026-07-01")
  })

  it("maps UTC-behind local DATE ISO to the calendar date", () => {
    expect(toAccountingDateOnly("2026-06-30T22:00:00.000Z")).toBe("2026-07-01")
    expect(toAccountingDateOnly("2026-07-30T22:00:00Z")).toBe("2026-07-31")
  })

  it("keeps midnight UTC ISO date portion", () => {
    expect(toAccountingDateOnly("2026-07-01T00:00:00.000Z")).toBe("2026-07-01")
  })

  it("returns null for empty/invalid", () => {
    expect(toAccountingDateOnly("")).toBeNull()
    expect(toAccountingDateOnly("not-a-date")).toBeNull()
  })
})
