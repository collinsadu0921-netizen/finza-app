import { NextRequest } from "next/server"
import { GET } from "../route"

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

function paystack(data: Record<string, unknown>, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: async () => ({ status: ok, message: ok ? "ok" : "down", data }),
  }) as unknown as typeof fetch
}

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/payments/paystack/verify?${query}`))
}

describe("GET /api/payments/paystack/verify", () => {
  beforeEach(() => {
    inserted.length = 0
    mockFrom.mockReset()
    paystack({ status: "pending" })
  })

  it("does not call Paystack when the invoice token is missing", async () => {
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a")
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it("does not call Paystack when the token belongs to another invoice", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(null)
      throw new Error(table)
    })
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-b")
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it("does not insert a payment when Paystack is still pending", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      throw new Error(table)
    })
    paystack({ status: "pending", reference: "FNZ-INV-9-1" })
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-a")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("pending")
    expect(inserted).toHaveLength(0)
  })

  it("does not insert a payment when Paystack reports failed", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      throw new Error(table)
    })
    paystack({ status: "failed", reference: "FNZ-INV-9-1", gateway_response: "Declined" })
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-a")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("failed")
    expect(inserted).toHaveLength(0)
  })

  it("does not settle a successful charge that belongs to another invoice", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    paystack({
      status: "success",
      reference: "FNZ-OTHER",
      amount: 5000,
      metadata: { invoice_id: "inv-b", business_id: "biz-b" },
    })
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-a")
    expect(res.status).toBe(409)
    expect(inserted).toHaveLength(0)
  })

  it("records one payment when Paystack confirms the bound charge", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "payments") return paymentsQuery([])
      throw new Error(table)
    })
    paystack({
      status: "success",
      reference: "FNZ-INV-9-1",
      amount: 5000,
      metadata: { invoice_id: "inv-a", business_id: "biz-a" },
    })
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-a")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("success")
    expect(body.payment_id).toBe("pay-1")
    expect(inserted).toHaveLength(1)
    expect(inserted[0].invoice_id).toBe("inv-a")
    expect(inserted[0].business_id).toBe("biz-a")
  })

  it("does not insert again when the same success is verified twice", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      if (table === "payments") return paymentsQuery([{ amount: 50, reference: "FNZ-INV-9-1" }])
      throw new Error(table)
    })
    paystack({
      status: "success",
      reference: "FNZ-INV-9-1",
      amount: 5000,
      metadata: { invoice_id: "inv-a", business_id: "biz-a" },
    })
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-a")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.payment_id).toBe("pay-existing")
    expect(inserted).toHaveLength(0)
  })

  it("verifies a platform subscription reference without an invoice token", async () => {
    paystack({ status: "success", reference: "FNZ-SUB-1", amount: 1000 })
    const res = await get("reference=FNZ-SUB-1")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("success")
    expect(mockFrom).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })

  it("does not insert when Paystack verification fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery(sentInvoice)
      throw new Error(table)
    })
    paystack({ status: "failed" }, false)
    const res = await get("reference=FNZ-INV-9-1&invoice_id=inv-a&token=token-a")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("pending")
    expect(inserted).toHaveLength(0)
  })
})
