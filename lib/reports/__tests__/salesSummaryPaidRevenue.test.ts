import { salesSummaryPaidRevenue, type SalesSummaryInvoiceRef } from "../salesSummaryPaidRevenue"

const businessId = "biz-1"

function invoice(overrides: Partial<SalesSummaryInvoiceRef> = {}): SalesSummaryInvoiceRef {
  return {
    id: "inv-1",
    business_id: businessId,
    deleted_at: null,
    status: "paid",
    ...overrides,
  }
}

describe("salesSummaryPaidRevenue", () => {
  it("contributes 0 for a fully credited invoice with no payment rows", () => {
    const paid = salesSummaryPaidRevenue({
      businessId,
      payments: [],
      invoices: [invoice({ status: "paid" })],
    })
    expect(paid).toBe(0)
  })

  it("contributes the payment amount, not the invoice total, for a partial cash payment", () => {
    const paid = salesSummaryPaidRevenue({
      businessId,
      payments: [
        {
          invoice_id: "inv-1",
          amount: 1000,
          date: "2026-10-01",
          deleted_at: null,
          wht_amount: 50,
        },
      ],
      invoices: [invoice({ status: "partially_paid" })],
    })
    expect(paid).toBe(1000)
  })

  it("sums multiple payments, nets a negative amount, and ignores status", () => {
    const paid = salesSummaryPaidRevenue({
      businessId,
      payments: [
        { invoice_id: "inv-1", amount: 400, date: "2026-10-01", deleted_at: null },
        { invoice_id: "inv-1", amount: 700, date: "2026-10-02", deleted_at: null },
        { invoice_id: "inv-1", amount: -100, date: "2026-10-03", deleted_at: null },
      ],
      invoices: [invoice({ status: "sent" })],
    })
    expect(paid).toBe(1000)
  })

  it("excludes deleted payments, draft invoices, and payments outside the period", () => {
    const paid = salesSummaryPaidRevenue({
      businessId,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      payments: [
        { invoice_id: "inv-live", amount: 300, date: "2026-10-15", deleted_at: null },
        { invoice_id: "inv-live", amount: 50, date: "2026-09-30", deleted_at: null },
        { invoice_id: "inv-live", amount: 80, date: "2026-10-20", deleted_at: "2026-10-21" },
        { invoice_id: "inv-draft", amount: 900, date: "2026-10-15", deleted_at: null },
        { invoice_id: "inv-cancelled", amount: 25, date: "2026-10-16", deleted_at: null },
      ],
      invoices: [
        invoice({ id: "inv-live", status: "sent" }),
        invoice({ id: "inv-draft", status: "draft" }),
        invoice({ id: "inv-cancelled", status: "cancelled" }),
      ],
    })
    expect(paid).toBe(325)
  })

  it("includes a customer_credit payment row and does not read journals or credit notes", () => {
    const paid = salesSummaryPaidRevenue({
      businessId,
      payments: [
        { invoice_id: "inv-1", amount: 150, date: "2026-10-04", deleted_at: null },
      ],
      invoices: [invoice()],
    })
    expect(paid).toBe(150)
  })
})
