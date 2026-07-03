import { describe, it, expect, jest } from "@jest/globals"
import {
  mapInvoiceItemsForInsert,
  validateInvoiceLineMaterials,
} from "../validateInvoiceLineMaterials"

describe("validateInvoiceLineMaterials", () => {
  const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const materialId = "m1111111-1111-4111-8111-111111111111"

  it("accepts billable materials for the business", async () => {
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

    const result = await validateInvoiceLineMaterials(
      supabase as never,
      businessId,
      [{ material_id: materialId }]
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.validMaterialIds.has(materialId)).toBe(true)
    }
  })

  it("rejects material from another business", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      })),
    }

    const result = await validateInvoiceLineMaterials(
      supabase as never,
      businessId,
      [{ material_id: materialId }]
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
    }
  })

  it("rejects inactive or non-billable material", async () => {
    const supabase = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [
            {
              id: materialId,
              is_active: false,
              is_billable: true,
              default_selling_price: 450,
            },
          ],
          error: null,
        }),
      })),
    }

    const result = await validateInvoiceLineMaterials(
      supabase as never,
      businessId,
      [{ material_id: materialId }]
    )
    expect(result.ok).toBe(false)
  })
})

describe("mapInvoiceItemsForInsert", () => {
  const invoiceId = "inv-1111-1111-1111-111111111111"
  const materialId = "m1111111-1111-4111-8111-111111111111"
  const productId = "p1111111-1111-4111-8111-111111111111"

  it("snapshots material line and clears product_service_id", () => {
    const rows = mapInvoiceItemsForInsert(
      invoiceId,
      [
        {
          material_id: materialId,
          product_service_id: productId,
          description: "Premium paint",
          qty: 2,
          unit_price: 450,
          discount_amount: 0,
        },
      ],
      new Set([productId]),
      new Set([materialId])
    )
    expect(rows[0]).toMatchObject({
      invoice_id: invoiceId,
      material_id: materialId,
      product_service_id: null,
      description: "Premium paint",
      qty: 2,
      unit_price: 450,
    })
    expect(rows[0]).not.toHaveProperty("average_cost")
  })

  it("keeps manual/service lines unchanged", () => {
    const rows = mapInvoiceItemsForInsert(
      invoiceId,
      [
        {
          product_service_id: productId,
          description: "Consulting",
          qty: 1,
          unit_price: 100,
          discount_amount: 0,
        },
      ],
      new Set([productId]),
      new Set()
    )
    expect(rows[0].material_id).toBeNull()
    expect(rows[0].product_service_id).toBe(productId)
  })
})
