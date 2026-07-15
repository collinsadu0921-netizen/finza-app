import { formatAccountingPeriodLabel } from "../formatAccountingPeriodLabel"

describe("formatAccountingPeriodLabel", () => {
  it("formats a single month with a four-digit year", () => {
    expect(formatAccountingPeriodLabel("2026-07-01", "2026-07-31")).toBe("Jul 2026")
  })

  it("formats January 2026 with a four-digit year", () => {
    expect(formatAccountingPeriodLabel("2026-01-01", "2026-01-31")).toBe("Jan 2026")
  })

  it("formats a future test period with a four-digit year (not Jan 99)", () => {
    expect(formatAccountingPeriodLabel("2099-01-01", "2099-01-31")).toBe("Jan 2099")
  })

  it("formats a multi-month range with four-digit years", () => {
    expect(formatAccountingPeriodLabel("2026-01-01", "2026-03-31")).toBe(
      "Jan 2026 – Mar 2026"
    )
  })
})
