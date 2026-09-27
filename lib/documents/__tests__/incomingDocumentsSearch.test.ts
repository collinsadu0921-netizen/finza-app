import { describe, it, expect } from "@jest/globals"
import {
  extractionFieldSearchFilter,
  incomingDocumentSearchFilter,
  listIncomingDocumentSummaries,
  sanitizeIncomingDocumentSearch,
  type ListIncomingDocumentsParams,
} from "@/lib/documents/incomingDocumentsList"

const params = (search: string): ListIncomingDocumentsParams => ({
  businessId: "biz-1",
  limit: 50,
  offset: 0,
  statusIn: null,
  reviewStatusIn: null,
  documentKind: null,
  sourceType: null,
  createdFrom: null,
  createdTo: null,
  linked: "all",
  search,
  attentionOnly: false,
  reviewedOnly: false,
  sort: "newest",
})

const doc = {
  id: "11111111-1111-4111-8111-111111111111",
  file_name: "upload.pdf",
  document_kind: "supplier_bill_attachment",
  status: "extracted",
  review_status: "none",
  source_type: "manual_upload",
  source_email_sender: "billing@example.com",
  source_email_subject: "July invoice",
  inbound_email_message_id: "22222222-2222-4222-8222-222222222222",
  storage_path: "incoming/biz-1/upload.pdf",
  linked_entity_type: null,
  linked_entity_id: null,
  latest_extraction_id: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-04-21T00:00:00Z",
  mime_type: "application/pdf",
}

function mockSearch(extractionIds: Array<{ id: string }>) {
  const filters: string[] = []
  const businessIds: string[] = []
  return {
    filters,
    businessIds,
    client: {
      from(table: string) {
        if (table === "incoming_document_extractions") {
          return {
            select() {
              return {
                eq(_column: string, value: string) {
                  businessIds.push(value)
                  return {
                    or(filter: string) {
                      filters.push(filter)
                      return { limit: async () => ({ data: extractionIds, error: null }) }
                    },
                  }
                },
                in: async () => ({
                  data: [{
                    id: "33333333-3333-4333-8333-333333333333",
                    extraction_mode: "supplier_bill",
                    page_count: 1,
                    extraction_warnings: [],
                    status: "succeeded",
                    error_message: null,
                    parsed_json: { supplier_name: "Golden hands services Ltd", document_number: "INV-000018" },
                  }],
                  error: null,
                }),
              }
            },
          }
        }
        if (table === "inbound_email_messages") {
          return {
            select() {
              return {
                eq() {
                  return {
                    in: async () => ({ data: [{ id: doc.inbound_email_message_id, received_at: "2026-04-21T09:30:00.000Z" }], error: null }),
                  }
                },
              }
            },
          }
        }
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.order = () => chain
        chain.or = (filter: string) => {
          filters.push(filter)
          return chain
        }
        chain.range = async () => ({ data: [doc], error: null, count: 1 })
        return chain
      },
    },
  }
}

describe("incoming document search", () => {
  it("searches extracted supplier and document number inside the same business", async () => {
    const extractionId = "33333333-3333-4333-8333-333333333333"
    const supplier = mockSearch([{ id: extractionId }])
    const found = await listIncomingDocumentSummaries(supplier.client as never, params("Golden Hands"))
    expect(supplier.businessIds).toEqual(["biz-1"])
    expect(supplier.filters[0]).toContain("parsed_json->>supplier_name.ilike")
    expect(supplier.filters[0]).toContain("parsed_json->>document_number.ilike")
    expect(supplier.filters[1]).toContain(`latest_extraction_id.in.(${extractionId})`)
    expect(supplier.filters[1]).toContain("source_email_sender.ilike")
    expect(supplier.filters[1]).toContain("source_email_subject.ilike")
    expect(found.summaries[0].supplier_name).toBe("Golden hands services Ltd")
    expect(found.summaries[0].document_number).toBe("INV-000018")
    expect(found.summaries[0].email_received_at).toBe("2026-04-21T09:30:00.000Z")
  })

  it("still searches sender and subject when no extracted field matches", async () => {
    const sender = mockSearch([])
    await listIncomingDocumentSummaries(sender.client as never, params("billing@example.com"))
    expect(sender.filters[1]).toContain("source_email_sender.ilike")
    expect(sender.filters[1]).toContain("source_email_subject.ilike")
    expect(sender.filters[1]).toContain("file_name.ilike")
    expect(sender.filters[1]).not.toContain("latest_extraction_id.in")
  })

  it("builds a document-number filter without dropping filename search", () => {
    const safe = sanitizeIncomingDocumentSearch("INV-000018")
    expect(safe).toBe("INV-000018")
    expect(extractionFieldSearchFilter(safe!)).toContain('parsed_json->>document_number.ilike."%INV-000018%"')
    expect(incomingDocumentSearchFilter(safe!, ["33333333-3333-4333-8333-333333333333"])).toContain("file_name.ilike")
  })
})
