import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { POST } from "../create/route"
import { NextRequest } from "next/server"

jest.mock("@vercel/functions", () => ({
  waitUntil: jest.fn((p: Promise<unknown>) => p),
}))
jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(() =>
    Promise.resolve({ id: "biz-1", address_country: "GH" })
  ),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/accountingBootstrap", () => ({
  ensureAccountingInitialized: jest.fn(() => Promise.resolve({ error: null })),
}))
jest.mock("@/lib/archivedBusiness", () => ({
  assertBusinessNotArchived: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/accounting/reconciliation/engine-impl", () => ({
  createReconciliationEngine: jest.fn(() => ({
    reconcileInvoice: jest.fn(() => Promise.resolve({ status: "ok" })),
  })),
}))
jest.mock("@/lib/accounting/reconciliation/mismatch-logger", () => ({
  logReconciliationMismatch: jest.fn(),
}))
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
  assertMethodAllowed: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/payments/assertPaymentJournalPosted", () => ({
  assertPaymentJournalPosted: jest.fn(() =>
    Promise.resolve({ ok: true, journalEntryId: "je-1" })
  ),
}))
jest.mock("@/lib/growth/recordBusinessActivationEvent", () => ({
  voidRecordBusinessActivationEvent: jest.fn(),
}))
jest.mock("@/lib/server/fireAfterAccountingPost", () => ({
  fireAfterAccountingPost: jest.fn(),
}))

type InvoiceOverrides = Partial<{
  wht_receivable_applicable: boolean
  wht_receivable_amount: number
  total: number
  status: string
}>

function setupSupabase(options: {
  invoice?: InvoiceOverrides
  existingPayments?: Array<{ amount: number; wht_amount?: number }>
}) {
  const invoice = {
    id: "inv-1",
    business_id: "biz-1",
    total: 1000,
    status: "sent",
    fx_rate: null,
    currency_code: "GHS",
    wht_receivable_applicable: true,
    wht_receivable_amount: 75,
    ...options.invoice,
  }

  const insert = jest.fn(() => ({
    select: jest.fn(() => ({
      single: jest.fn(() =>
        Promise.resolve({
          data: { id: "pay-1", invoice_id: "inv-1" },
          error: null,
        })
      ),
    })),
  }))

  const mockSupabase = {
    auth: {
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
      ),
    },
    from: jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: invoice, error: null })),
              })),
            })),
          })),
        }
      }
      if (table === "payments") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() =>
                Promise.resolve({
                  data: options.existingPayments ?? [],
                  error: null,
                })
              ),
            })),
          })),
          insert,
        }
      }
      if (table === "credit_notes") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          })),
        }
      }
      return {}
    }),
    rpc: jest.fn(() => Promise.resolve({ data: "public-token", error: null })),
  }

  const { createSupabaseServerClient } = require("@/lib/supabaseServer")
  ;(createSupabaseServerClient as jest.Mock).mockReturnValue(mockSupabase)

  return { insert }
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/payments/create", {
    method: "POST",
    body: JSON.stringify({
      invoice_id: "inv-1",
      date: "2026-03-01",
      method: "cash",
      ...body,
    }),
    headers: { "Content-Type": "application/json" },
  })
}

describe("POST /api/payments/create - server-authoritative WHT", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("rejects WHT when the invoice has no customer withholding", async () => {
    const { insert } = setupSupabase({
      invoice: { wht_receivable_applicable: false, wht_receivable_amount: 0 },
    })

    const response = await POST(request({ amount: 500, wht_amount: 5 }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe("WHT_NOT_APPLICABLE")
    expect(insert).not.toHaveBeenCalled()
  })

  it("rejects WHT above the invoice's remaining withholding", async () => {
    const { insert } = setupSupabase({
      existingPayments: [{ amount: 200, wht_amount: 70 }],
    })

    const response = await POST(request({ amount: 300, wht_amount: 10 }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe("WHT_EXCEEDS_INVOICE")
    expect(insert).not.toHaveBeenCalled()
  })

  it("rejects WHT above the gross payment amount", async () => {
    const { insert } = setupSupabase({})

    const response = await POST(request({ amount: 20, wht_amount: 30 }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe("WHT_EXCEEDS_PAYMENT")
    expect(insert).not.toHaveBeenCalled()
  })

  it("accepts a legitimate partial WHT deduction", async () => {
    const { insert } = setupSupabase({
      existingPayments: [{ amount: 200, wht_amount: 0 }],
    })

    const response = await POST(request({ amount: 500, wht_amount: 40 }))

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, wht_amount: 40 })
    )
  })

  it("accepts the exact remaining WHT", async () => {
    const { insert } = setupSupabase({
      existingPayments: [{ amount: 200, wht_amount: 70 }],
    })

    const response = await POST(request({ amount: 500, wht_amount: 5 }))

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ wht_amount: 5 })
    )
  })

  it("accepts a zero-WHT payment on a WHT invoice", async () => {
    const { insert } = setupSupabase({})

    const response = await POST(request({ amount: 500 }))

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ wht_amount: 0 })
    )
  })

  it("accepts a zero-WHT payment on a non-WHT invoice", async () => {
    const { insert } = setupSupabase({
      invoice: { wht_receivable_applicable: false, wht_receivable_amount: 0 },
    })

    const response = await POST(request({ amount: 500, wht_amount: 0 }))

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ wht_amount: 0 })
    )
  })

  it("rejects a negative WHT amount", async () => {
    const { insert } = setupSupabase({})

    const response = await POST(request({ amount: 500, wht_amount: -1 }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe("WHT_AMOUNT_INVALID")
    expect(insert).not.toHaveBeenCalled()
  })

  it("rejects a non-numeric WHT amount", async () => {
    const { insert } = setupSupabase({})

    const response = await POST(request({ amount: 500, wht_amount: "not-a-number" }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe("WHT_AMOUNT_INVALID")
    expect(insert).not.toHaveBeenCalled()
  })
})
