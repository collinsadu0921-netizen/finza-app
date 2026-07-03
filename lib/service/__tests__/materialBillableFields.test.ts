import {
  materialSalesDisplayName,
  materialSalesLineDescription,
  parseMaterialBillableFields,
} from "../materialBillableFields"

describe("parseMaterialBillableFields", () => {
  it("defaults is_billable to false", () => {
    const r = parseMaterialBillableFields({})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.is_billable).toBe(false)
      expect(r.fields.default_selling_price).toBeNull()
    }
  })

  it("requires default_selling_price when billable", () => {
    const r = parseMaterialBillableFields({ is_billable: true, sales_unit: "pcs" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/default_selling_price/)
  })

  it("accepts billable material with price and unit", () => {
    const r = parseMaterialBillableFields(
      {
        is_billable: true,
        default_selling_price: 49.5,
        sales_description: "Premium cable",
        sales_tax_code: "VAT",
      },
      { stockUnit: "m" }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.is_billable).toBe(true)
      expect(r.fields.default_selling_price).toBe(49.5)
      expect(r.fields.sales_unit).toBe("m")
      expect(r.fields.sales_tax_code).toBe("VAT")
    }
  })

  it("rejects negative selling price", () => {
    const r = parseMaterialBillableFields({
      is_billable: true,
      default_selling_price: -1,
      sales_unit: "ea",
    })
    expect(r.ok).toBe(false)
  })
})

describe("materialSalesDisplayName", () => {
  it("prefers sales_name over inventory name", () => {
    expect(materialSalesDisplayName({ name: "SKU-1", sales_name: "Customer Cable" })).toBe("Customer Cable")
  })

  it("falls back to inventory name", () => {
    expect(materialSalesDisplayName({ name: "SKU-1", sales_name: null })).toBe("SKU-1")
  })
})

describe("materialSalesLineDescription", () => {
  it("prefers sales_description", () => {
    expect(
      materialSalesLineDescription({
        name: "Internal",
        sales_description: "12mm copper pipe per metre",
      })
    ).toBe("12mm copper pipe per metre")
  })
})
