import { NextRequest } from "next/server"
import { POST } from "../route"

process.env.FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED = "true"
process.env.PAYSTACK_SECRET_KEY = "sk_test"
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost"
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role"

const mockFrom = jest.fn()

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: () => Promise.resolve({ data: "receipt-token", error: null }),
  }),
}))

jest.mock("@/lib/accountingBootstrap", () => ({
  ensureAccountingInitialized: jest.fn().mockResolvedValue({ error: null }),
}))

jest.mock("@/lib/payments/assertPaymentJournalPosted", () => ({
  assertPaymentJournalPosted: jest.fn().mockResolvedValue({ ok: true }),
}))

const sentInvoice = {
  id: "inv-a",
  invoice_number: "INV-9",
  total: 50,
  business_id: "biz-a",
  status: "sent",
  public_token: "token-a",
}

function invoiceQuery(row: typeof sentInvoice | null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      }),
    }),
  }
}

function businessQuery() {
  return {
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: { id: "biz-a", address_country: "GH" }, error: null }),
      }),
    }),
  }
}

function paymentsQuery(rows: Array<{ amount: number; reference?: string }>) {
  const balance = Promise.resolve({ data: rows, error: null })
  const leaf = {
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      balance.then(onFulfilled, onRejected),
  }
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => leaf,
    insert: (row: Record<string, unknown>) => {
      inserted.push(row)
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id: "pay-1", public_token: "receipt-token" }, error: null }),
        }),
      }
    },
  }
  return chain
}

const inserted: Array<Record<string, unknown>> = []

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/payments/paystack/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

describe("POST /api/payments/paystack/charge", () => {
  beforeEach(() => {
    inserted.length = 0
    mockFrom.mockReset()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "pay_offline", display_text: "Approve" } }),
    }) as unknown as typeof fetch
  })

  it("rejects a charge that has no public token and does not read invoices", async () => {
    const res = await post({ invoice_id: "inv-a", provider: "mtn", phone: "0240000000", business_id: "biz-b" })
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it("rejects a token that does not match the invoice, including a cross-tenant token", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(null)
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-for-biz-b",
      provider: "mtn",
      phone: "0240000000",
      business_id: "biz-b",
    })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it("charges the invoice that owns the token and ignores a client business id", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "success", display_text: "Paid" } }),
    }) as unknown as typeof fetch
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "businesses") return businessQuery()
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      provider: "mtn",
      phone: "0240000000",
      business_id: "biz-b",
    })
    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].business_id).toBe("biz-a")
    expect(inserted[0].invoice_id).toBe("inv-a")
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("does not insert a second payment when a retry finds the balance already covered", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "businesses") return businessQuery()
      if (table === "payments") return paymentsQuery([{ amount: 50 }])
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      provider: "mtn",
      phone: "0240000000",
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/balance/i)
    expect(inserted).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("does not insert a payment when Paystack has only sent the phone prompt", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "businesses") return businessQuery()
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      provider: "mtn",
      phone: "0240000000",
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("pay_offline")
    expect(body.payment_id).toBeNull()
    expect(inserted).toHaveLength(0)
  })

  it("rejects a receipt token that is not the invoice public token", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(null)
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "receipt-token-not-invoice",
      provider: "mtn",
      phone: "0240000000",
    })
    expect(res.status).toBe(404)
    expect(inserted).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("allows a retry while a balance remains, still scoped to the token's business", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "success" } }),
    }) as unknown as typeof fetch
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "businesses") return businessQuery()
      if (table === "payments") return paymentsQuery([{ amount: 20 }])
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      provider: "mtn",
      phone: "0240000000",
      business_id: "biz-b",
    })
    expect(res.status).toBe(200)
    expect(inserted[0].amount).toBe(30)
    expect(inserted[0].business_id).toBe("biz-a")
  })

  it("does not insert a payment when Paystack declines the charge", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "failed", gateway_response: "Declined" } }),
    }) as unknown as typeof fetch
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "businesses") return businessQuery()
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      provider: "mtn",
      phone: "0240000000",
    })
    expect(res.status).toBe(402)
    expect(inserted).toHaveLength(0)
  })

  it("does not record a success whose Paystack metadata names another invoice", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: { status: "success", metadata: { invoice_id: "inv-b", business_id: "biz-b" } },
      }),
    }) as unknown as typeof fetch
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "businesses") return businessQuery()
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      provider: "mtn",
      phone: "0240000000",
    })
    expect(res.status).toBe(409)
    expect(inserted).toHaveLength(0)
  })
})
