import { describe, expect, it } from "@jest/globals"
import { createSupplierRecord, parseSupplierRecord } from "../createSupplier"

const SUPPLIER = {
  id: "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  business_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Supplier C",
  phone: "0201",
  email: "c@t.test",
  location_line: "Accra",
  tax_id: "C123",
  status: "active",
}

describe("parseSupplierRecord", () => {
  it("maps existing schema fields only", () => {
    expect(parseSupplierRecord(SUPPLIER)).toEqual(SUPPLIER)
  })

  it("rejects a row without an id or name", () => {
    expect(parseSupplierRecord({ business_id: SUPPLIER.business_id, name: "X" })).toBeNull()
  })
})

describe("createSupplierRecord", () => {
  it("requires a name before calling the API", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch
    const result = await createSupplierRecord(SUPPLIER.business_id, { name: "  " }, fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/name is required/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts the selected business_id", async () => {
    const fetchImpl = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toBe("/api/suppliers")
      expect(init?.method).toBe("POST")
      const body = JSON.parse(String(init?.body))
      expect(body.business_id).toBe(SUPPLIER.business_id)
      expect(body.name).toBe("Supplier C")
      return new Response(JSON.stringify({ success: true, supplier: SUPPLIER, name_matches: [] }), {
        status: 201,
      })
    }) as unknown as typeof fetch

    const result = await createSupplierRecord(SUPPLIER.business_id, { name: "Supplier C" }, fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.supplier.id).toBe(SUPPLIER.id)
  })

  it("surfaces a forged-business denial", async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    }) as unknown as typeof fetch
    const result = await createSupplierRecord("cccccccc-cccc-4ccc-8ccc-cccccccccccc", { name: "X" }, fetchImpl)
    expect(result).toEqual({ ok: false, error: "Forbidden", status: 403 })
  })
})
