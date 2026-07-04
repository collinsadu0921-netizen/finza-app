/**
 * Quote → Invoice conversion preserves material_id — no stock side effects.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST } from "../[id]/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  requireBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireBusinessScopeForUser } from "@/lib/business"

const MATERIAL_ID = "m1111111-1111-4111-8111-111111111111"
const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ESTIMATE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

describe("POST /api/estimates/convert/[id] — material_id", () => {
  let invoiceItemsInsert: jest.Mock
  let fromMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    invoiceItemsInsert = jest.fn(() => Promise.resolve({ error: null }))

    jest.mocked(requireBusinessScopeForUser).mockResolvedValue({
      ok: true,
      businessId: BUSINESS_ID,
    } as never)

    fromMock = jest.fn((table: string) => {
      if (table === "estimates") {
        const chain: Record<string, jest.Mock> = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.is = jest.fn(() => chain)
        chain.single = jest.fn(() =>
          Promise.resolve({
            data: {
              id: ESTIMATE_ID,
              business_id: BUSINESS_ID,
              customer_id: null,
              issue_date: "2025-12-31",
              expiry_date: null,
              subtotal: 450,
              total_amount: 450,
              notes: null,
              estimate_number: "QUO-0001",
            },
            error: null,
          })
        )
        chain.update = jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({})) })) }))
        return chain
      }
      if (table === "estimate_items") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() =>
                Promise.resolve({
                  data: [
                    {
                      material_id: MATERIAL_ID,
                      description: "Premium paint",
                      quantity: 1,
                      price: 450,
                      total: 450,
                      discount_amount: 0,
                    },
                  ],
                  error: null,
                })
              ),
            })),
          })),
        }
      }
      if (table === "service_material_inventory") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [
              {
                id: MATERIAL_ID,
                is_active: true,
                is_billable: true,
                default_selling_price: 450,
              },
            ],
            error: null,
          }),
        }
      }
      if (table === "service_material_movements") {
        throw new Error("quote conversion must not touch material movements")
      }
      if (table === "products_services") {
        return {
          select: jest.fn(() => ({
            in: jest.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      if (table === "invoices") {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({ data: { id: "inv-new" }, error: null })
              ),
            })),
          })),
          delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({})) })),
        }
      }
      if (table === "invoice_items") {
        return { insert: invoiceItemsInsert }
      }
      return {}
    })

    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: fromMock,
    } as never)
  })

  it("copies material_id onto invoice items without stock side effects", async () => {
    const res = await POST(
      new NextRequest(`http://localhost/api/estimates/convert/${ESTIMATE_ID}`, {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_ID }),
      }),
      { params: Promise.resolve({ id: ESTIMATE_ID }) }
    )

    expect(res.status).toBe(200)
    expect(invoiceItemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        material_id: MATERIAL_ID,
        product_service_id: null,
        description: "Premium paint",
        unit_price: 450,
      }),
    ])
    expect(fromMock).not.toHaveBeenCalledWith("service_material_movements")
  })

  it("still converts manual lines without material_id", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        if (table === "estimates") {
          const chain: Record<string, jest.Mock> = {}
          chain.select = jest.fn(() => chain)
          chain.eq = jest.fn(() => chain)
          chain.is = jest.fn(() => chain)
          chain.single = jest.fn(() =>
            Promise.resolve({
              data: {
                id: ESTIMATE_ID,
                business_id: BUSINESS_ID,
                customer_id: null,
                issue_date: "2025-12-31",
                subtotal: 100,
                total_amount: 100,
              },
              error: null,
            })
          )
          chain.update = jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({})) })) }))
          return chain
        }
        if (table === "estimate_items") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() =>
                  Promise.resolve({
                    data: [
                      {
                        description: "Consulting",
                        quantity: 1,
                        price: 100,
                        total: 100,
                        discount_amount: 0,
                      },
                    ],
                    error: null,
                  })
                ),
              })),
            })),
          }
        }
        if (table === "invoices") {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: { id: "inv-new" }, error: null })
                ),
              })),
            })),
          }
        }
        if (table === "invoice_items") {
          return { insert: invoiceItemsInsert }
        }
        if (table === "products_services") {
          return {
            select: jest.fn(() => ({
              in: jest.fn().mockResolvedValue({ data: [], error: null }),
            })),
          }
        }
        return {}
      }),
    } as never)

    const res = await POST(
      new NextRequest(`http://localhost/api/estimates/convert/${ESTIMATE_ID}`, {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_ID }),
      }),
      { params: Promise.resolve({ id: ESTIMATE_ID }) }
    )

    expect(res.status).toBe(200)
    expect(invoiceItemsInsert.mock.calls[0][0][0].material_id).toBeFalsy()
  })
})
