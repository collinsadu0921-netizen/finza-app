/**
 * Ensures list summaries surface email-origin context for the workspace.
 */

import { describe, it, expect } from "@jest/globals"
import {
  listIncomingDocumentSummaries,
  type ListIncomingDocumentsParams,
} from "@/lib/documents/incomingDocumentsList"

const baseParams: ListIncomingDocumentsParams = {
  businessId: "b1",
  limit: 50,
  offset: 0,
  statusIn: null,
  reviewStatusIn: null,
  documentKind: null,
  linked: "all",
  search: null,
  attentionOnly: false,
  reviewedOnly: false,
  sort: "newest",
}

function buildListMock(docRow: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.order = () => chain
  chain.range = async () => ({ data: [docRow], error: null, count: 1 })
  return {
    from: (table: string) => {
      if (table === "incoming_documents") return chain
      if (table === "incoming_document_extractions") {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }
      }
      return {}
    },
  }
}

describe("listIncomingDocumentSummaries — email fields", () => {
  it("maps source_email_sender and source_email_subject into summaries", async () => {
    const docRow = {
      id: "d1",
      file_name: "scan.pdf",
      document_kind: "unknown",
      status: "extracted",
      review_status: "none",
      source_type: "email_inbound",
      source_email_sender: "vendor@example.com",
      source_email_subject: "Invoice attached",
      storage_path: "inbound-email/b1/m1/a_scan.pdf",
      linked_entity_type: null,
      linked_entity_id: null,
      latest_extraction_id: null,
      created_at: "2026-01-01T00:00:00Z",
      mime_type: "application/pdf",
    }
    const supabase = buildListMock(docRow) as never
    const { summaries } = await listIncomingDocumentSummaries(supabase, baseParams)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].source_type).toBe("email_inbound")
    expect(summaries[0].source_email_sender).toBe("vendor@example.com")
    expect(summaries[0].source_email_subject).toBe("Invoice attached")
  })
})
