import {
  computeWeightedAverageCost,
  materialSalesDisplayName,
  materialSalesLineDescription,
  parseMaterialFormInput,
} from "../materialFormFields"
import {
  isValidStockInReason,
  isValidStockOutReason,
  movementActionLabel,
  movementReasonLabel,
  stockOutMovementType,
  stockStatusLabel,
} from "../materialMovementLabels"

describe("parseMaterialFormInput", () => {
  it("allows price-only material with zero quantity", () => {
    const r = parseMaterialFormInput({
      name: "AC gas",
      unit: "cylinder",
      selling_price: 500,
      quantity_available: 0,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.quantity_on_hand).toBe(0)
      expect(r.fields.default_selling_price).toBe(500)
      expect(r.fields.is_billable).toBe(true)
      expect(r.fields.default_cost_price).toBeNull()
      expect(r.fields.average_cost).toBe(0)
      expect(r.fields.warnings).toHaveLength(0)
    }
  })

  it("sets average cost from cost price when quantity and cost provided", () => {
    const r = parseMaterialFormInput({
      name: "Paint",
      unit: "bucket",
      cost_price: 300,
      selling_price: 450,
      quantity_available: 10,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.average_cost).toBe(300)
      expect(r.fields.default_cost_price).toBe(300)
      expect(r.fields.default_selling_price).toBe(450)
      expect(r.fields.is_billable).toBe(true)
    }
  })

  it("warns when quantity without cost price", () => {
    const r = parseMaterialFormInput({
      name: "Paint",
      unit: "bucket",
      quantity_available: 5,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.warnings[0]).toMatch(/Cost price is missing/)
      expect(r.fields.average_cost).toBe(0)
    }
  })

  it("infers not billable when selling price blank", () => {
    const r = parseMaterialFormInput({
      name: "Wire",
      unit: "m",
      cost_price: 10,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.fields.is_billable).toBe(false)
      expect(r.fields.default_selling_price).toBeNull()
    }
  })

  it("rejects negative selling price", () => {
    const r = parseMaterialFormInput({
      name: "X",
      unit: "ea",
      selling_price: -1,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative quantity", () => {
    const r = parseMaterialFormInput({
      name: "X",
      unit: "ea",
      quantity_available: -1,
    })
    expect(r.ok).toBe(false)
  })
})

describe("computeWeightedAverageCost", () => {
  it("updates weighted average on add", () => {
    expect(computeWeightedAverageCost(10, 300, 5, 320)).toBeCloseTo(306.666, 2)
  })

  it("keeps average when unit cost omitted", () => {
    expect(computeWeightedAverageCost(10, 300, 5, null)).toBe(300)
  })
})

describe("movement labels", () => {
  it("maps stock_in to Added", () => {
    expect(movementActionLabel("stock_in", "bought_material")).toBe("Added")
  })

  it("maps job_usage to Used", () => {
    expect(movementActionLabel("job_usage")).toBe("Used")
  })

  it("maps reason codes", () => {
    expect(movementReasonLabel("used_for_job")).toBe("Used for job")
  })
})

describe("stockStatusLabel", () => {
  it("shows no stock", () => {
    expect(stockStatusLabel({ quantity_on_hand: 0, reorder_level: 5, is_active: true }).label).toBe("No stock")
  })

  it("shows low stock", () => {
    expect(stockStatusLabel({ quantity_on_hand: 3, reorder_level: 5, is_active: true }).label).toBe("Low stock")
  })
})

describe("reason validators", () => {
  it("validates stock in reasons", () => {
    expect(isValidStockInReason("bought_material")).toBe(true)
    expect(isValidStockInReason("invalid")).toBe(false)
  })

  it("maps stock out movement types", () => {
    expect(stockOutMovementType("returned_to_supplier")).toBe("supplier_return")
    expect(stockOutMovementType("damaged_lost")).toBe("write_off")
    expect(stockOutMovementType("used_for_job")).toBe("stock_out")
  })
})

describe("materialSalesLineDescription", () => {
  it("prefers sales_description", () => {
    expect(
      materialSalesLineDescription({
        name: "Internal",
        sales_description: "Customer line text",
      })
    ).toBe("Customer line text")
  })

  it("display name fallback", () => {
    expect(materialSalesDisplayName({ name: "Pipe", sales_name: null })).toBe("Pipe")
  })
})
