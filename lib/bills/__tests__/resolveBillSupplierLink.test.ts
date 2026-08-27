import { describe, it, expect } from "@jest/globals"
import {
  billSupplierIdPayload,
  hydrateBillSupplierSelection,
  resolveBillSupplierLink,
} from "../resolveBillSupplierLink"

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SUP = "s1111111-1111-4111-8111-111111111111"

function mockSupabase(row: { id: string; name: string; phone: string | null; email: string | null } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    }),
  }
}

describe("resolveBillSupplierLink", () => {
  it("treats empty supplier as optional null", async () => {
    const r = await resolveBillSupplierLink(mockSupabase(null), BIZ, "")
    expect(r).toEqual({ ok: true, supplier_id: null, name: null, phone: null, email: null })
  })

  it("returns the tenant-scoped supplier", async () => {
    const r = await resolveBillSupplierLink(
      mockSupabase({ id: SUP, name: "Acme", phone: "020", email: "a@b.com" }),
      BIZ,
      SUP
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.supplier_id).toBe(SUP)
      expect(r.name).toBe("Acme")
    }
  })

  it("hydrates the edit form from a stored supplier_id", () => {
    expect(hydrateBillSupplierSelection("saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    )
    expect(hydrateBillSupplierSelection(null)).toBe("")
    expect(billSupplierIdPayload("saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    )
    expect(billSupplierIdPayload("")).toBeNull()
  })

  it("rejects a supplier that is not in the business", async () => {
    const r = await resolveBillSupplierLink(mockSupabase(null), BIZ, SUP)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toMatch(/not found for this business/)
    }
  })
})
