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
