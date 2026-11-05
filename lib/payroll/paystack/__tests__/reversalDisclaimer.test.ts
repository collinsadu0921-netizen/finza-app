import {
  PAYSTACK_REVERSAL_DISCLAIMER,
  PAYSTACK_REVERSAL_REFUND_NOTICE,
  isPaystackSettledPayment,
} from "@/lib/payroll/paystack/reversalDisclaimer"

describe("Paystack salary-payment reversal disclaimer", () => {
  it("shows the exact disclaimer for a Paystack-settled payment", () => {
    expect(
      isPaystackSettledPayment({ paystack_transfer: { id: "transfer-1" } })
    ).toBe(true)
    expect(PAYSTACK_REVERSAL_DISCLAIMER).toBe(
      "Reversing this payment will update your records in Finza but will not reverse money already transferred through Paystack."
    )
    expect(PAYSTACK_REVERSAL_REFUND_NOTICE).toBe(
      "If money is returned, record the refund manually in your accounting records. Your business is responsible for arranging any refunds or recoveries."
    )
  })

  it("does not show Paystack wording for a manual payment", () => {
    expect(isPaystackSettledPayment({ paystack_transfer: null })).toBe(false)
    expect(isPaystackSettledPayment({})).toBe(false)
    expect(isPaystackSettledPayment(null)).toBe(false)
  })

  it("does not treat an unlinked transfer stub as Paystack-settled", () => {
    expect(isPaystackSettledPayment({ paystack_transfer: { id: null } })).toBe(false)
  })
})
