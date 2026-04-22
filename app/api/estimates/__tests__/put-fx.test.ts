/**
 * PUT /api/estimates/[id] — currency / FX parity with POST create.
 */

import { PUT } from "../[id]/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
}))
jest.mock("@/lib/taxEngine/helpers", () => ({
  getTaxEngineCode: jest.fn(() => "ghana"),
  deriveLegacyTaxColumnsFromTaxLines: jest.fn(() => ({
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
  })),
  getCanonicalTaxResultFromLineItems: jest.fn(),
}))
jest.mock("@/lib/taxEngine/serialize", () => ({
  toTaxLinesJsonb: jest.fn(() => null),
}))
jest.mock("@/lib/business", () => ({
  requireBusinessScopeForUser: jest.fn(() =>
    Promise.resolve({ ok: true, businessId: "test-business" })
  ),
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))

function rowChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {}
  chain.eq = jest.fn(() => chain)
  chain.is = jest.fn(() => chain)
  chain.single = jest.fn(() => Promise.resolve(result))
  return chain
}

function businessesMock() {
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

describe("PUT /api/estimates/[id] FX / currency", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("persists FX-related fields on draft update when quoting in foreign currency with valid fx_rate", async () => {
    const estimatesUpdate = jest.fn(() => ({
      eq: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({
                data: {
                  id: "draft-fx",
                  business_id: "test-business",
                  currency_code: "USD",
                  fx_rate: 12.5,
                  home_currency_code: "GHS",
                  home_currency_total: 1250,
                  total_amount: 100,
                },
                error: null,
              })
            ),
          })),
        })),
      })),
    }))

    const draftExisting = {
      id: "draft-fx",
      status: "draft",
      business_id: "test-business",
      revision_number: 1,
      estimate_number: "QUO-1",
    }
    const draftSnapshot = {
      ...draftExisting,
      customer_id: null,
      currency_code: "GHS",
      currency_symbol: "₵",
      fx_rate: null,
      home_currency_code: null,
      home_currency_total: null,
      subtotal: 100,
      total_tax_amount: 0,
      total_amount: 100,
      subtotal_before_tax: 100,
      nhil_amount: 0,
      getfund_amount: 0,
      covid_amount: 0,
      vat_amount: 0,
      tax: 0,
      tax_lines: null,
      tax_engine_code: null,
      tax_engine_effective_from: null,
      tax_jurisdiction: null,
      issue_date: "2026-01-01",
      expiry_date: null,
      notes: null,
    }

    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "u1" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") return businessesMock()
        if (table === "estimates") {
          return {
            select: jest.fn((fields: string) => {
              if (fields.includes("revision_number")) {
                return rowChain({ data: draftExisting, error: null })
              }
              return rowChain({ data: draftSnapshot, error: null })
            }),
            update: estimatesUpdate,
          }
        }
        if (table === "estimate_items") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
            insert: jest.fn(() => Promise.resolve({ error: null })),
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }
        return {} as any
      }),
    }

    require("@/lib/supabaseServer").createSupabaseServerClient = jest.fn(() =>
      Promise.resolve(mockSupabase)
    )

    const res = await PUT(
      new NextRequest("http://localhost/api/estimates/draft-fx", {
        method: "PUT",
        body: JSON.stringify({
          business_id: "test-business",
          estimate_number: "QUO-1",
          issue_date: "2026-02-01",
          currency_code: "USD",
          fx_rate: 12.5,
          items: [{ qty: 1, unit_price: 100, description: "Svc", discount_amount: 0 }],
          apply_taxes: false,
        }),
      }),
      { params: Promise.resolve({ id: "draft-fx" }) }
    )

    expect(res.status).toBe(200)
    const payload = estimatesUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload.currency_code).toBe("USD")
    expect(payload.fx_rate).toBe(12.5)
    expect(payload.home_currency_code).toBe("GHS")
    expect(payload.home_currency_total).toBe(1250)
    expect(payload.total_amount).toBe(100)
  })

  it("rejects foreign-currency update without positive fx_rate", async () => {
    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "u1" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") return businessesMock()
        if (table === "estimates") {
          return {
            select: jest.fn(() =>
              rowChain({
                data: {
                  id: "d1",
                  status: "draft",
                  business_id: "test-business",
                  revision_number: 1,
                  estimate_number: "Q",
                },
                error: null,
              })
            ),
          }
        }
        return {} as any
      }),
    }

    require("@/lib/supabaseServer").createSupabaseServerClient = jest.fn(() =>
      Promise.resolve(mockSupabase)
    )

    const res = await PUT(
      new NextRequest("http://localhost/api/estimates/d1", {
        method: "PUT",
        body: JSON.stringify({
          business_id: "test-business",
          issue_date: "2026-02-01",
          currency_code: "USD",
          items: [{ qty: 1, unit_price: 10, description: "x", discount_amount: 0 }],
          apply_taxes: false,
        }),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.message).toBe("FX rate required for foreign currency quote")
    expect(String(json.error)).toContain("Exchange rate is required when quoting in USD")
  })

  it("includes FX fields on revision insert for foreign-currency quotes", async () => {
    let insertedRevision: Record<string, unknown> | null = null

    const existingRow = {
      id: "est-sent",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      estimate_number: "QUO-9",
    }
    const originalFull = { ...existingRow, customer_id: null }
    const newRevisionRow = {
      id: "est-rev-fx",
      business_id: "test-business",
      estimate_number: "QUO-9",
      status: "draft",
      revision_number: 2,
      supersedes_id: "est-sent",
    }

    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "u1" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") return businessesMock()
        if (table === "estimates") {
          return {
            select: jest.fn((fields: string) => {
              if (fields.includes("revision_number")) {
                return rowChain({ data: existingRow, error: null })
              }
              return rowChain({ data: originalFull, error: null })
            }),
            insert: jest.fn((row: Record<string, unknown>) => {
              insertedRevision = row
              return {
                select: jest.fn(() => ({
                  single: jest.fn(() =>
                    Promise.resolve({ data: newRevisionRow, error: null })
                  ),
                })),
              }
            }),
          }
        }
        if (table === "estimate_items") {
          return {
            insert: jest.fn(() => Promise.resolve({ error: null })),
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }
        return {} as any
      }),
    }

    require("@/lib/supabaseServer").createSupabaseServerClient = jest.fn(() =>
      Promise.resolve(mockSupabase)
    )

    const res = await PUT(
      new NextRequest("http://localhost/api/estimates/est-sent", {
        method: "PUT",
        body: JSON.stringify({
          business_id: "test-business",
          estimate_number: "QUO-9",
          issue_date: "2026-02-01",
          currency_code: "USD",
          fx_rate: 2,
          items: [{ qty: 1, unit_price: 50, description: "Line", discount_amount: 0 }],
          apply_taxes: false,
        }),
      }),
      { params: Promise.resolve({ id: "est-sent" }) }
    )

    expect(res.status).toBe(200)
    expect(insertedRevision).not.toBeNull()
    expect(insertedRevision!.currency_code).toBe("USD")
    expect(insertedRevision!.fx_rate).toBe(2)
    expect(insertedRevision!.home_currency_code).toBe("GHS")
    expect(insertedRevision!.home_currency_total).toBe(100)
    expect(insertedRevision!.total_amount).toBe(50)
  })
})
