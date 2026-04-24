import { describe, it, expect, jest } from "@jest/globals"
import { linkIncomingDocumentToEntity } from "../incomingDocumentsService"
import type { SupabaseClient } from "@supabase/supabase-js"

describe("linkIncomingDocumentToEntity", () => {
  it("rejects when storage paths differ", async () => {
    const supabase = {} as SupabaseClient
    const res = await linkIncomingDocumentToEntity(supabase, {
      documentId: "d1",
      businessId: "b1",
      linkedEntityType: "expense",
      linkedEntityId: "e1",
      expectedStoragePath: "expenses/b/a.jpg",
      actualFilePath: "expenses/b/b.jpg",
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("does not match")
  })

  it("allows link when paths match", async () => {
    const maybeSingle = jest.fn(() =>
      Promise.resolve({
        data: {
          id: "d1",
          linked_entity_id: null,
          linked_entity_type: null,
          storage_path: "expenses/b/a.jpg",
        },
        error: null,
      })
    )
    const update = jest.fn(() => ({
      eq: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
    }))
    const from = jest.fn((table: string) => {
      if (table === "incoming_documents") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle,
              }),
            }),
          }),
          update,
        }
      }
      return {}
    })
    const supabase = { from } as unknown as SupabaseClient

    const res = await linkIncomingDocumentToEntity(supabase, {
      documentId: "d1",
      businessId: "b1",
      linkedEntityType: "expense",
      linkedEntityId: "e1",
      expectedStoragePath: "expenses/b/a.jpg",
      actualFilePath: "expenses/b/a.jpg",
    })
    expect(res.ok).toBe(true)
    expect(from).toHaveBeenCalledWith("incoming_documents")
  })
})
