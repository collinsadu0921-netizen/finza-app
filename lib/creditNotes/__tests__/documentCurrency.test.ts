import { describe, it, expect } from "@jest/globals"
import { buildCreditNoteDocumentHtml } from "@/lib/creditNotes/buildCreditNoteDocumentHtml"

function mockSupabase(row: Record<string, unknown>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    single: async () => ({ data: row, error: null }),
  }
  return { from: () => chain } as never
}

function creditNoteRow(currencyCode: string | null, defaultCurrency: string | null) {
  return {
    id: "cn-1",
    business_id: "biz-1",
    invoice_id: "inv-1",
    credit_number: "CN-0001",
    date: "2026-10-01",
    subtotal: 80,
    total_tax: 0,
    total: 80,
    status: "applied",
    notes: null,
    credit_note_items: [
      {
        id: "item-1",
        description: "Credit",
        qty: 1,
        unit_price: 80,
        discount_amount: 0,
        line_subtotal: 80,
      },
    ],
    invoices: {
      id: "inv-1",
      invoice_number: "INV-0001",
      currency_code: currencyCode,
      customers: {
        id: "cust-1",
        name: "Customer",
        email: null,
        phone: null,
        whatsapp_phone: null,
        address: null,
      },
    },
    businesses: {
      id: "biz-1",
      name: "Test Business",
      legal_name: null,
      trading_name: null,
      phone: null,
      email: null,
      address: null,
      logo_url: null,
      tax_id: null,
      registration_number: null,
      default_currency: defaultCurrency,
    },
  }
}

describe("buildCreditNoteDocumentHtml currency resolution", () => {
  it("uses the related invoice currency instead of assuming GHS", async () => {
    const result = await buildCreditNoteDocumentHtml(
      mockSupabase(creditNoteRow("EUR", "GHS")),
      "cn-1"
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain("€")
    expect(result.html).not.toContain("₵")
  })

  it("falls back to the business default currency when the invoice has none", async () => {
    const result = await buildCreditNoteDocumentHtml(
      mockSupabase(creditNoteRow(null, "GHS")),
      "cn-1"
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain("₵")
  })
})
