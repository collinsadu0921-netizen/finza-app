import { NextRequest } from "next/server"
import { GET } from "../route"

const verifyTenantMtnInvoiceByReference = jest.fn()
const assertInvoicePayCapability = jest.fn()

jest.mock("@/lib/tenantPayments/mtnInvoiceDirectService", () => ({
  verifyTenantMtnInvoiceByReference: (...args: unknown[]) => verifyTenantMtnInvoiceByReference(...args),
}))

jest.mock("@/lib/payments/invoicePayCapability", () => ({
  assertInvoicePayCapability: (...args: unknown[]) => assertInvoicePayCapability(...args),
}))

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({}),
}))

describe("GET /api/payments/momo/tenant/invoice/status", () => {
  beforeEach(() => {
    verifyTenantMtnInvoiceByReference.mockReset()
    assertInvoicePayCapability.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role"
  })

  it("does not settle when the public token is missing", async () => {
    assertInvoicePayCapability.mockResolvedValue({
      ok: false,
      error: "invoice_id and public_token are required",
      statusCode: 400,
    })
    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/momo/tenant/invoice/status?reference=finza-mtn-1&invoice_id=inv-a"
      )
    )
    expect(res.status).toBe(400)
    expect(verifyTenantMtnInvoiceByReference).not.toHaveBeenCalled()
  })

  it("does not settle a reference when the token belongs to a different invoice", async () => {
    assertInvoicePayCapability.mockResolvedValue({
      ok: false,
      error: "Invoice not found",
      statusCode: 404,
    })
    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/momo/tenant/invoice/status?reference=finza-mtn-1&invoice_id=inv-a&token=token-for-biz-b"
      )
    )
    expect(res.status).toBe(404)
    expect(verifyTenantMtnInvoiceByReference).not.toHaveBeenCalled()
  })

  it("verifies only the invoice that matched the token", async () => {
    assertInvoicePayCapability.mockResolvedValue({
      ok: true,
      invoice: { id: "inv-a", business_id: "biz-a", public_token: "token-a", status: "sent", total: 10, invoice_number: "INV-1" },
    })
    verifyTenantMtnInvoiceByReference.mockResolvedValue({ ok: true, status: "pending", applied: false })
    const res = await GET(
      new NextRequest(
        "http://localhost/api/payments/momo/tenant/invoice/status?reference=finza-mtn-1&invoice_id=inv-a&token=token-a"
      )
    )
    expect(res.status).toBe(200)
    expect(verifyTenantMtnInvoiceByReference).toHaveBeenCalledWith(expect.anything(), "finza-mtn-1", {
      invoiceId: "inv-a",
    })
  })
})
