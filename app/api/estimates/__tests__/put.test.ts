/**
 * PUT /api/estimates/[id] — revision path and soft-delete guard.
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

describe("PUT /api/estimates/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("sent estimate revision inserts exactly one set of line items from payload (no copy)", async () => {
    const estimateItemsInsert = jest.fn(() => Promise.resolve({ error: null }))

    const existingRow = {
      id: "est-sent-1",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      estimate_number: "QUO-0001",
    }
    const originalFull = {
      ...existingRow,
      customer_id: null,
      converted_to: null,
      public_token: "tok",
    }
    const newRevisionRow = {
      id: "est-rev-draft-2",
      business_id: "test-business",
      estimate_number: "QUO-0001",
      status: "draft",
      revision_number: 2,
      supersedes_id: "est-sent-1",
      subtotal: 45,
      total_amount: 45,
      total_tax_amount: 0,
    }

    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "test-user" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
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
        if (table === "estimates") {
          return {
            select: jest.fn((fields: string) => {
              if (fields.includes("revision_number")) {
                return rowChain({ data: existingRow, error: null })
              }
              return rowChain({ data: originalFull, error: null })
            }),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: newRevisionRow, error: null })
                ),
              })),
            })),
            update: jest.fn(),
            delete: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          }
        }
        if (table === "estimate_items") {
          return {
            insert: estimateItemsInsert,
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

    const svcId = "c3333333-3333-4333-8333-333333333333"
    const items = [
      { qty: 2, unit_price: 10, description: "Line A", discount_amount: 0, product_service_id: svcId },
      { qty: 1, unit_price: 30, description: "Line B", discount_amount: 5 },
    ]

    const request = new NextRequest("http://localhost/api/estimates/est-sent-1", {
      method: "PUT",
      body: JSON.stringify({
        business_id: "test-business",
        customer_id: null,
        estimate_number: "QUO-0001",
        issue_date: "2026-02-01",
        expiry_date: null,
        notes: null,
        items,
        apply_taxes: false,
      }),
    })

    const res = await PUT(request, {
      params: Promise.resolve({ id: "est-sent-1" }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.isRevision).toBe(true)
    expect(json.estimateId).toBe("est-rev-draft-2")

    expect(estimateItemsInsert).toHaveBeenCalledTimes(1)
    const inserted = estimateItemsInsert.mock.calls[0][0] as Array<{
      estimate_id: string
      description: string
      quantity: number
      price: number
      total: number
      discount_amount: number
    }>
    expect(inserted).toHaveLength(2)
    expect(inserted.every((r) => r.estimate_id === "est-rev-draft-2")).toBe(true)
    expect(inserted[0].product_service_id).toBe(svcId)
    expect(inserted[1].product_service_id).toBeUndefined()
    expect(inserted[0]).toMatchObject({
      description: "Line A",
      quantity: 2,
      price: 10,
      total: 20,
      discount_amount: 0,
    })
    expect(inserted[1]).toMatchObject({
      description: "Line B",
      quantity: 1,
      price: 30,
      total: 25,
      discount_amount: 5,
    })

    const lineSum = inserted.reduce((s, r) => s + r.total, 0)
    expect(lineSum).toBe(45)
    expect(json.estimate.total_amount).toBe(45)

    const estimatesApi = mockSupabase.from("estimates") as any
    expect(estimatesApi.delete).not.toHaveBeenCalled()
  })

  it("revision: failed line insert deletes the new revision row (no orphan draft)", async () => {
    const itemsDeleteEq = jest.fn(() => Promise.resolve({ error: null }))
    const itemsDelete = jest.fn(() => ({ eq: itemsDeleteEq }))
    const revisionDeleteInnerEq = jest.fn(() => Promise.resolve({ error: null }))
    const revisionDeleteOuterEq = jest.fn(() => ({ eq: revisionDeleteInnerEq }))
    const revisionDelete = jest.fn(() => ({ eq: revisionDeleteOuterEq }))

    const existingRow = {
      id: "est-sent-1",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      estimate_number: "QUO-0001",
    }
    const originalFull = { ...existingRow, customer_id: null }
    const newRevisionRow = {
      id: "est-rev-fail",
      business_id: "test-business",
      estimate_number: "QUO-0001",
      status: "draft",
      revision_number: 2,
      supersedes_id: "est-sent-1",
    }

    const estimateItemsInsert = jest.fn(() =>
      Promise.resolve({ error: { message: "insert failed" } })
    )

    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "test-user" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: { address_country: "GH", default_currency: "GHS" }, error: null })
                ),
              })),
            })),
          }
        }
        if (table === "estimates") {
          return {
            select: jest.fn((fields: string) => {
              if (fields.includes("revision_number")) {
                return rowChain({ data: existingRow, error: null })
              }
              return rowChain({ data: originalFull, error: null })
            }),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: newRevisionRow, error: null })
                ),
              })),
            })),
            delete: revisionDelete,
          }
        }
        if (table === "estimate_items") {
          return {
            insert: estimateItemsInsert,
            delete: itemsDelete,
          }
        }
        return {} as any
      }),
    }

    require("@/lib/supabaseServer").createSupabaseServerClient = jest.fn(() =>
      Promise.resolve(mockSupabase)
    )

    const request = new NextRequest("http://localhost/api/estimates/est-sent-1", {
      method: "PUT",
      body: JSON.stringify({
        business_id: "test-business",
        estimate_number: "QUO-0001",
        issue_date: "2026-02-01",
        items: [{ qty: 1, unit_price: 10, description: "Only", discount_amount: 0 }],
        apply_taxes: false,
      }),
    })

    const res = await PUT(request, { params: Promise.resolve({ id: "est-sent-1" }) })
    expect(res.status).toBe(500)

    expect(itemsDelete).toHaveBeenCalled()
    expect(itemsDeleteEq).toHaveBeenCalledWith("estimate_id", "est-rev-fail")

    expect(revisionDelete).toHaveBeenCalled()
    expect(revisionDeleteOuterEq).toHaveBeenCalledWith("id", "est-rev-fail")
    expect(revisionDeleteInnerEq).toHaveBeenCalledWith("business_id", "test-business")

    const { createAuditLog } = require("@/lib/auditLog")
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it("draft: failed line insert restores prior header and line items", async () => {
    const draftExisting = {
      id: "draft-1",
      status: "draft",
      business_id: "test-business",
      revision_number: 1,
      estimate_number: "QUO-9",
    }
    const draftSnapshot = {
      ...draftExisting,
      customer_id: null,
      subtotal: 50,
      total_tax_amount: 0,
      total_amount: 50,
      subtotal_before_tax: 50,
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
      notes: "old",
    }
    const previousLine = {
      id: "line-old",
      estimate_id: "draft-1",
      description: "Original",
      quantity: 1,
      price: 50,
      total: 50,
      discount_amount: 0,
      product_service_id: "e5555555-5555-4555-8555-555555555555",
    }

    let insertCall = 0
    const estimateItemsInsert = jest.fn(() => {
      insertCall += 1
      if (insertCall === 1) {
        return Promise.resolve({ error: { message: "batch insert failed" } })
      }
      return Promise.resolve({ error: null })
    })

    const estimatesUpdate = jest.fn(() => ({
      eq: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({
                data: {
                  ...draftSnapshot,
                  subtotal: 99,
                  total_amount: 99,
                  notes: "new",
                },
                error: null,
              })
            ),
          })),
        })),
      })),
    }))

    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "test-user" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: { address_country: "GH", default_currency: "GHS" }, error: null })
                ),
              })),
            })),
          }
        }
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
              eq: jest.fn(() =>
                Promise.resolve({ data: [previousLine], error: null })
              ),
            })),
            insert: estimateItemsInsert,
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

    const request = new NextRequest("http://localhost/api/estimates/draft-1", {
      method: "PUT",
      body: JSON.stringify({
        business_id: "test-business",
        estimate_number: "QUO-9",
        issue_date: "2026-02-01",
        notes: "new",
        items: [{ qty: 1, unit_price: 99, description: "New line", discount_amount: 0 }],
        apply_taxes: false,
      }),
    })

    const res = await PUT(request, { params: Promise.resolve({ id: "draft-1" }) })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("batch insert failed")

    expect(estimatesUpdate).toHaveBeenCalledTimes(2)
    const revertPayload = estimatesUpdate.mock.calls[1][0]
    expect(revertPayload.subtotal).toBe(50)
    expect(revertPayload.total_amount).toBe(50)
    expect(revertPayload.notes).toBe("old")

    expect(estimateItemsInsert).toHaveBeenCalledTimes(2)
    const restored = estimateItemsInsert.mock.calls[1][0] as Array<{
      estimate_id: string
      description: string
      quantity: number
      price: number
      total: number
    }>
    expect(restored).toHaveLength(1)
    expect(restored[0].estimate_id).toBe("draft-1")
    expect(restored[0].description).toBe("Original")
    expect(restored[0].price).toBe(50)
    expect(restored[0].product_service_id).toBe("e5555555-5555-4555-8555-555555555555")

    const { createAuditLog } = require("@/lib/auditLog")
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it("draft: successful item replacement includes product_service_id on inserted rows", async () => {
    const svcId = "d4444444-4444-4444-8444-444444444444"
    const estimateItemsInsert = jest.fn(() => Promise.resolve({ error: null }))

    const draftExisting = {
      id: "draft-ps",
      status: "draft",
      business_id: "test-business",
      revision_number: 1,
      estimate_number: "QUO-ps",
    }
    const draftSnapshot = {
      ...draftExisting,
      customer_id: null,
      subtotal: 10,
      total_tax_amount: 0,
      total_amount: 10,
      subtotal_before_tax: 10,
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
          Promise.resolve({ data: { user: { id: "test-user" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
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
        if (table === "estimates") {
          return {
            select: jest.fn((fields: string) => {
              if (fields.includes("revision_number")) {
                return rowChain({ data: draftExisting, error: null })
              }
              return rowChain({ data: draftSnapshot, error: null })
            }),
            update: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  select: jest.fn(() => ({
                    single: jest.fn(() =>
                      Promise.resolve({ data: { ...draftSnapshot, total_amount: 20 }, error: null })
                    ),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === "estimate_items") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
            insert: estimateItemsInsert,
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
      new NextRequest("http://localhost/api/estimates/draft-ps", {
        method: "PUT",
        body: JSON.stringify({
          business_id: "test-business",
          estimate_number: "QUO-ps",
          issue_date: "2026-02-01",
          items: [
            {
              qty: 1,
              unit_price: 20,
              description: "Cat row",
              discount_amount: 0,
              product_service_id: svcId,
            },
          ],
          apply_taxes: false,
        }),
      }),
      { params: Promise.resolve({ id: "draft-ps" }) }
    )

    expect(res.status).toBe(200)
    const inserted = estimateItemsInsert.mock.calls[0][0] as Array<{ product_service_id?: string }>
    expect(inserted).toHaveLength(1)
    expect(inserted[0].product_service_id).toBe(svcId)
  })

  it("returns 404 when estimate is soft-deleted", async () => {
    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "test-user" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "estimates") {
          return {
            select: jest.fn(() => rowChain({ data: null, error: { message: "No rows" } })),
          }
        }
        return {} as any
      }),
    }

    require("@/lib/supabaseServer").createSupabaseServerClient = jest.fn(() =>
      Promise.resolve(mockSupabase)
    )

    const request = new NextRequest("http://localhost/api/estimates/deleted-id", {
      method: "PUT",
      body: JSON.stringify({
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [{ qty: 1, unit_price: 10, description: "X", discount_amount: 0 }],
        apply_taxes: false,
      }),
    })

    const res = await PUT(request, {
      params: Promise.resolve({ id: "deleted-id" }),
    })
    expect(res.status).toBe(404)
  })
})
