import { requireInvoiceIdForPublicTenantMtnStatus } from "../mtnPublicMtnStatus"

describe("requireInvoiceIdForPublicTenantMtnStatus", () => {
  it("rejects missing invoice_id", () => {
    const r = requireInvoiceIdForPublicTenantMtnStatus(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.statusCode).toBe(400)
  })

  it("accepts trimmed invoice id", () => {
    const r = requireInvoiceIdForPublicTenantMtnStatus("  abc  ")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.invoiceId).toBe("abc")
  })
})
