import { describe, expect, it } from "@jest/globals"
import { selectCreatedBillSupplier } from "../selectCreatedBillSupplier"

const A = {
  id: "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Supplier A",
  phone: "0201",
  email: "a@t.test",
  status: "active",
}
const C = {
  id: "sccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Supplier C",
  phone: "0300",
  email: "c@t.test",
  status: "active",
}

describe("selectCreatedBillSupplier", () => {
  it("adds the new supplier and auto-selects it", () => {
    const result = selectCreatedBillSupplier(C, [A])
    expect(result.selectedId).toBe(C.id)
    expect(result.supplier_id).toBe(C.id)
    expect(result.hydrate).toEqual({ name: "Supplier C", phone: "0300", email: "c@t.test" })
    expect(result.suppliers.map((s) => s.id)).toEqual([A.id, C.id])
  })

  it("does not create a duplicate list row for the same id", () => {
    const result = selectCreatedBillSupplier(C, [A, C])
    expect(result.suppliers.filter((s) => s.id === C.id)).toHaveLength(1)
    expect(result.selectedId).toBe(C.id)
  })
})
