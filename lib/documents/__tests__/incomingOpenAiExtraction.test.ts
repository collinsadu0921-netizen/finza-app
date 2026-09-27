import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import type { ReceiptExtraction } from "@/lib/ocr/openaiReceiptSchema"
import {
  normalizeSupplierBillExtraction,
  type SupplierBillExtraction,
} from "@/lib/ocr/supplierBillExtraction"
import { ReceiptAiError } from "@/lib/ocr/openaiReceiptExtract"
import {
  incomingHandoffSkipsUpload,
  inboxStatusLabel,
  persistOpenAiResult,
  reextractRequiresConfirmation,
} from "@/lib/documents/incomingOpenAiExtraction"
import { runPersistedOpenAiExtraction } from "@/lib/documents/runPersistedOpenAiExtraction"

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(async () => "owner"),
}))

function expense(overrides: Partial<ReceiptExtraction> = {}): ReceiptExtraction {
  return {
    document_type: "receipt",
    supplier_name: "MARINA RETAIL CO., LTD",
    document_date: "2022-04-22",
    total_amount: 103.23,
    currency: "GHS",
    subtotal: 86.57,
    tax_amount: 16.66,
    receipt_number: "326125",
    supplier_tax_id: null,
    evidence: { supplier: "MARINA", date: "22 Apr 2022", total: "103.23", currency: "GHS" },
    warnings: [],
    clarity: { supplier: "high", date: "high", total: "high", currency: "high" },
    ...overrides,
  }
}

function bill(overrides: Partial<SupplierBillExtraction> = {}): SupplierBillExtraction {
  return {
    document_type: "invoice",
    supplier_name: "Golden hands services Ltd",
    supplier_tax_id: null,
    invoice_number: "INV-000018",
    document_date: "2026-04-21",
    due_date: "2026-05-21",
    currency: "GHS",
    line_items: [
      { description: "Line 1", quantity: 1, unit_price: 2500, discount_amount: null, line_total: 2500 },
      { description: "Line 2", quantity: 1, unit_price: 750, discount_amount: null, line_total: 750 },
      { description: "Line 3", quantity: 1, unit_price: 1200, discount_amount: null, line_total: 1200 },
      { description: "Line 4", quantity: 1, unit_price: 600, discount_amount: null, line_total: 600 },
      { description: "Line 5", quantity: 1, unit_price: 1200, discount_amount: null, line_total: 1200 },
      { description: "Line 6", quantity: 1, unit_price: 500, discount_amount: null, line_total: 500 },
    ],
    subtotal: 5624.99,
    tax_amount: 1125.01,
    total_amount: 6750,
    evidence: {
      supplier: "Golden hands services Ltd",
      invoice_number: "INV-000018",
      date: "21 Apr 2026",
      due_date: "Due 21 May 2026",
      total: "6750",
      currency: "GHS",
    },
    warnings: [],
    clarity: { supplier: "high", invoice_number: "high", date: "high", total: "high", currency: "high", line_items: "high" },
    ...overrides,
  }
}

type Row = Record<string, unknown>

function fakeStore(document: Row) {
  const documents: Row[] = [{ ...document }]
  const extractions: Row[] = []
  const downloads: string[] = []
  const uploads: string[] = []
  let nextId = 1

  function from(table: string) {
    const rows = table === "incoming_documents" ? documents : extractions
    const state = {
      filters: [] as Array<{ col: string; val: unknown }>,
      patch: null as Row | null,
      inserted: null as Row | null,
    }
    const builder = {
      select() { return builder },
      eq(col: string, val: unknown) {
        state.filters.push({ col, val })
        return builder
      },
      update(patch: Row) {
        state.patch = patch
        return builder
      },
      insert(row: Row) {
        const next = { id: `ext-${nextId++}`, ...row }
        rows.push(next)
        state.inserted = next
        return builder
      },
      maybeSingle: async () => {
        const found = rows.find((row) => state.filters.every((filter) => row[filter.col] === filter.val)) ?? null
        return { data: found, error: null }
      },
      single: async () => ({ data: state.inserted, error: null }),
      then(resolve: (value: unknown) => void) {
        if (state.patch) {
          for (const row of rows) {
            if (state.filters.every((filter) => row[filter.col] === filter.val)) Object.assign(row, state.patch)
          }
        }
        resolve({ data: null, error: null })
      },
    }
    return builder
  }

  return {
    documents,
    extractions,
    downloads,
    uploads,
    client: {
      from,
      storage: {
        from() {
          return {
            download: async (path: string) => {
              downloads.push(path)
              return { data: { arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }, error: null }
            },
            upload: async (path: string) => {
              uploads.push(path)
              return { error: null }
            },
          }
        },
      },
    },
  }
}

describe("incoming OpenAI extraction", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation(() => undefined)
  })

  it("maps an expense receipt onto the receipt schema without line items or a due date", () => {
    const persisted = persistOpenAiResult({ requestedKind: "expense_receipt", expense: expense() })
    expect(persisted.extraction_mode).toBe("expense")
    expect(persisted.parsed_json.supplier_name).toBe("MARINA RETAIL CO., LTD")
    expect(persisted.parsed_json.document_number).toBe("326125")
    expect(persisted.parsed_json.total).toBe(103.23)
    expect(persisted.parsed_json.due_date).toBeNull()
    expect(persisted.parsed_json.line_items).toBeUndefined()
  })

  it("maps a supplier invoice onto the supplier bill schema and keeps every printed line", () => {
    const persisted = persistOpenAiResult({ requestedKind: "supplier_bill_attachment", supplierBill: bill() })
    expect(persisted.extraction_mode).toBe("supplier_bill")
    expect(persisted.parsed_json.document_number).toBe("INV-000018")
    expect(persisted.parsed_json.due_date).toBe("2026-05-21")
    expect(persisted.parsed_json.line_items).toHaveLength(6)
    expect(persisted.parsed_json.line_items?.map((line) => line.line_total)).toEqual([2500, 750, 1200, 600, 1200, 500])
    expect(persisted.parsed_json.total).toBe(6750)
  })

  it("does not invent a due date from the issue date", () => {
    const normalized = normalizeSupplierBillExtraction(bill({
      due_date: "2026-04-21",
      evidence: { ...bill().evidence, due_date: "21 Apr 2026" },
    }))
    expect(normalized.due_date).toBeNull()
    const persisted = persistOpenAiResult({ requestedKind: "supplier_bill_attachment", supplierBill: normalized })
    expect(persisted.parsed_json.due_date).toBeNull()
  })

  it("keeps an uncertain document in review without bill lines", () => {
    const persisted = persistOpenAiResult({
      requestedKind: "unknown",
      supplierBill: bill({ document_type: "unknown", due_date: "2026-05-21" }),
    })
    expect(persisted.extraction_mode).toBe("unknown")
    expect(persisted.document_kind).toBe("unknown")
    expect(persisted.needs_review).toBe(true)
    expect(persisted.parsed_json.due_date).toBeNull()
    expect(persisted.parsed_json.line_items).toBeUndefined()
  })

  it("requires confirmation before replacing an accepted review", () => {
    expect(reextractRequiresConfirmation("accepted", { supplier_name: "Corrected" })).toBe(true)
    expect(reextractRequiresConfirmation("none", null)).toBe(false)
  })

  it("reuses a stored attachment for expense and bill handoff and skips a second upload", () => {
    expect(incomingHandoffSkipsUpload({ incomingDocumentId: "doc-1", storedPath: "incoming/biz/file.pdf" })).toBe(true)
    expect(incomingHandoffSkipsUpload({ incomingDocumentId: "doc-1", storedPath: null })).toBe(false)
    expect(incomingHandoffSkipsUpload({ incomingDocumentId: null, storedPath: "incoming/biz/file.pdf" })).toBe(false)
  })

  it("labels inbox states without exposing internal status names", () => {
    expect(inboxStatusLabel({ status: "extracting" })).toBe("Reading document…")
    expect(inboxStatusLabel({ status: "needs_review" })).toBe("Needs review")
    expect(inboxStatusLabel({ status: "reviewed", reviewStatus: "accepted" })).toBe("Ready")
    expect(inboxStatusLabel({ status: "extracted", linked: true })).toBe("Handled")
    expect(inboxStatusLabel({ status: "failed" })).toBe("Could not read")
  })

  it("records a failed OpenAI read without storing document text", async () => {
    const store = fakeStore({
      id: "doc-1",
      business_id: "biz-1",
      storage_bucket: "receipts",
      storage_path: "incoming/biz-1/receipt.jpg",
      status: "uploaded",
      document_kind: "expense_receipt",
      file_name: "receipt.jpg",
      mime_type: "image/jpeg",
      linked_entity_id: null,
      reviewed_fields: null,
    })
    const result = await runPersistedOpenAiExtraction({
      supabase: store.client as never,
      userId: "user-fail",
      businessId: "biz-1",
      existingDocumentId: "doc-1",
      extract: async () => {
        throw new ReceiptAiError("AI_UPSTREAM_ERROR", 502, "Could not read this document.")
      },
    })
    expect(result.ok).toBe(false)
    expect(store.documents[0].status).toBe("failed")
    expect(store.extractions[0].provider).toBe("openai")
    expect(store.extractions[0].raw_text).toBeNull()
    expect(store.uploads).toEqual([])
  })

  it("creates a new extraction and keeps accepted corrections", async () => {
    const store = fakeStore({
      id: "doc-1",
      business_id: "biz-1",
      storage_bucket: "receipts",
      storage_path: "incoming/biz-1/invoice.pdf",
      status: "reviewed",
      document_kind: "supplier_bill_attachment",
      file_name: "invoice.pdf",
      mime_type: "application/pdf",
      linked_entity_id: null,
      review_status: "accepted",
      reviewed_fields: { supplier_name: "Corrected supplier" },
    })
    const extract = async () => ({
      extraction: bill(),
      model: "gpt-6-luna",
      usage: null,
      requestId: "req-1",
    })
    const first = await runPersistedOpenAiExtraction({
      supabase: store.client as never,
      userId: "user-1",
      businessId: "biz-1",
      existingDocumentId: "doc-1",
      extract: extract as never,
    })
    const second = await runPersistedOpenAiExtraction({
      supabase: store.client as never,
      userId: "user-1",
      businessId: "biz-1",
      existingDocumentId: "doc-1",
      extract: extract as never,
    })
    expect(first.ok && second.ok).toBe(true)
    expect(store.extractions).toHaveLength(2)
    expect(store.documents[0].latest_extraction_id).toBe("ext-2")
    expect(store.documents[0].reviewed_fields).toEqual({ supplier_name: "Corrected supplier" })
    expect(store.extractions[1].raw_text).toBeNull()
    expect(store.uploads).toEqual([])
    expect(store.downloads).toHaveLength(2)
  })

  it("refuses a linked document and does not download it again", async () => {
    const store = fakeStore({
      id: "doc-1",
      business_id: "biz-1",
      storage_bucket: "receipts",
      storage_path: "incoming/biz-1/invoice.pdf",
      status: "linked",
      document_kind: "supplier_bill_attachment",
      file_name: "invoice.pdf",
      mime_type: "application/pdf",
      linked_entity_id: "bill-1",
      linked_entity_type: "bill",
    })
    const result = await runPersistedOpenAiExtraction({
      supabase: store.client as never,
      userId: "user-linked",
      businessId: "biz-1",
      existingDocumentId: "doc-1",
      extract: async () => {
        throw new Error("should not extract")
      },
    })
    expect(result).toMatchObject({ ok: false, httpStatus: 400 })
    expect(store.extractions).toHaveLength(0)
    expect(store.downloads).toEqual([])
  })

  it("does not load a document that belongs to another business", async () => {
    const store = fakeStore({
      id: "doc-1",
      business_id: "biz-1",
      storage_bucket: "receipts",
      storage_path: "incoming/biz-1/invoice.pdf",
      status: "uploaded",
      document_kind: "unknown",
      file_name: "invoice.pdf",
      mime_type: "application/pdf",
      linked_entity_id: null,
    })
    const result = await runPersistedOpenAiExtraction({
      supabase: store.client as never,
      userId: "user-other",
      businessId: "biz-2",
      existingDocumentId: "doc-1",
      extract: async () => {
        throw new Error("should not extract")
      },
    })
    expect(result).toMatchObject({ ok: false, httpStatus: 404 })
    expect(store.downloads).toEqual([])
    expect(store.documents[0].status).toBe("uploaded")
  })
})
