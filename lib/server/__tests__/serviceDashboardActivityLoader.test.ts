/**
 * Loader-level coverage for service dashboard journal activity mapping.
 * Distinguishes original credit-note posting from over-credit reclass journals.
 */
import { describe, it, expect } from "@jest/globals"
import { formatServiceActivityDescription } from "@/lib/dashboard/formatServiceActivityDescription"
import { buildJournalActivityItems } from "@/lib/server/serviceDashboardActivityLoader"

const CREDIT_NOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const INVOICE_ID = "iiiiiiii-iiii-4iii-8iii-iiiiiiiiiiii"

function filterChain(data: unknown) {
  const resolved = { data, error: null }
  const chain: {
    in: () => typeof chain
    is: () => typeof chain
    eq: () => typeof chain
    then: typeof Promise.prototype.then
  } = {
    in: () => chain,
    is: () => chain,
    eq: () => chain,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  }
  return chain
}

function mockSupabase(rows: Record<string, unknown[]>) {
  return {
    from: jest.fn((table: string) => ({
      select: jest.fn(() => filterChain(rows[table] ?? [])),
    })),
  } as never
}

describe("buildJournalActivityItems credit-note posting vs reclass", () => {
  const creditNoteRow = {
    id: CREDIT_NOTE_ID,
    credit_number: "CN-0001",
    total: 250,
    invoice_id: INVOICE_ID,
  }
  const invoiceRow = {
    id: INVOICE_ID,
    currency_code: "GHS",
    total: 1000,
  }

  it("labels original credit-note posting as created, with CN reference and credit-note view", async () => {
    const items = await buildJournalActivityItems(
      mockSupabase({
        credit_notes: [creditNoteRow],
        invoices: [invoiceRow],
      }),
      [
        {
          id: "je-cn-create",
          created_at: "2026-09-03T10:00:00.000Z",
          description: "Credit Note #CN-0001 for Invoice #INV-1042",
          source_type: null,
          reference_type: "credit_note",
          reference_id: CREDIT_NOTE_ID,
          journal_amount: 250,
        },
      ]
    )

    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("credit_note")
    expect(items[0].description).toBe("CN-0001")
    expect(items[0].href).toBe(`/service/credit-notes/${CREDIT_NOTE_ID}/view`)
    expect(items[0].href).not.toMatch(/\/invoices\//)
    expect(
      formatServiceActivityDescription({
        type: items[0].type,
        description: items[0].description,
      })
    ).toBe("Credit note created — CN-0001")
  })

  it("does not emit a second creation label for the associated over-credit reclass", async () => {
    const items = await buildJournalActivityItems(
      mockSupabase({
        credit_notes: [creditNoteRow],
        invoices: [invoiceRow],
      }),
      [
        {
          id: "je-cn-create",
          created_at: "2026-09-03T10:00:00.000Z",
          description: "Credit Note #CN-0001 for Invoice #INV-1042",
          source_type: null,
          reference_type: "credit_note",
          reference_id: CREDIT_NOTE_ID,
          journal_amount: 250,
        },
        {
          id: "je-cn-reclass",
          created_at: "2026-09-03T10:00:01.000Z",
          description: "Credit Note Reclass #CN-0001 for Invoice #INV-1042",
          source_type: null,
          reference_type: "credit_note",
          reference_id: CREDIT_NOTE_ID,
          journal_amount: 40,
        },
      ]
    )

    expect(items).toHaveLength(2)

    const created = items.find((item) => item.id === "je-cn-create")
    const reclass = items.find((item) => item.id === "je-cn-reclass")
    expect(created).toBeDefined()
    expect(reclass).toBeDefined()

    const createdLabel = formatServiceActivityDescription({
      type: created!.type,
      description: created!.description,
    })
    const reclassLabel = formatServiceActivityDescription({
      type: reclass!.type,
      description: reclass!.description,
    })

    expect(created!.type).toBe("credit_note")
    expect(createdLabel).toBe("Credit note created — CN-0001")
    expect(created!.href).toBe(`/service/credit-notes/${CREDIT_NOTE_ID}/view`)

    expect(reclass!.type).toBe("credit_note_reclass")
    expect(reclassLabel).toBe("Credit note adjustment — CN-0001")
    expect(reclassLabel).not.toMatch(/Credit note created/i)
    expect(reclass!.href).toBe(`/service/credit-notes/${CREDIT_NOTE_ID}/view`)
    expect(reclass!.amount).toBe(40)
  })

  it("labels manual journals by source_type and links to the exact ledger entry", async () => {
    const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    const items = await buildJournalActivityItems(
      mockSupabase({}),
      [
        {
          id: "je-manual-expense",
          created_at: "2026-10-24T10:00:00.000Z",
          description: "Office supplies paid from cash",
          source_type: "service_manual",
          reference_type: "manual",
          reference_id: "draft-expense",
          journal_amount: 1,
        },
        {
          id: "je-manual-transfer",
          created_at: "2026-10-24T10:05:00.000Z",
          description: "Transfer from bank to mobile money",
          source_type: "service_manual",
          reference_type: "manual",
          reference_id: "draft-transfer",
          journal_amount: 5000,
        },
      ],
      businessId
    )

    expect(items.map((item) => item.type)).toEqual([
      "manual_journal",
      "manual_journal",
    ])
    expect(items[0].description).toBe("Office supplies paid from cash")
    expect(items[0].amount).toBe(1)
    expect(items[0].href).toBe(
      `/service/ledger?business_id=${businessId}&reference_type=manual&reference_id=draft-expense`
    )
    expect(items[1].description).toBe("Transfer from bank to mobile money")
    expect(items[1].amount).toBe(5000)
    expect(items[1].href).toBe(
      `/service/ledger?business_id=${businessId}&reference_type=manual&reference_id=draft-transfer`
    )

    for (const item of items) {
      const label = formatServiceActivityDescription({
        type: item.type,
        description: item.description,
      })
      expect(label).toMatch(/^Manual journal/)
      expect(label).not.toMatch(/Expense recorded/i)
    }
  })

  it("labels both Service and generic manual-journal reversals as Reversal", async () => {
    const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    const items = await buildJournalActivityItems(
      mockSupabase({}),
      [
        {
          id: "je-service-reversal",
          created_at: "2026-10-24T11:00:00.000Z",
          description: "Reversal of manual journal ea817b81: mistake by me",
          source_type: "service_manual_reversal",
          reference_type: "reversal",
          reference_id: "ea817b81",
          journal_amount: 1,
        },
        {
          id: "je-generic-reversal",
          created_at: "2026-10-24T11:05:00.000Z",
          description: "Reversal of JE ea817b81: mistake by me",
          source_type: null,
          reference_type: "reversal",
          reference_id: "ea817b81",
          journal_amount: 1,
        },
      ],
      businessId
    )

    expect(items.map((item) => item.type)).toEqual(["reversal", "reversal"])
    expect(items[0].amount).toBe(1)
    expect(items[1].amount).toBe(1)
    expect(items[0].href).toBe(
      `/service/ledger?business_id=${businessId}&reference_type=reversal&reference_id=ea817b81`
    )
    expect(items[1].href).toBe(
      `/service/ledger?business_id=${businessId}&reference_type=reversal&reference_id=ea817b81`
    )

    for (const item of items) {
      const label = formatServiceActivityDescription({
        type: item.type,
        description: item.description,
      })
      expect(label).toMatch(/^Reversal/)
      expect(label).not.toMatch(/Expense recorded/i)
    }
  })

  it("labels VAT payments and accruals without using the expense fallback", async () => {
    const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    const filingId = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv"
    const items = await buildJournalActivityItems(
      mockSupabase({}),
      [
        {
          id: "je-vat-payment",
          created_at: "2026-10-25T12:55:26.000Z",
          description: "VAT payment - 2026-10-01 to 2026-10-31",
          source_type: null,
          reference_type: "vat_return_payment",
          reference_id: filingId,
          journal_amount: 120,
        },
        {
          id: "je-vat-accrual",
          created_at: "2026-10-25T12:48:48.000Z",
          description: "VAT accrual - October 2026",
          source_type: null,
          reference_type: "test_vat_accrual",
          reference_id: filingId,
          journal_amount: 120,
        },
      ],
      businessId
    )

    expect(items.map((item) => item.type)).toEqual([
      "vat_payment",
      "vat_accrual",
    ])
    expect(items[0].href).toBe(
      `/vat-returns/${filingId}?business_id=${businessId}`
    )
    expect(items[1].href).toBe(
      `/service/ledger?business_id=${businessId}&reference_type=test_vat_accrual&reference_id=${filingId}`
    )
    for (const item of items) {
      const label = formatServiceActivityDescription({
        type: item.type,
        description: item.description,
      })
      expect(label).not.toMatch(/Expense recorded/i)
      expect(label).toMatch(/^VAT (payment|accrual)/)
    }
  })

  it("keeps ordinary invoice posting as Invoice created with the invoice destination", async () => {
    const items = await buildJournalActivityItems(
      mockSupabase({
        invoices: [invoiceRow],
      }),
      [
        {
          id: "je-invoice",
          created_at: "2026-09-03T09:00:00.000Z",
          description: "Invoice #INV-1042",
          source_type: null,
          reference_type: "invoice",
          reference_id: INVOICE_ID,
          journal_amount: 1000,
        },
      ]
    )

    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("invoice")
    expect(items[0].href).toBe(`/service/invoices/${INVOICE_ID}`)
    expect(items[0].href).not.toMatch(/credit-notes/)
    expect(
      formatServiceActivityDescription({
        type: items[0].type,
        description: items[0].description,
      })
    ).toBe("Invoice created — INV-1042")
  })
})
