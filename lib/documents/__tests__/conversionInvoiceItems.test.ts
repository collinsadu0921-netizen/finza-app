import { describe, it, expect } from "@jest/globals"
import {
  buildConversionInvoiceItems,
  mapConversionSourceLineToInvoiceInput,
} from "../documentLineMaterials"

describe("conversion invoice items", () => {
  const MATERIAL_ID = "m1111111-1111-4111-8111-111111111111"
  const PRODUCT_ID = "p1111111-1111-4111-8111-111111111111"

  it("maps quote line with material_id and clears product_service_id on invoice row", () => {
    const rows = buildConversionInvoiceItems(
      "inv-1",
      [
        {
          material_id: MATERIAL_ID,
          product_service_id: PRODUCT_ID,
          description: "Premium paint",
          quantity: 2,
          price: 450,
          total: 900,
        },
      ],
      new Set([PRODUCT_ID]),
      new Set([MATERIAL_ID])
    )

    expect(rows[0]).toMatchObject({
      invoice_id: "inv-1",
      material_id: MATERIAL_ID,
      product_service_id: null,
      description: "Premium paint",
      qty: 2,
      unit_price: 450,
      line_subtotal: 900,
    })
    expect(rows[0]).not.toHaveProperty("average_cost")
  })

  it("maps proforma line without material_id as before", () => {
    const input = mapConversionSourceLineToInvoiceInput({
      description: "Consulting",
      qty: 1,
      unit_price: 100,
      discount_amount: 0,
    })

    const rows = buildConversionInvoiceItems(
      "inv-2",
      [input],
      new Set(),
      new Set()
    )

    expect(rows[0]).toMatchObject({
      material_id: null,
      description: "Consulting",
      unit_price: 100,
    })
  })
})
