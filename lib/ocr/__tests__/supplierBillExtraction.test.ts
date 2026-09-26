import { describe, expect, it } from "@jest/globals"
import { buildReceiptExtractionRequest } from "@/lib/ocr/openaiReceiptRequest"
import { receiptExtractionSchema, type ReceiptExtraction } from "@/lib/ocr/openaiReceiptSchema"
import { extractReceiptWithOpenAi } from "@/lib/ocr/openaiReceiptExtract"
import {
  normalizeSupplierBillExtraction,
  planSupplierBillDraft,
  supplierBillMismatchMessage,
  type SupplierBillExtraction,
} from "@/lib/ocr/supplierBillExtraction"

const emptyEvidence = {
  supplier: null,
  invoice_number: null,
  date: null,
  due_date: null,
  total: null,
  currency: null,
}

const emptyClarity = {
  supplier: null,
  invoice_number: null,
  date: null,
  total: null,
  currency: null,
  line_items: "high" as const,
}

function invoice(overrides: Partial<SupplierBillExtraction> = {}): SupplierBillExtraction {
  return {
    document_type: "invoice",
    supplier_name: "Accra Supplies Ltd",
    supplier_tax_id: null,
    invoice_number: "INV-9",
    document_date: "2026-04-02",
    due_date: "2026-04-16",
    currency: "GHS",
    line_items: [],
    subtotal: null,
    tax_amount: null,
    total_amount: null,
    evidence: emptyEvidence,
    warnings: [],
    clarity: emptyClarity,
    ...overrides,
  }
}

describe("expense extraction stays receipt-shaped", () => {
  it("does not ask the expense prompt for invoice line items", () => {
    const request = buildReceiptExtractionRequest({
      model: "gpt-6-luna",
      mime: "image/jpeg",
      filename: "receipt.jpg",
      bytes: Uint8Array.from([1]),
    })
    const text = request.input[0].content[0]
    expect(text).toMatchObject({ type: "input_text" })
    if (text.type === "input_text") expect(text.text).not.toContain("line_items")
    expect(request.max_output_tokens).toBe(1200)
  })

  it("still accepts an expense extraction without line items", () => {
    const expense: ReceiptExtraction = {
      document_type: "receipt",
      supplier_name: "KOFI SHOP LTD",
      document_date: "2026-03-12",
      total_amount: 45.5,
      currency: "GHS",
      subtotal: null,
      tax_amount: null,
      receipt_number: null,
      supplier_tax_id: null,
      evidence: { supplier: null, date: null, total: null, currency: null },
      warnings: [],
      clarity: { supplier: "high", date: "high", total: "high", currency: "high" },
    }
    expect(receiptExtractionSchema.safeParse(expense).success).toBe(true)
    expect("line_items" in expense).toBe(false)
  })
})

describe("supplier bill line extraction", () => {
  it("keeps one printed line instead of inventing extras", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      line_items: [{ description: "Floor soap", quantity: 1, unit_price: 80, discount_amount: 0, line_total: 80 }],
      subtotal: 80,
      tax_amount: 0,
      total_amount: 80,
    })), "GHS")
    expect(draft.lines).toEqual([{ description: "Floor soap", qty: 1, unit_price: 80, discount_amount: 0 }])
    expect(draft.fallback).toBe(false)
    expect(draft.applyTaxes).toBe(false)
    expect(draft.calculatedTotal).toBe(80)
    expect(draft.blocksSave).toBe(false)
  })

  it("preserves separate rows, quantities, prices, and discounts", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      line_items: [
        { description: "Cleaning chemicals", quantity: 2, unit_price: 150, discount_amount: 0, line_total: 300 },
        { description: "Mop heads", quantity: 5, unit_price: 20, discount_amount: 0, line_total: 100 },
        { description: "Delivery", quantity: 1, unit_price: 50, discount_amount: 10, line_total: 40 },
      ],
      subtotal: 440,
      tax_amount: null,
      total_amount: 440,
    })), "GHS")
    expect(draft.lines).toHaveLength(3)
    expect(draft.lines[0]).toMatchObject({ description: "Cleaning chemicals", qty: 2, unit_price: 150 })
    expect(draft.lines[1]).toMatchObject({ description: "Mop heads", qty: 5, unit_price: 20 })
    expect(draft.lines[2]).toMatchObject({ description: "Delivery", qty: 1, unit_price: 50, discount_amount: 10 })
    expect(draft.calculatedTotal).toBe(440)
    expect(draft.lines.some((line) => line.description === "From receipt")).toBe(false)
  })

  it("keeps exclusive lines and adds the printed tax without turning on Ghana reverse tax", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      line_items: [
        { description: "Cleaning chemicals", quantity: 2, unit_price: 150, discount_amount: null, line_total: 300 },
        { description: "Mop heads", quantity: 5, unit_price: 20, discount_amount: null, line_total: 100 },
      ],
      subtotal: 400,
      tax_amount: 60,
      total_amount: 460,
    })), "GHS")
    expect(draft.lines.map((line) => line.description)).toEqual(["Cleaning chemicals", "Mop heads", "Tax"])
    expect(draft.lines[2]).toMatchObject({ qty: 1, unit_price: 60, discount_amount: 0 })
    expect(draft.calculatedTotal).toBe(460)
    expect(draft.applyTaxes).toBe(false)
    expect(draft.taxNote).toContain("Apply Taxes is off")
  })

  it("leaves a foreign invoice in document currency with FX tax off and a blank-rate decision outside this mapper", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      currency: "USD",
      supplier_name: "Vercel Inc. (@vercel)",
      invoice_number: "UPWOCJMT-0004",
      line_items: [
        { description: "Pro plan", quantity: 1, unit_price: 20, discount_amount: 0, line_total: 20 },
        { description: "Bandwidth", quantity: 2, unit_price: 2.5, discount_amount: 0, line_total: 5 },
      ],
      subtotal: 25,
      tax_amount: 0,
      total_amount: 25,
    })), "GHS")
    expect(draft.lines).toHaveLength(2)
    expect(draft.applyTaxes).toBe(false)
    expect(draft.calculatedTotal).toBe(25)
    expect(draft.taxNote).toContain("USD")
    expect(draft.blocksSave).toBe(false)
  })

  it("falls back to one Invoice total row when the table cannot be read", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      line_items: [{ description: null, quantity: null, unit_price: null, discount_amount: null, line_total: null }],
      total_amount: 500,
    })), "GHS")
    expect(draft.fallback).toBe(true)
    expect(draft.lines).toEqual([{ description: "Invoice total", qty: 1, unit_price: 500, discount_amount: 0 }])
    expect(draft.itemWarning).toBe("Some invoice items could not be read. Review the bill before saving.")
  })

  it("does not fabricate lines when both the table and the total are unreadable", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      line_items: [],
      total_amount: null,
    })), "GHS")
    expect(draft.lines).toEqual([])
    expect(draft.fallback).toBe(false)
  })

  it("warns and blocks when the line sum does not match the printed total", () => {
    const normalized = normalizeSupplierBillExtraction(invoice({
      line_items: [
        { description: "Cleaning chemicals", quantity: 2, unit_price: 150, discount_amount: 0, line_total: 300 },
        { description: "Mop heads", quantity: 5, unit_price: 20, discount_amount: 0, line_total: 100 },
      ],
      subtotal: 400,
      tax_amount: null,
      total_amount: 500,
    }))
    expect(normalized.line_items).toHaveLength(2)
    expect(normalized.total_amount).toBe(500)
    const draft = planSupplierBillDraft(normalized, "GHS")
    expect(draft.calculatedTotal).toBe(400)
    expect(draft.blocksSave).toBe(true)
    expect(supplierBillMismatchMessage({ currency: "GHS", calculated: draft.calculatedTotal, printed: 500 })).toBe(
      "Extracted line items total GHS 400.00, but the invoice total is GHS 500.00. Review tax, discounts or missing items before saving."
    )
  })

  it("records a line arithmetic warning without changing the printed numbers", () => {
    const normalized = normalizeSupplierBillExtraction(invoice({
      line_items: [{ description: "Mop heads", quantity: 5, unit_price: 20, discount_amount: 0, line_total: 90 }],
      total_amount: 90,
    }))
    expect(normalized.warnings).toContain("line_1_arithmetic")
    expect(normalized.line_items[0]).toMatchObject({ quantity: 5, unit_price: 20, line_total: 90 })
  })

  it("uses quantity 1 only when a line total exists and quantity was not printed", () => {
    const draft = planSupplierBillDraft(normalizeSupplierBillExtraction(invoice({
      line_items: [{ description: "Call-out", quantity: null, unit_price: null, discount_amount: null, line_total: 40 }],
      total_amount: 40,
    })), "GHS")
    expect(draft.lines).toEqual([{ description: "Call-out", qty: 1, unit_price: 40, discount_amount: 0 }])
  })
})

describe("supplier bill due date", () => {
  it("keeps an explicit printed due date", () => {
    const later = normalizeSupplierBillExtraction(invoice({
      document_date: "2026-04-21",
      due_date: "2026-05-21",
      evidence: { ...emptyEvidence, due_date: "Due Date: 21 May 2026" },
    }))
    expect(later.due_date).toBe("2026-05-21")

    const sameDay = normalizeSupplierBillExtraction(invoice({
      document_date: "2026-07-29",
      due_date: "2026-07-29",
      evidence: { ...emptyEvidence, due_date: "Date due July 29, 2026" },
    }))
    expect(sameDay.due_date).toBe("2026-07-29")
  })

  it("returns null when the receipt has no due date", () => {
    const normalized = normalizeSupplierBillExtraction(invoice({
      document_type: "receipt",
      document_date: "2022-04-22",
      due_date: "2022-04-22",
      evidence: { ...emptyEvidence, due_date: "Due 22/04/2022" },
      warnings: ["Due date is not printed; omitted."],
    }))
    expect(normalized.document_date).toBe("2022-04-22")
    expect(normalized.due_date).toBeNull()
  })

  it("does not copy the issue date when no due date is printed", () => {
    const normalized = normalizeSupplierBillExtraction(invoice({
      document_date: "2026-04-21",
      due_date: "2026-04-21",
      evidence: { ...emptyEvidence, date: "Invoice Date: 21 April 2026", due_date: null },
    }))
    expect(normalized.document_date).toBe("2026-04-21")
    expect(normalized.due_date).toBeNull()
  })
})

describe("supplier bill mode uses the richer schema", () => {
  it("parses line items from the supplier bill response", async () => {
    const request = buildReceiptExtractionRequest({
      model: "gpt-6-luna",
      mime: "application/pdf",
      filename: "invoice.pdf",
      bytes: Uint8Array.from([1]),
      mode: "supplier_bill",
    })
    expect(request.store).toBe(false)
    expect(request.max_output_tokens).toBe(4000)
    const text = request.input[0].content[0]
    if (text.type === "input_text") expect(text.text).toContain("one line_items entry for each printed row")

    const result = await extractReceiptWithOpenAi({
      bytes: Uint8Array.from([1]),
      mime: "application/pdf",
      filename: "invoice.pdf",
      mode: "supplier_bill",
      model: "gpt-6-luna",
      client: {
        responses: {
          parse: async () => ({
            output_parsed: invoice({
              line_items: [
                { description: "Cleaning chemicals", quantity: 2, unit_price: 150, discount_amount: 0, line_total: 300 },
                { description: "Mop heads", quantity: 5, unit_price: 20, discount_amount: 0, line_total: 100 },
              ],
              total_amount: 400,
            }),
          }),
        },
      },
    })
    expect(result.extraction).toMatchObject({ invoice_number: "INV-9" })
    if (!("line_items" in result.extraction)) throw new Error("expected supplier bill extraction")
    expect(result.extraction.line_items).toHaveLength(2)
  })
})
