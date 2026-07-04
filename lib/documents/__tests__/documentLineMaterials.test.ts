import { describe, it, expect, jest } from "@jest/globals"
import {
  mapEstimateItemsForInsert,
  mapProformaItemsForInsert,
  validateDocumentLineMaterials,
} from "../documentLineMaterials"

describe("documentLineMaterials", () => {
  const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const materialId = "m1111111-1111-4111-8111-111111111111"
  const productId = "p1111111-1111-4111-8111-111111111111"

  it("validates billable materials for the tenant", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            {
              id: materialId,
              is_active: true,
              is_billable: true,
              default_selling_price: 450,
            },
          ],
          error: null,
        }),
      })),
    }

    const result = await validateDocumentLineMaterials(
      supabase as never,
      businessId,
      [{ material_id: materialId }]
    )
    expect(result.ok).toBe(true)
  })

  it("maps estimate material line without product_service_id", () => {
    const rows = mapEstimateItemsForInsert(
      "est-1",
      [
        {
          material_id: materialId,
          product_service_id: productId,
          description: "Premium paint",
          quantity: 2,
          price: 450,
          discount_amount: 0,
        },
      ],
      new Set([productId]),
      new Set([materialId])
    )
    expect(rows[0]).toMatchObject({
      material_id: materialId,
      description: "Premium paint",
      quantity: 2,
      price: 450,
    })
    expect(rows[0].product_service_id).toBeUndefined()
    expect(rows[0]).not.toHaveProperty("average_cost")
  })

  it("maps proforma material line", () => {
    const rows = mapProformaItemsForInsert(
      "pf-1",
      [
        {
          material_id: materialId,
          description: "Copper pipe",
          qty: 1,
          unit_price: 40,
          discount_amount: 0,
        },
      ],
      new Set(),
      new Set([materialId])
    )
    expect(rows[0]).toMatchObject({
      material_id: materialId,
      product_service_id: null,
      unit_price: 40,
    })
  })
})
