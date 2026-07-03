/**
 * Invoice create with material lines — no stock/COGS side effects.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST } from "../create/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
}))
jest.mock("@/lib/countryCurrency", () => ({
  assertCountryCurrency: jest.fn(() => {}),
}))
jest.mock("@/lib/taxEngine/helpers", () => ({
  getTaxEngineCode: jest.fn(() => "ghana"),
  deriveLegacyTaxColumnsFromTaxLines: jest.fn(() => ({
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
  })),
  getCanonicalTaxResultFromLineItems: jest.fn(() => ({
    base_amount: 450,
    total_tax: 0,
    total_amount: 450,
    pricing_mode: "inclusive",
    lines: [],
    meta: { jurisdiction: "GH", effective_date_used: "2025-12-31", engine_version: "GH-2025-A" },
  })),
}))
jest.mock("@/lib/taxEngine/serialize", () => ({
  toTaxLinesJsonb: jest.fn((r: unknown) => r),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/growth/recordBusinessActivationEvent", () => ({
  voidRecordBusinessActivationEvent: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const MATERIAL_ID = "m1111111-1111-4111-8111-111111111111"
const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

describe("POST /api/invoices/create — material lines", () => {
  let invoiceItemsInsert: jest.Mock
  let fromMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    invoiceItemsInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))

    fromMock = jest.fn((table: string) => {
      if (table === "businesses") {
        const chain: Record<string, jest.Mock> = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.is = jest.fn(() => chain)
        chain.order = jest.fn(() => chain)
        chain.limit = jest.fn(() => chain)
        chain.single = jest.fn(() =>
          Promise.resolve({
            data: {
              id: BUSINESS_ID,
              address_country: "GH",
              default_currency: "GHS",
              owner_id: "user-1",
              archived_at: null,
            },
            error: null,
          })
        )
        chain.maybeSingle = jest.fn(() =>
          Promise.resolve({
            data: {
              id: BUSINESS_ID,
              address_country: "GH",
              default_currency: "GHS",
              owner_id: "user-1",
              archived_at: null,
            },
            error: null,
          })
        )
        return chain
      }
      if (table === "invoice_settings") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        }
      }
      if (table === "invoices") {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: { id: "inv-new", status: "draft" },
                  error: null,
                })
              ),
            })),
          })),
          delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({})) })),
        }
      }
      if (table === "products_services") {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => Promise.resolve({ data: [], error: null })),
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
        throw new Error("invoice create must not touch material movements")
      }
      if (table === "invoice_items") {
        return { insert: invoiceItemsInsert }
      }
      if (table === "business_users") {
        const chain: Record<string, jest.Mock> = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.order = jest.fn(() => chain)
        chain.limit = jest.fn(() => Promise.resolve({ data: [], error: null }))
        return chain
      }
      if (table === "tax_schedules") {
        const chain: Record<string, jest.Mock> = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.is = jest.fn(() => chain)
        chain.lte = jest.fn(() => chain)
        chain.order = jest.fn(() => chain)
        chain.limit = jest.fn(() => chain)
        chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }))
        return chain
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
      rpc: jest.fn((fn: string) => {
        if (fn === "generate_public_token") return Promise.resolve({ data: "tok", error: null })
        return Promise.resolve({ data: null, error: null })
      }),
    } as never)
  })

  it("persists material line snapshot without stock side effects", async () => {
    const request = new NextRequest("http://localhost/api/invoices/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        issue_date: "2025-12-31",
        items: [
          {
            material_id: MATERIAL_ID,
            description: "Premium paint",
            qty: 1,
            unit_price: 450,
            discount_amount: 0,
          },
        ],
        apply_taxes: false,
      }),
    })

    const res = await POST(request)
    expect(res.status).toBe(201)
    expect(invoiceItemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        material_id: MATERIAL_ID,
        product_service_id: null,
        description: "Premium paint",
        unit_price: 450,
      }),
    ])
    expect(fromMock).not.toHaveBeenCalledWith("service_material_movements")
    const inserted = invoiceItemsInsert.mock.calls[0][0][0]
    expect(inserted).not.toHaveProperty("average_cost")
    expect(inserted).not.toHaveProperty("default_cost_price")
  })

  it("rejects material from another business", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        if (table === "service_material_inventory") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            in: jest.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        if (table === "businesses") {
          const chain: Record<string, jest.Mock> = {}
          chain.select = jest.fn(() => chain)
          chain.eq = jest.fn(() => chain)
          chain.is = jest.fn(() => chain)
          chain.order = jest.fn(() => chain)
          chain.limit = jest.fn(() => chain)
          chain.maybeSingle = jest.fn(() =>
            Promise.resolve({
              data: { id: BUSINESS_ID, owner_id: "user-1", archived_at: null },
              error: null,
            })
          )
          chain.single = jest.fn(() =>
            Promise.resolve({
              data: {
                id: BUSINESS_ID,
                address_country: "GH",
                default_currency: "GHS",
                owner_id: "user-1",
                archived_at: null,
              },
              error: null,
            })
          )
          return chain
        }
        if (table === "invoice_settings") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
          }
        }
        if (table === "business_users") {
          const chain: Record<string, jest.Mock> = {}
          chain.select = jest.fn(() => chain)
          chain.eq = jest.fn(() => chain)
          chain.order = jest.fn(() => chain)
          chain.limit = jest.fn(() => Promise.resolve({ data: [], error: null }))
          return chain
        }
        return {}
      }),
      rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
    } as never)

    const request = new NextRequest("http://localhost/api/invoices/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        issue_date: "2025-12-31",
        items: [{ material_id: MATERIAL_ID, description: "X", qty: 1, unit_price: 10 }],
      }),
    })

    const res = await POST(request)
    expect(res.status).toBe(400)
  })
})
