/**
 * Estimate create with material lines via shared draft helper path.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { createDraftEstimateForBusiness } from "@/lib/estimates/createDraftEstimateForBusiness"

describe("createDraftEstimateForBusiness — material lines", () => {
  const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const MATERIAL_ID = "m1111111-1111-4111-8111-111111111111"

  let estimateItemsInsert: jest.Mock

  beforeEach(() => {
    estimateItemsInsert = jest.fn(() => Promise.resolve({ data: [], error: null }))
  })

  function makeSupabase(materialRows: unknown[]) {
    return {
      from: jest.fn((table: string) => {
        if (table === "estimates") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            like: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                  data: { id: "est-new", business_id: BUSINESS_ID, estimate_number: "QUO-0001", status: "draft" },
                  error: null,
                }),
              })),
            })),
            delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({})) })),
          }
        }
        if (table === "businesses") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { address_country: "GH", default_currency: "GHS" },
              error: null,
            }),
          }
        }
        if (table === "products_services") {
          return {
            select: jest.fn(() => ({
              in: jest.fn().mockResolvedValue({ data: [], error: null }),
            })),
          }
        }
        if (table === "service_material_inventory") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockResolvedValue({ data: materialRows, error: null }),
          }
        }
        if (table === "service_material_movements") {
          throw new Error("estimate create must not touch material movements")
        }
        if (table === "estimate_items") {
          return {
            insert: jest.fn((rows: unknown) => {
              estimateItemsInsert(rows)
              return {
                select: jest.fn(() => Promise.resolve({ data: rows, error: null })),
              }
            }),
          }
        }
        return {}
      }),
    }
  }

  it("persists material line without stock side effects", async () => {
    const supabase = makeSupabase([
      {
        id: MATERIAL_ID,
        is_active: true,
        is_billable: true,
        default_selling_price: 450,
      },
    ])

    const result = await createDraftEstimateForBusiness({
      supabase: supabase as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      input: {
        customer_id: null,
        issue_date: "2025-12-31",
        items: [
          {
            material_id: MATERIAL_ID,
            description: "Premium paint",
            quantity: 1,
            price: 450,
            discount_amount: 0,
          },
        ],
        apply_taxes: false,
      },
      logEstimateCreatedAudit: false,
    })

    expect(result.ok).toBe(true)
    expect(estimateItemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        material_id: MATERIAL_ID,
        description: "Premium paint",
        price: 450,
      }),
    ])
    const inserted = estimateItemsInsert.mock.calls[0][0][0]
    expect(inserted).not.toHaveProperty("average_cost")
    expect(supabase.from).not.toHaveBeenCalledWith("service_material_movements")
  })

  it("rejects material from another business", async () => {
    const supabase = makeSupabase([])

    const result = await createDraftEstimateForBusiness({
      supabase: supabase as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      input: {
        customer_id: null,
        issue_date: "2025-12-31",
        items: [
          {
            material_id: MATERIAL_ID,
            description: "X",
            quantity: 1,
            price: 10,
          },
        ],
      },
      logEstimateCreatedAudit: false,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it("still accepts manual lines without material_id", async () => {
    const supabase = makeSupabase([])

    const result = await createDraftEstimateForBusiness({
      supabase: supabase as never,
      userId: "user-1",
      businessId: BUSINESS_ID,
      input: {
        customer_id: null,
        issue_date: "2025-12-31",
        items: [
          {
            description: "Consulting",
            quantity: 1,
            price: 100,
            discount_amount: 0,
          },
        ],
        apply_taxes: false,
      },
      logEstimateCreatedAudit: false,
    })

    expect(result.ok).toBe(true)
    expect(estimateItemsInsert).toHaveBeenCalled()
  })
})
