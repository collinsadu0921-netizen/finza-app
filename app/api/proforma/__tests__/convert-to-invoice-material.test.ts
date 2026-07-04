/**
 * Proforma → Invoice conversion preserves material_id — no stock side effects.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST } from "../[id]/convert-to-invoice/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/archivedBusiness", () => ({
  assertBusinessNotArchived: jest.fn(() => Promise.resolve()),
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

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

const MATERIAL_ID = "m1111111-1111-4111-8111-111111111111"
const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PROFORMA_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp"

describe("POST /api/proforma/[id]/convert-to-invoice — material_id", () => {
  let invoiceItemsInsert: jest.Mock
  let fromMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    invoiceItemsInsert = jest.fn(() => Promise.resolve({ error: null }))

    jest.mocked(resolveBusinessScopeForUser).mockResolvedValue({
      ok: true,
      businessId: BUSINESS_ID,
    } as never)

    fromMock = jest.fn((table: string) => {
      if (table === "proforma_invoices") {
        const chain: Record<string, jest.Mock> = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.is = jest.fn(() => chain)
        chain.single = jest.fn(() =>
          Promise.resolve({
            data: {
              id: PROFORMA_ID,
              business_id: BUSINESS_ID,
              customer_id: null,
              status: "accepted",
              apply_taxes: false,
              currency_code: "GHS",
              currency_symbol: "₵",
              subtotal: 450,
              total: 450,
            },
            error: null,
          })
        )
        chain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }))
        return chain
      }
      if (table === "proforma_invoice_items") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() =>
                Promise.resolve({
                  data: [
                    {
                      material_id: MATERIAL_ID,
                      description: "Premium paint",
                      qty: 1,
                      unit_price: 450,
                      discount_amount: 0,
                      line_subtotal: 450,
                    },
                  ],
                  error: null,
                })
              ),
            })),
          })),
        }
      }
      if (table === "businesses") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: { address_country: "GH", default_currency: "GHS" },
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
        throw new Error("proforma conversion must not touch material movements")
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
      rpc: jest.fn((name: string) => {
        if (name === "generate_invoice_number_with_settings") {
          return Promise.resolve({ data: "INV-0001", error: null })
        }
        if (name === "generate_public_token") {
          return Promise.resolve({ data: "token-abc", error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    } as never)
  })

  it("copies material_id onto invoice items without stock side effects", async () => {
    const res = await POST(
      new NextRequest(`http://localhost/api/proforma/${PROFORMA_ID}/convert-to-invoice`, {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_ID }),
      }),
      { params: Promise.resolve({ id: PROFORMA_ID }) }
    )

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
  })

  it("allows inactive tenant-owned material from saved proforma", async () => {
    jest.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        if (table === "proforma_invoices") {
          const chain: Record<string, jest.Mock> = {}
          chain.select = jest.fn(() => chain)
          chain.eq = jest.fn(() => chain)
          chain.is = jest.fn(() => chain)
          chain.single = jest.fn(() =>
            Promise.resolve({
              data: {
                id: PROFORMA_ID,
                business_id: BUSINESS_ID,
                status: "accepted",
                apply_taxes: false,
                currency_code: "GHS",
                currency_symbol: "₵",
              },
              error: null,
            })
          )
          chain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }))
          return chain
        }
        if (table === "proforma_invoice_items") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() =>
                  Promise.resolve({
                    data: [
                      {
                        material_id: MATERIAL_ID,
                        description: "Legacy paint",
                        qty: 1,
                        unit_price: 450,
                        discount_amount: 0,
                        line_subtotal: 450,
                      },
                    ],
                    error: null,
                  })
                ),
              })),
            })),
          }
        }
        if (table === "businesses") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: { address_country: "GH", default_currency: "GHS" },
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
              data: [{ id: MATERIAL_ID }],
              error: null,
            }),
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
      rpc: jest.fn((name: string) => {
        if (name === "generate_invoice_number_with_settings") {
          return Promise.resolve({ data: "INV-0001", error: null })
        }
        return Promise.resolve({ data: "token-abc", error: null })
      }),
    } as never)

    const res = await POST(
      new NextRequest(`http://localhost/api/proforma/${PROFORMA_ID}/convert-to-invoice`, {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_ID }),
      }),
      { params: Promise.resolve({ id: PROFORMA_ID }) }
    )

    expect(res.status).toBe(201)
    expect(invoiceItemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({ material_id: MATERIAL_ID }),
    ])
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
        if (table === "proforma_invoices") {
          const chain: Record<string, jest.Mock> = {}
          chain.select = jest.fn(() => chain)
          chain.eq = jest.fn(() => chain)
          chain.is = jest.fn(() => chain)
          chain.single = jest.fn(() =>
            Promise.resolve({
              data: {
                id: PROFORMA_ID,
                business_id: BUSINESS_ID,
                status: "accepted",
                apply_taxes: false,
                currency_code: "GHS",
                currency_symbol: "₵",
              },
              error: null,
            })
          )
          chain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }))
          return chain
        }
        if (table === "proforma_invoice_items") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() =>
                  Promise.resolve({
                    data: [
                      {
                        description: "Consulting",
                        qty: 1,
                        unit_price: 100,
                        discount_amount: 0,
                        line_subtotal: 100,
                      },
                    ],
                    error: null,
                  })
                ),
              })),
            })),
          }
        }
        if (table === "businesses") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: { address_country: "GH", default_currency: "GHS" },
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
      rpc: jest.fn((name: string) => {
        if (name === "generate_invoice_number_with_settings") {
          return Promise.resolve({ data: "INV-0001", error: null })
        }
        return Promise.resolve({ data: "token-abc", error: null })
      }),
    } as never)

    const res = await POST(
      new NextRequest(`http://localhost/api/proforma/${PROFORMA_ID}/convert-to-invoice`, {
        method: "POST",
        body: JSON.stringify({ business_id: BUSINESS_ID }),
      }),
      { params: Promise.resolve({ id: PROFORMA_ID }) }
    )

    expect(res.status).toBe(201)
    expect(invoiceItemsInsert.mock.calls[0][0][0].material_id).toBeFalsy()
  })
})
