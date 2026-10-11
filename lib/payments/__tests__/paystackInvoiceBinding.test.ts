import { assessPaystackInvoiceSettlement } from "../paystackInvoiceBinding"

const base = {
  requestedReference: "FNZ-INV-9-1",
  invoiceId: "inv-a",
  businessId: "biz-a",
  expectedAmount: 50,
}

describe("assessPaystackInvoiceSettlement", () => {
  it("accepts a verify payload bound to the authorized invoice", () => {
    const result = assessPaystackInvoiceSettlement({
      ...base,
      data: {
        status: "success",
        reference: "FNZ-INV-9-1",
        amount: 5000,
        metadata: { invoice_id: "inv-a", business_id: "biz-a" },
      },
    })
    expect(result.ok).toBe(true)
  })

  it("rejects a charge that belongs to another invoice", () => {
    const result = assessPaystackInvoiceSettlement({
      ...base,
      data: {
        status: "success",
        reference: "FNZ-INV-9-1",
        amount: 5000,
        metadata: { invoice_id: "inv-b", business_id: "biz-b" },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.statusCode).toBe(409)
  })

  it("rejects a verify payload that is not bound to an invoice", () => {
    const result = assessPaystackInvoiceSettlement({
      ...base,
      data: { status: "success", reference: "FNZ-INV-9-1", amount: 5000 },
    })
    expect(result.ok).toBe(false)
  })

  it("rejects an echoed reference that is not the one requested", () => {
    const result = assessPaystackInvoiceSettlement({
      ...base,
      data: {
        status: "success",
        reference: "FNZ-OTHER",
        amount: 5000,
        metadata: { invoice_id: "inv-a", business_id: "biz-a" },
      },
    })
    expect(result.ok).toBe(false)
  })

  it("rejects a verified amount that is not the invoice balance", () => {
    const result = assessPaystackInvoiceSettlement({
      ...base,
      data: {
        status: "success",
        reference: "FNZ-INV-9-1",
        amount: 100,
        metadata: { invoice_id: "inv-a", business_id: "biz-a" },
      },
    })
    expect(result.ok).toBe(false)
  })

  it("allows a same-request charge success that does not echo metadata", () => {
    const result = assessPaystackInvoiceSettlement({
      ...base,
      sameRequestInitiation: true,
      data: { status: "success" },
    })
    expect(result.ok).toBe(true)
  })
})
