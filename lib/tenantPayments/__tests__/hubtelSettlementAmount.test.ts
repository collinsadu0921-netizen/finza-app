import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import {
  evaluateHubtelSettlementAmount,
  isRecoverableAmountMismatchFailure,
  resolveHubtelSettlementAmount,
} from "@/lib/tenantPayments/hubtelSettlementAmount"
import { reconcileVerifiedHubtelInvoicePayment } from "@/lib/tenantPayments/hubtelInvoiceDirectService"
import type { NormalizedHubtelStatusResponse } from "@/lib/tenantPayments/hubtelClient"

jest.mock("server-only", () => ({}))

jest.mock("@/lib/accountingBootstrap", () => ({
  ensureAccountingInitializedForServerJob: jest.fn(async () => ({ initialized: true })),
}))

jest.mock("@/lib/payments/assertPaymentJournalPosted", () => ({
  assertPaymentJournalPosted: jest.fn(async () => ({ ok: true, journalEntryId: "je-1" })),
}))

function paidStatus(overrides: Partial<NormalizedHubtelStatusResponse> = {}): NormalizedHubtelStatusResponse {
  return {
    status: "Paid",
    grossAmount: 2.1,
    charges: 0.1,
    amountAfterCharges: 2,
    transactionId: "tx-1",
    clientReference: "FZHBTEST",
    raw: { data: { status: "Paid", amount: 2.1, charges: 0.1, amountAfterCharges: 2 } },
    ...overrides,
  }
}

describe("resolveHubtelSettlementAmount", () => {
  it("prefers amountAfterCharges over gross amount", () => {
    expect(
      resolveHubtelSettlementAmount({
        grossAmount: 2.1,
        amountAfterCharges: 2,
      })
    ).toBe(2)
  })

  it("falls back to gross when amountAfterCharges is missing", () => {
    expect(
      resolveHubtelSettlementAmount({
        grossAmount: 2,
        amountAfterCharges: null,
      })
    ).toBe(2)
  })
})

describe("evaluateHubtelSettlementAmount", () => {
  it("accepts Paid when gross exceeds invoice but net matches", () => {
    const result = evaluateHubtelSettlementAmount(2, paidStatus())
    expect(result.settlementAmount).toBe(2)
    expect(result.matches).toBe(true)
  })

  it("rejects when net settlement does not match expected amount", () => {
    const result = evaluateHubtelSettlementAmount(
      2,
      paidStatus({ grossAmount: 1.6, amountAfterCharges: 1.5 })
    )
    expect(result.matches).toBe(false)
  })

  it("rejects when gross and net are both missing", () => {
    const result = evaluateHubtelSettlementAmount(
      2,
      paidStatus({ grossAmount: null, amountAfterCharges: null })
    )
    expect(result.matches).toBe(false)
  })
})

describe("isRecoverableAmountMismatchFailure", () => {
  it("returns true for failed amount_mismatch with Paid hubtel payload and no payment_id", () => {
    expect(
      isRecoverableAmountMismatchFailure({
        status: "failed",
        payment_id: null,
        last_event_payload: {
          verificationError: "amount_mismatch",
          hubtelStatus: { data: { status: "Paid", amountAfterCharges: 2 } },
        },
      })
    ).toBe(true)
  })

  it("returns false when payment_id is already set", () => {
    expect(
      isRecoverableAmountMismatchFailure({
        status: "failed",
        payment_id: "pay-1",
        last_event_payload: { verificationError: "amount_mismatch" },
      })
    ).toBe(false)
  })
})

describe("reconcileVerifiedHubtelInvoicePayment", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function mockSupabase(options?: {
    existingPaymentId?: string | null
    promoted?: boolean
    insertPaymentId?: string
  }) {
    const updates: Array<Record<string, unknown>> = []
    const paymentInserts: Array<Record<string, unknown>> = []

    const supabase = {
      from(table: string) {
        const ctx: { table: string; filters: Record<string, unknown> } = { table, filters: {} }
        const api = {
          select() {
            return api
          },
          eq(field: string, value: unknown) {
            ctx.filters[field] = value
            return api
          },
          is(field: string, value: unknown) {
            ctx.filters[field] = value
            return api
          },
          in(field: string, value: unknown) {
            ctx.filters[`${field}__in`] = value
            return api
          },
          maybeSingle: async () => {
            if (ctx.table === "payments" && options?.existingPaymentId) {
              return { data: { id: options.existingPaymentId }, error: null }
            }
            if (ctx.table === "payment_provider_transactions" && ctx.filters.status) {
              return { data: { status: "successful", payment_id: options?.existingPaymentId ?? "pay-1" }, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => ({
            data: { id: options?.insertPaymentId ?? "pay-new" },
            error: null,
          }),
          insert(payload: Record<string, unknown>) {
            paymentInserts.push(payload)
            return {
              select: () => ({
                single: async () => ({
                  data: { id: options?.insertPaymentId ?? "pay-new" },
                  error: null,
                }),
              }),
            }
          },
          update(payload: Record<string, unknown>) {
            updates.push(payload)
            return {
              eq: () => ({
                in: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: options?.promoted === false ? null : { id: "txn-1" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          },
        }
        return api
      },
      rpc: async () => ({ data: "token" }),
    }

    return { supabase: supabase as never, updates, paymentInserts }
  }

  it("creates payment using settlement amount when gross includes charges", async () => {
    const { supabase, paymentInserts, updates } = mockSupabase({ promoted: true })
    const result = await reconcileVerifiedHubtelInvoicePayment(
      supabase,
      {
        id: "txn-1",
        business_id: "biz-1",
        invoice_id: "inv-1",
        reference: "FZHBTEST",
        amount_minor: 200,
        payment_id: null,
        status: "pending_verification",
      },
      paidStatus()
    )

    expect(result.applied).toBe(true)
    expect(result.paymentId).toBe("pay-new")
    expect(paymentInserts[0]?.amount).toBe(2)
    expect(updates.some((u) => u.status === "successful")).toBe(true)
  })

  it("does not insert duplicate payment when reference already exists", async () => {
    const { supabase, paymentInserts } = mockSupabase({
      existingPaymentId: "pay-existing",
      promoted: true,
    })

    const result = await reconcileVerifiedHubtelInvoicePayment(
      supabase,
      {
        id: "txn-1",
        business_id: "biz-1",
        invoice_id: "inv-1",
        reference: "FZHBTEST",
        amount_minor: 200,
        payment_id: null,
        status: "failed",
      },
      paidStatus()
    )

    expect(result.paymentId).toBe("pay-existing")
    expect(paymentInserts).toHaveLength(0)
  })

  it("marks failed when net settlement mismatches expected amount", async () => {
    const { supabase, paymentInserts, updates } = mockSupabase()
    const result = await reconcileVerifiedHubtelInvoicePayment(
      supabase,
      {
        id: "txn-1",
        business_id: "biz-1",
        invoice_id: "inv-1",
        reference: "FZHBTEST",
        amount_minor: 200,
        payment_id: null,
        status: "pending_verification",
      },
      paidStatus({ amountAfterCharges: 1.5, grossAmount: 1.6 })
    )

    expect(result.applied).toBe(false)
    expect(result.paymentId).toBeNull()
    expect(paymentInserts).toHaveLength(0)
    expect(updates.some((u) => u.status === "failed")).toBe(true)
  })

  it("returns early when already successful with payment_id", async () => {
    const { supabase, paymentInserts } = mockSupabase()
    const result = await reconcileVerifiedHubtelInvoicePayment(
      supabase,
      {
        id: "txn-1",
        business_id: "biz-1",
        invoice_id: "inv-1",
        reference: "FZHBTEST",
        amount_minor: 200,
        payment_id: "pay-done",
        status: "successful",
      },
      paidStatus()
    )

    expect(result).toEqual({ applied: false, paymentId: "pay-done" })
    expect(paymentInserts).toHaveLength(0)
  })
})
