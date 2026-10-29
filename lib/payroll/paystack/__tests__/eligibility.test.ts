import {
  evaluatePaystackSalaryEligibility,
  type PaystackEligibilityInput,
} from "@/lib/payroll/paystack/eligibility"

function input(overrides: Partial<PaystackEligibilityInput> = {}): PaystackEligibilityInput {
  return {
    tier: "business",
    business_tier_allows_paystack: true,
    has_payroll_pay_permission: true,
    run_status: "approved",
    batch_status: "processing",
    item_status: "pending",
    item_payment_id: null,
    item_amount: 1000,
    item_currency: "GHS",
    destination_valid: true,
    has_unallocated_aggregate_payment: false,
    connection: {
      exists: true,
      is_active: true,
      status: "connected",
      environment: "test",
    },
    live_transfers_enabled: false,
    available_balance_pesewas: 200000,
    active_transfer: null,
    ...overrides,
  }
}

describe("Paystack salary eligibility", () => {
  it("allows a Business-tier employee transfer with sufficient balance", () => {
    expect(evaluatePaystackSalaryEligibility(input())).toEqual(
      expect.objectContaining({ ok: true, code: "OK" })
    )
  })

  it("denies Professional tier", () => {
    expect(
      evaluatePaystackSalaryEligibility(
        input({ tier: "professional", business_tier_allows_paystack: false })
      )
    ).toEqual(expect.objectContaining({ ok: false, code: "TIER_REQUIRED" }))
  })

  it("denies users without payroll.pay", () => {
    expect(
      evaluatePaystackSalaryEligibility(input({ has_payroll_pay_permission: false }))
    ).toEqual(expect.objectContaining({ ok: false, code: "PERMISSION_DENIED" }))
  })

  it.each(["draft", "reversed", "pending_approval"])("denies run status %s", (runStatus) => {
    expect(evaluatePaystackSalaryEligibility(input({ run_status: runStatus }))).toEqual(
      expect.objectContaining({ ok: false, code: "RUN_NOT_PAYABLE" })
    )
  })

  it("denies an already-paid item", () => {
    expect(
      evaluatePaystackSalaryEligibility(
        input({ item_status: "paid", item_payment_id: "payment-1" })
      )
    ).toEqual(expect.objectContaining({ ok: false, code: "ALREADY_PAID" }))
  })

  it("denies aggregate-payment conflicts", () => {
    expect(
      evaluatePaystackSalaryEligibility(input({ has_unallocated_aggregate_payment: true }))
    ).toEqual(expect.objectContaining({ ok: false, code: "AGGREGATE_CONFLICT" }))
  })

  it("denies a missing or inactive connection", () => {
    expect(
      evaluatePaystackSalaryEligibility(
        input({ connection: { exists: false, is_active: false, status: "disconnected", environment: null } })
      )
    ).toEqual(expect.objectContaining({ ok: false, code: "CONNECTION_MISSING" }))
  })

  it("denies live transfers unless enabled", () => {
    expect(
      evaluatePaystackSalaryEligibility(
        input({
          connection: { exists: true, is_active: true, status: "connected", environment: "live" },
          live_transfers_enabled: false,
        })
      )
    ).toEqual(expect.objectContaining({ ok: false, code: "LIVE_TRANSFERS_DISABLED" }))
  })

  it("denies insufficient balance", () => {
    expect(
      evaluatePaystackSalaryEligibility(input({ available_balance_pesewas: 99999 }))
    ).toEqual(expect.objectContaining({ ok: false, code: "INSUFFICIENT_BALANCE" }))
  })

  it("denies an unresolved transfer for the same item", () => {
    expect(
      evaluatePaystackSalaryEligibility(
        input({ active_transfer: { id: "transfer-1", status: "pending", reference: "ref" } })
      )
    ).toEqual(expect.objectContaining({ ok: false, code: "TRANSFER_PENDING", transfer_id: "transfer-1" }))
  })

  it("denies a mismatched frozen amount", () => {
    expect(
      evaluatePaystackSalaryEligibility(input({ transfer_amount: 999.99 }))
    ).toEqual(expect.objectContaining({ ok: false, code: "AMOUNT_MISMATCH" }))
  })
})
