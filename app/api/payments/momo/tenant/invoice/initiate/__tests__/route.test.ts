import { NextRequest } from "next/server"
import { POST } from "../route"

const initiateTenantMtnInvoicePayment = jest.fn()

jest.mock("@/lib/tenantPayments/mtnInvoiceDirectService", () => ({
  initiateTenantMtnInvoicePayment: (...args: unknown[]) => initiateTenantMtnInvoicePayment(...args),
}))

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: jest.fn() }),
}))

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/payments/momo/tenant/invoice/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

describe("POST /api/payments/momo/tenant/invoice/initiate", () => {
  beforeEach(() => {
    initiateTenantMtnInvoicePayment.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role"
  })

  it("rejects a missing public token before calling the payment service", async () => {
    const res = await post({ invoice_id: "inv-a", phone: "0240000000", business_id: "biz-b" })
    expect(res.status).toBe(400)
    expect(initiateTenantMtnInvoicePayment).not.toHaveBeenCalled()
  })

  it("passes the token and phone, and does not pass a client business id", async () => {
    initiateTenantMtnInvoicePayment.mockResolvedValue({
      ok: true,
      reference: "finza-mtn-1",
      payment_id: null,
      display_text: "Approve",
      status: "pending",
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-a",
      phone: "0240000000",
      business_id: "biz-b",
    })
    expect(res.status).toBe(200)
    expect(initiateTenantMtnInvoicePayment).toHaveBeenCalledWith(expect.anything(), {
      invoiceId: "inv-a",
      publicToken: "token-a",
      phone: "0240000000",
    })
  })

  it("returns the service error when the token does not match the invoice", async () => {
    initiateTenantMtnInvoicePayment.mockResolvedValue({
      ok: false,
      error: "Invoice not found",
      statusCode: 404,
    })
    const res = await post({
      invoice_id: "inv-a",
      public_token: "token-for-biz-b",
      phone: "0240000000",
    })
    expect(res.status).toBe(404)
    const retry = await post({
      invoice_id: "inv-a",
      public_token: "token-for-biz-b",
      phone: "0240000000",
    })
    expect(retry.status).toBe(404)
    expect(initiateTenantMtnInvoicePayment).toHaveBeenCalledTimes(2)
  })
})
