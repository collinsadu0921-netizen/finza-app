import { derivePayrollPaymentSummary } from "../payroll/payrollPaymentSummary"

describe("derivePayrollPaymentSummary", () => {
  it("returns unpaid when no payments exist", () => {
    const summary = derivePayrollPaymentSummary(1000, 0, null)
    expect(summary.payment_status).toBe("unpaid")
    expect(summary.outstanding_amount).toBe(1000)
  })

  it("returns partially_paid when payments exist but outstanding remains", () => {
    const summary = derivePayrollPaymentSummary(1000, 450, "2026-04-25")
    expect(summary.payment_status).toBe("partially_paid")
    expect(summary.paid_amount).toBe(450)
    expect(summary.outstanding_amount).toBe(550)
  })

  it("returns paid when outstanding is fully cleared", () => {
    const summary = derivePayrollPaymentSummary(1000, 1000, "2026-04-25")
    expect(summary.payment_status).toBe("paid")
    expect(summary.outstanding_amount).toBe(0)
  })
})
