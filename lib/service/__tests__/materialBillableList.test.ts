import {
  isBillableMaterialRow,
  mapBillableMaterialRow,
  mapBillableMaterialRows,
  parseBillableListLimit,
  sanitizeBillableListSearchQuery,
} from "../materialBillableList"

describe("materialBillableList", () => {
  const baseRow = {
    id: "a1111111-1111-4111-8111-111111111111",
    name: "Internal pipe",
    unit: "m",
    default_selling_price: 40,
    quantity_on_hand: 100,
    is_active: true,
    is_billable: true,
  }

  it("includes only active billable materials with selling price", () => {
    expect(isBillableMaterialRow(baseRow)).toBe(true)
    expect(isBillableMaterialRow({ ...baseRow, is_active: false })).toBe(false)
    expect(isBillableMaterialRow({ ...baseRow, is_billable: false })).toBe(false)
    expect(isBillableMaterialRow({ ...baseRow, default_selling_price: null })).toBe(false)
  })

  it("maps sales fields when present", () => {
    const item = mapBillableMaterialRow({
      ...baseRow,
      sales_name: "Customer Copper Pipe",
      sales_description: "12mm copper pipe for plumbing work",
      sales_unit: "metre",
      sales_tax_code: "standard",
    })
    expect(item.name).toBe("Customer Copper Pipe")
    expect(item.description).toBe("12mm copper pipe for plumbing work")
    expect(item.unit).toBe("metre")
    expect(item.sellingPrice).toBe(40)
    expect(item.taxCode).toBe("standard")
    expect(item.quantityAvailable).toBe(100)
  })

  it("falls back to inventory name and unit", () => {
    const item = mapBillableMaterialRow(baseRow)
    expect(item.name).toBe("Internal pipe")
    expect(item.description).toBe("Internal pipe")
    expect(item.unit).toBe("m")
    expect(item.taxCode).toBeNull()
  })

  it("does not expose cost fields on mapped item", () => {
    const item = mapBillableMaterialRow({
      ...baseRow,
      average_cost: 25,
      default_cost_price: 20,
    } as typeof baseRow & { average_cost: number; default_cost_price: number })
    expect(item).not.toHaveProperty("average_cost")
    expect(item).not.toHaveProperty("default_cost_price")
    expect(item).not.toHaveProperty("sales_notes")
  })

  it("filters rows in mapBillableMaterialRows", () => {
    const out = mapBillableMaterialRows([
      baseRow,
      { ...baseRow, id: "b2222222-2222-4222-8222-222222222222", default_selling_price: null },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(baseRow.id)
  })

  it("sanitizes search query", () => {
    expect(sanitizeBillableListSearchQuery("  paint%  ")).toBe("paint")
  })

  it("parses limit with cap", () => {
    expect(parseBillableListLimit(null)).toBe(50)
    expect(parseBillableListLimit("200")).toBe(100)
    expect(parseBillableListLimit("0")).toBe(50)
  })
})
