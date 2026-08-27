import { describe, it, expect } from "@jest/globals"
import {
  applyBillSupplierSelection,
  billSupplierSelectOptions,
  loadBillSuppliers,
  parseSupplierListResponse,
} from "../loadBillSuppliers"

const SUPPLIER_A = {
  id: "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Supplier A",
  phone: "0201",
  email: "a@t.test",
  status: "active",
}
const SUPPLIER_B = {
  id: "sbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Supplier B",
  phone: null,
  email: null,
  status: "blocked",
}

describe("parseSupplierListResponse", () => {
  it("maps the current { suppliers: [...] } contract", () => {
    const parsed = parseSupplierListResponse({ suppliers: [SUPPLIER_A, SUPPLIER_B] })
    expect(parsed).toEqual([SUPPLIER_A, SUPPLIER_B])
  })

  it("rejects an array body or { data: [...] }", () => {
    expect(parseSupplierListResponse([SUPPLIER_A])).toBeNull()
    expect(parseSupplierListResponse({ data: [SUPPLIER_A] })).toBeNull()
  })

  it("keeps an empty supplier list valid", () => {
    expect(parseSupplierListResponse({ suppliers: [] })).toEqual([])
  })
})

describe("billSupplierSelectOptions", () => {
  it("always includes the manual option plus existing suppliers", () => {
    const options = billSupplierSelectOptions([SUPPLIER_A, SUPPLIER_B])
    expect(options[0]).toEqual({ value: "", label: "Type manually (or select supplier)" })
    expect(options).toHaveLength(3)
    expect(options[1]).toEqual({ value: SUPPLIER_A.id, label: "Supplier A" })
    expect(options[2]).toEqual({ value: SUPPLIER_B.id, label: "Supplier B (blocked)" })
  })

  it("still allows manual mode when the list is empty", () => {
    expect(billSupplierSelectOptions([])).toEqual([
      { value: "", label: "Type manually (or select supplier)" },
    ])
  })
})

describe("applyBillSupplierSelection", () => {
  it("selecting a supplier updates supplier_id and hydrates details", () => {
    const result = applyBillSupplierSelection(SUPPLIER_A.id, [SUPPLIER_A, SUPPLIER_B])
    expect(result.supplier_id).toBe(SUPPLIER_A.id)
    expect(result.hydrate).toEqual({
      name: "Supplier A",
      phone: "0201",
      email: "a@t.test",
    })
  })

  it("manual option produces null supplier_id", () => {
    const result = applyBillSupplierSelection("", [SUPPLIER_A])
    expect(result.supplier_id).toBeNull()
    expect(result.hydrate).toBeNull()
  })

  it("never includes a cross-tenant supplier in options", () => {
    const other = {
      id: "sfffffff-ffff-4fff-8fff-ffffffffffff",
      name: "Other Biz",
      phone: null,
      email: null,
      status: "active",
    }
    const options = billSupplierSelectOptions([SUPPLIER_A])
    expect(options.some((option) => option.value === other.id)).toBe(false)
  })
})

describe("loadBillSuppliers", () => {
  it("loads suppliers for the selected business", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/suppliers?business_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
      return new Response(JSON.stringify({ suppliers: [SUPPLIER_A] }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await loadBillSuppliers("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fetchImpl)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.suppliers).toEqual([SUPPLIER_A])
  })

  it("does not crash the form when the supplier API errors", async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }) as unknown as typeof fetch

    const result = await loadBillSuppliers("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", fetchImpl)
    expect(result).toEqual({
      ok: false,
      error: "Unauthorized",
      suppliers: [],
    })
  })

  it("surfaces a wrong response shape instead of pretending the list is empty", async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(JSON.stringify({ data: [SUPPLIER_A] }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await loadBillSuppliers("biz", fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Could not load suppliers/)
  })
})
