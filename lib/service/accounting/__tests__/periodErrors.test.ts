import { mapAccountingPeriodError } from "../periodErrors"

describe("mapAccountingPeriodError", () => {
  it("maps a missing monthly period to PERIOD_NOT_FOUND, not PERIOD_LOCKED", () => {
    const result = mapAccountingPeriodError(
      "No accounting period found for date 2026-11-05. Ensure the period exists."
    )

    expect(result).toEqual({
      status: 400,
      code: "PERIOD_NOT_FOUND",
      error:
        "No accounting period exists for this date. Create the accounting period or choose a date within an open period.",
    })
  })

  it("maps a locked period to PERIOD_LOCKED", () => {
    expect(
      mapAccountingPeriodError("Cannot post to a locked period. Choose another date.")
    ).toMatchObject({ status: 400, code: "PERIOD_LOCKED" })

    expect(
      mapAccountingPeriodError(
        "Accounting period is locked (period_start: 2026-10-01). Posting is blocked."
      )
    ).toMatchObject({ status: 400, code: "PERIOD_LOCKED" })
  })

  it("does not classify unrelated errors that merely mention a period", () => {
    expect(mapAccountingPeriodError("Loan period is invalid")).toBeNull()
    expect(mapAccountingPeriodError("Failed to post to ledger")).toBeNull()
    expect(mapAccountingPeriodError("")).toBeNull()
  })
})
