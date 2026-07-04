import { generateFinancialDocumentHTML } from "@/components/documents/FinancialDocument"
import { generateEmailReceipt } from "@/lib/receipts/template"
import { MOJIBAKE_GHS_CEDI } from "@/lib/currency/normalizeCurrencySymbol"

function buildDocumentHtml(documentType: "invoice" | "estimate" | "proforma" | "credit_note") {
  return generateFinancialDocumentHTML({
    documentType,
    business: { name: "Acme Ltd" },
    customer: { name: "Client Co" },
    items: [
      {
        description: "Service line",
        qty: 1,
        unit_price: 850,
        line_subtotal: 850,
      },
    ],
    totals: {
      subtotal: 850,
      total_tax: 170,
      total: 1020,
      tax_lines: [
        { code: "NHIL", name: "NHIL", rate: 0.025, amount: 25 },
        { code: "GETFUND", name: "GETFund", rate: 0.025, amount: 25 },
        { code: "VAT", name: "VAT", rate: 0.15, amount: 120 },
      ],
    },
    meta: {
      document_number: "DOC-001",
      issue_date: "2026-07-01",
      due_date: "2026-07-15",
    },
    apply_taxes: true,
    currency_code: "GHS",
    currency_symbol: MOJIBAKE_GHS_CEDI,
    ...(documentType === "invoice"
      ? {
          invoice_customer_payment_summary: {
            status_label: "Unpaid",
            balance_due: 1020,
          },
        }
      : {}),
  })
}

describe("FinancialDocument GHS currency rendering", () => {
  it.each([
    ["invoice", "Invoice"],
    ["estimate", "Quote"],
    ["proforma", "Proforma Invoice"],
    ["credit_note", "CREDIT NOTE"],
  ] as const)("renders ₵ for %s documents with corrupted stored symbol", (documentType) => {
    const html = buildDocumentHtml(documentType)

    expect(html).toContain("₵")
    expect(html).not.toContain(MOJIBAKE_GHS_CEDI)
    expect(html).toMatch(/₵[\s\u00A0]?850\.00/)
    expect(html).toMatch(/₵[\s\u00A0]?1,020\.00/)
    expect(html).toContain('<meta charset="utf-8">')
  })

  it("preserves numeric totals when correcting symbol", () => {
    const html = buildDocumentHtml("invoice")

    expect(html).toContain("850.00")
    expect(html).toContain("1,020.00")
  })

  it("renders USD correctly for non-GHS documents", () => {
    const html = generateFinancialDocumentHTML({
      documentType: "invoice",
      business: { name: "Acme Ltd" },
      customer: { name: "Client" },
      items: [{ description: "Item", qty: 1, unit_price: 100, line_subtotal: 100 }],
      totals: { subtotal: 100, total: 100 },
      meta: { document_number: "INV-US", issue_date: "2026-07-01" },
      currency_code: "USD",
      currency_symbol: MOJIBAKE_GHS_CEDI,
    })

    expect(html).toContain("$")
    expect(html).not.toContain(MOJIBAKE_GHS_CEDI)
    expect(html).not.toContain("₵100.00")
  })
})

describe("receipt email template GHS rendering", () => {
  it("renders ₵ via formatMoney(currencyCode) path", () => {
    const html = generateEmailReceipt({
      businessName: "Shop",
      receiptNumber: "R-001",
      date: "2026-07-01",
      time: "12:00",
      items: [{ name: "Item", quantity: 1, unitPrice: 20, total: 20 }],
      subtotal: 20,
      taxBreakdown: { vat: 3 },
      totalTax: 3,
      totalPaid: 23,
      paymentMethod: "cash",
      paymentStatus: "paid",
      isRefunded: false,
      isVoided: false,
      currencyCode: "GHS",
    })

    expect(html).toContain("₵")
    expect(html).not.toContain(MOJIBAKE_GHS_CEDI)
    expect(html).toContain('<meta charset="UTF-8">')
  })
})
