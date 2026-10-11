import { NextRequest } from "next/server"
import { POST } from "../route"

process.env.FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED = "true"
process.env.PAYSTACK_SECRET_KEY = "sk_test"
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost"
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role"

const mockFrom = jest.fn()
const inserted: Array<Record<string, unknown>> = []

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: () => Promise.resolve({ data: "receipt-token", error: null }),
  }),
}))

jest.mock("@/lib/payments/assertPaymentJournalPosted", () => ({
  assertPaymentJournalPosted: jest.fn().mockResolvedValue({ ok: true, journalEntryId: "je-1" }),
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

function paymentsQuery(rows: Array<{ amount: number; reference?: string }>) {
  const balance = Promise.resolve({ data: rows, error: null })
  const leaf = {
    maybeSingle: () =>
      Promise.resolve({
        data: rows.find((row) => row.reference) ? { id: "pay-existing", public_token: "receipt-1" } : null,
        error: null,
      }),
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

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/payments/paystack/submit-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

describe("POST /api/payments/paystack/submit-otp", () => {
  beforeEach(() => {
    inserted.length = 0
    mockFrom.mockReset()
    global.fetch = jest.fn() as unknown as typeof fetch
  })

  it("rejects an invoice OTP without the invoice token and does not call Paystack", async () => {
    const res = await post({ otp: "123456", reference: "FNZ-INV-9-1", invoice_id: "inv-a" })
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it("does not insert a payment when OTP is still pending", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      throw new Error(table)
    })
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "pending", reference: "FNZ-INV-9-1" } }),
    }) as unknown as typeof fetch
    const res = await post({
      otp: "123456",
      reference: "FNZ-INV-9-1",
      invoice_id: "inv-a",
      public_token: "token-a",
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment_id).toBeNull()
    expect(inserted).toHaveLength(0)
  })

  it("does not insert a payment when OTP fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      throw new Error(table)
    })
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "failed", reference: "FNZ-INV-9-1" } }),
    }) as unknown as typeof fetch
    const res = await post({
      otp: "123456",
      reference: "FNZ-INV-9-1",
      invoice_id: "inv-a",
      public_token: "token-a",
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it("does not settle a successful OTP for a charge bound to another invoice", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          status: "success",
          reference: "FNZ-INV-9-1",
          amount: 5000,
          metadata: { invoice_id: "inv-b", business_id: "biz-b" },
        },
      }),
    }) as unknown as typeof fetch
    const res = await post({
      otp: "123456",
      reference: "FNZ-INV-9-1",
      invoice_id: "inv-a",
      public_token: "token-a",
    })
    expect(res.status).toBe(409)
    expect(inserted).toHaveLength(0)
  })

  it("records the payment when OTP success is confirmed for this invoice", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          status: "success",
          reference: "FNZ-INV-9-1",
          amount: 5000,
          metadata: { invoice_id: "inv-a", business_id: "biz-a" },
        },
      }),
    }) as unknown as typeof fetch
    const res = await post({
      otp: "123456",
      reference: "FNZ-INV-9-1",
      invoice_id: "inv-a",
      public_token: "token-a",
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment_id).toBe("pay-1")
    expect(inserted).toHaveLength(1)
    expect(inserted[0].invoice_id).toBe("inv-a")
  })

  it("submits a platform subscription OTP without an invoice token", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { status: "success", reference: "FNZ-SUB-1" } }),
    }) as unknown as typeof fetch
    const res = await post({ otp: "123456", reference: "FNZ-SUB-1" })
    expect(res.status).toBe(200)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })
})
