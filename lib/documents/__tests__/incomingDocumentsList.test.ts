import { describe, it, expect } from "@jest/globals"
import { parseIncomingDocumentsListQuery } from "../incomingDocumentsList"

function sp(entries: Record<string, string>): URLSearchParams {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(entries)) u.set(k, v)
  return u
}

describe("parseIncomingDocumentsListQuery", () => {
  it("requires business_id", () => {
    const r = parseIncomingDocumentsListQuery(sp({}))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/business_id/)
  })

  it("parses defaults", () => {
    const r = parseIncomingDocumentsListQuery(sp({ business_id: "b1" }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.params.businessId).toBe("b1")
    expect(r.params.limit).toBe(50)
    expect(r.params.offset).toBe(0)
    expect(r.params.linked).toBe("all")
    expect(r.params.sort).toBe("newest")
    expect(r.params.attentionOnly).toBe(false)
    expect(r.params.reviewedOnly).toBe(false)
  })

  it("parses status and review_status csv", () => {
    const r = parseIncomingDocumentsListQuery(
      sp({ business_id: "b", status: "failed,needs_review", review_status: "draft,accepted" })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.params.statusIn).toEqual(["failed", "needs_review"])
    expect(r.params.reviewStatusIn).toEqual(["draft", "accepted"])
  })

  it("rejects invalid status", () => {
    const r = parseIncomingDocumentsListQuery(sp({ business_id: "b", status: "not-a-status" }))
    expect(r.ok).toBe(false)
  })

  it("parses linked and document_kind", () => {
    const r = parseIncomingDocumentsListQuery(
      sp({ business_id: "b", linked: "unlinked", document_kind: "expense_receipt" })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.params.linked).toBe("unlinked")
    expect(r.params.documentKind).toBe("expense_receipt")
  })

  it("parses attention and reviewed flags", () => {
    const att = parseIncomingDocumentsListQuery(sp({ business_id: "b", attention: "1" }))
    expect(att.ok).toBe(true)
    if (!att.ok) return
    expect(att.params.attentionOnly).toBe(true)

    const rev = parseIncomingDocumentsListQuery(sp({ business_id: "b", reviewed: "true" }))
    expect(rev.ok).toBe(true)
    if (!rev.ok) return
    expect(rev.params.reviewedOnly).toBe(true)
  })

  it("rejects attention and reviewed together", () => {
    const r = parseIncomingDocumentsListQuery(sp({ business_id: "b", attention: "1", reviewed: "1" }))
    expect(r.ok).toBe(false)
  })

  it("clamps limit", () => {
    const r = parseIncomingDocumentsListQuery(sp({ business_id: "b", limit: "9999" }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.params.limit).toBe(100)
  })
})
