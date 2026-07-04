/**
 * PATCH /api/proforma/[id] — revision path and edit guards.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { PATCH } from "../[id]/route"
import { NextRequest } from "next/server"
import { mapProformaItemsForInsert } from "@/lib/documents/documentLineMaterials"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(() =>
    Promise.resolve({ ok: true, businessId: "test-business" })
  ),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
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
  getCanonicalTaxResultFromLineItems: jest.fn(() => ({
    base_amount: 45,
    total_tax: 0,
    total_amount: 45,
    lines: [],
  })),
}))
jest.mock("@/lib/taxEngine/serialize", () => ({
  toTaxLinesJsonb: jest.fn(() => null),
}))
jest.mock("@/lib/documents/documentLineMaterials", () => ({
  validateDocumentLineMaterials: jest.fn(() =>
    Promise.resolve({ ok: true, validMaterialIds: new Set(["mat-1"]) })
  ),
  resolveValidProductServiceIds: jest.fn(() => Promise.resolve(new Set<string>())),
  mapProformaItemsForInsert: jest.fn(
    (
      proformaId: string,
      items: Array<{
        description: string
        qty: number
        unit_price: number
        discount_amount: number
        material_id?: string | null
      }>,
      _validProductServiceIds?: Set<string>,
      validMaterialIds?: Set<string>
    ) =>
      items.map((item) => ({
        proforma_invoice_id: proformaId,
        description: item.description,
        qty: item.qty,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        line_subtotal: item.qty * item.unit_price - item.discount_amount,
        ...(item.material_id && validMaterialIds?.has(item.material_id)
          ? { material_id: item.material_id }
          : {}),
      }))
  ),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

function queryChain(result: { data: unknown; error: unknown | null }) {
  const chain: Record<string, jest.Mock> = {}
  chain.eq = jest.fn(() => chain)
  chain.is = jest.fn(() => chain)
  chain.single = jest.fn(() => Promise.resolve(result))
  chain.maybeSingle = jest.fn(() => Promise.resolve(result))
  return chain
}

const baseOriginalFull = {
  customer_id: null,
  issue_date: "2026-02-01",
  validity_date: null,
  subtotal: 45,
  total_tax: 0,
  total: 45,
  nhil: 0,
  getfund: 0,
  covid: 0,
  vat: 0,
  currency_code: "GHS",
  currency_symbol: "₵",
  payment_terms: null,
  notes: null,
  footer_message: null,
  tax_lines: null,
  tax_engine_code: null,
  tax_jurisdiction: null,
  tax_engine_effective_from: null,
  source_estimate_id: null,
  public_token: "tok",
}

function patchRequest(proformaId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/proforma/${proformaId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/proforma/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("draft proforma edits in place", async () => {
    const proformaUpdate = jest.fn(() => ({
      eq: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() =>
            Promise.resolve({
              data: {
                id: "prf-draft-1",
                status: "draft",
                revision_number: 1,
                proforma_number: "PRF-000001",
              },
              error: null,
            })
          ),
        })),
      })),
    }))
    const proformaInsert = jest.fn()
    const proformaItemsInsert = jest.fn(() => Promise.resolve({ error: null }))

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
        if (table === "proforma_invoices") {
          return {
            select: jest.fn(() =>
              queryChain({
                data: {
                  id: "prf-draft-1",
                  status: "draft",
                  business_id: "test-business",
                  revision_number: 1,
                  proforma_number: "PRF-000001",
                  apply_taxes: false,
                },
                error: null,
              })
            ),
            update: proformaUpdate,
            insert: proformaInsert,
          }
        }
        if (table === "proforma_invoice_items") {
          return {
            insert: proformaItemsInsert,
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }
        return {} as any
      }),
    }

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)

    const res = await PATCH(
      patchRequest("prf-draft-1", {
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [{ qty: 1, unit_price: 25, description: "Draft line", discount_amount: 0 }],
        apply_taxes: false,
      }),
      { params: Promise.resolve({ id: "prf-draft-1" }) }
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.isRevision).toBe(false)
    expect(json.reusedExistingRevision).toBe(false)
    expect(json.proforma.id).toBe("prf-draft-1")
    expect(proformaUpdate).toHaveBeenCalled()
    expect(proformaInsert).not.toHaveBeenCalled()
  })

  it("sent proforma creates new draft revision and leaves original unchanged", async () => {
    const proformaItemsInsert = jest.fn(() => Promise.resolve({ error: null }))
    const proformaUpdate = jest.fn()
    const proformaInsert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() =>
          Promise.resolve({
            data: {
              id: "prf-rev-draft-2",
              business_id: "test-business",
              proforma_number: "PRF-000001",
              status: "draft",
              revision_number: 2,
              supersedes_id: "prf-sent-1",
              subtotal: 45,
              total: 45,
              total_tax: 0,
            },
            error: null,
          })
        ),
      })),
    }))

    const existingRow = {
      id: "prf-sent-1",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      proforma_number: "PRF-000001",
      apply_taxes: false,
    }
    const originalFull = { ...baseOriginalFull, ...existingRow }
    let starSelectCount = 0

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
        if (table === "proforma_invoices") {
          return {
            select: jest.fn((fields: string) => {
              if (fields === "*") {
                starSelectCount += 1
                if (starSelectCount === 1) {
                  return queryChain({ data: originalFull, error: null })
                }
                return queryChain({ data: null, error: null })
              }
              return queryChain({ data: existingRow, error: null })
            }),
            insert: proformaInsert,
            update: proformaUpdate,
            delete: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          }
        }
        if (table === "proforma_invoice_items") {
          return {
            insert: proformaItemsInsert,
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }
        return {} as any
      }),
    }

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)

    const res = await PATCH(
      patchRequest("prf-sent-1", {
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [
          { qty: 2, unit_price: 10, description: "Line A", discount_amount: 0 },
          { qty: 1, unit_price: 30, description: "Line B", discount_amount: 5 },
        ],
        apply_taxes: false,
      }),
      { params: Promise.resolve({ id: "prf-sent-1" }) }
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.isRevision).toBe(true)
    expect(json.reusedExistingRevision).toBe(false)
    expect(json.proforma.id).toBe("prf-rev-draft-2")
    expect(proformaInsert).toHaveBeenCalledTimes(1)
    expect(proformaUpdate).not.toHaveBeenCalled()
    expect(proformaItemsInsert).toHaveBeenCalledTimes(1)
    const inserted = proformaItemsInsert.mock.calls[0][0] as Array<{
      proforma_invoice_id: string
    }>
    expect(inserted.every((r) => r.proforma_invoice_id === "prf-rev-draft-2")).toBe(true)
  })

  it("editing sent proforma twice reuses existing draft revision", async () => {
    const proformaItemsInsert = jest.fn(() => Promise.resolve({ error: null }))
    const proformaInsert = jest.fn()
    const proformaUpdate = jest.fn(() => ({
      eq: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({
                data: {
                  id: "prf-rev-draft-2",
                  status: "draft",
                  revision_number: 2,
                  proforma_number: "PRF-000001",
                  supersedes_id: "prf-sent-1",
                },
                error: null,
              })
            ),
          })),
        })),
      })),
    }))

    const existingRow = {
      id: "prf-sent-1",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      proforma_number: "PRF-000001",
      apply_taxes: false,
    }
    const existingDraftRevision = {
      id: "prf-rev-draft-2",
      status: "draft",
      business_id: "test-business",
      revision_number: 2,
      proforma_number: "PRF-000001",
      supersedes_id: "prf-sent-1",
      apply_taxes: false,
      ...baseOriginalFull,
    }
    let starSelectCount = 0

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
        if (table === "proforma_invoices") {
          return {
            select: jest.fn((fields: string) => {
              if (fields === "*") {
                starSelectCount += 1
                if (starSelectCount === 1) {
                  return queryChain({ data: { ...existingRow, ...baseOriginalFull }, error: null })
                }
                return queryChain({ data: existingDraftRevision, error: null })
              }
              return queryChain({ data: existingRow, error: null })
            }),
            insert: proformaInsert,
            update: proformaUpdate,
            delete: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          }
        }
        if (table === "proforma_invoice_items") {
          return {
            insert: proformaItemsInsert,
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }
        return {} as any
      }),
    }

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)

    const res = await PATCH(
      patchRequest("prf-sent-1", {
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [{ qty: 1, unit_price: 12, description: "Updated", discount_amount: 0 }],
        apply_taxes: false,
      }),
      { params: Promise.resolve({ id: "prf-sent-1" }) }
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.isRevision).toBe(false)
    expect(json.reusedExistingRevision).toBe(true)
    expect(json.proforma.id).toBe("prf-rev-draft-2")
    expect(proformaInsert).not.toHaveBeenCalled()
    expect(proformaUpdate).toHaveBeenCalled()
  })

  it("preserves material_id on revision line items", async () => {
    const proformaItemsInsert = jest.fn(() => Promise.resolve({ error: null }))
    const existingRow = {
      id: "prf-sent-1",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      proforma_number: "PRF-000001",
      apply_taxes: false,
    }
    let starSelectCount = 0

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
        if (table === "proforma_invoices") {
          return {
            select: jest.fn((fields: string) => {
              if (fields === "*") {
                starSelectCount += 1
                if (starSelectCount === 1) {
                  return queryChain({ data: { ...existingRow, ...baseOriginalFull }, error: null })
                }
                return queryChain({ data: null, error: null })
              }
              return queryChain({ data: existingRow, error: null })
            }),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: {
                      id: "prf-rev-mat",
                      status: "draft",
                      revision_number: 2,
                      supersedes_id: "prf-sent-1",
                    },
                    error: null,
                  })
                ),
              })),
            })),
            update: jest.fn(),
          }
        }
        if (table === "proforma_invoice_items") {
          return {
            insert: proformaItemsInsert,
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
          }
        }
        return {} as any
      }),
    }

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)

    await PATCH(
      patchRequest("prf-sent-1", {
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [
          {
            qty: 1,
            unit_price: 50,
            description: "Material line",
            discount_amount: 0,
            material_id: "mat-1",
          },
        ],
        apply_taxes: false,
      }),
      { params: Promise.resolve({ id: "prf-sent-1" }) }
    )

    expect(mapProformaItemsForInsert).toHaveBeenCalled()
    const inserted = proformaItemsInsert.mock.calls[0][0] as Array<{ material_id?: string }>
    expect(inserted[0]?.material_id).toBe("mat-1")
  })

  it("revision: failed line insert deletes the new revision row (no orphan draft)", async () => {
    const itemsDeleteEq = jest.fn(() => Promise.resolve({ error: null }))
    const revisionDeleteInnerEq = jest.fn(() => Promise.resolve({ error: null }))
    const revisionDeleteOuterEq = jest.fn(() => ({ eq: revisionDeleteInnerEq }))
    const revisionDelete = jest.fn(() => ({ eq: revisionDeleteOuterEq }))

    const existingRow = {
      id: "prf-sent-1",
      status: "sent",
      business_id: "test-business",
      revision_number: 1,
      proforma_number: "PRF-000001",
      apply_taxes: false,
    }
    let starSelectCount = 0

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
        if (table === "proforma_invoices") {
          return {
            select: jest.fn((fields: string) => {
              if (fields === "*") {
                starSelectCount += 1
                if (starSelectCount === 1) {
                  return queryChain({ data: { ...existingRow, ...baseOriginalFull }, error: null })
                }
                return queryChain({ data: null, error: null })
              }
              return queryChain({ data: existingRow, error: null })
            }),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: {
                      id: "prf-rev-fail",
                      status: "draft",
                      revision_number: 2,
                      supersedes_id: "prf-sent-1",
                    },
                    error: null,
                  })
                ),
              })),
            })),
            delete: revisionDelete,
          }
        }
        if (table === "proforma_invoice_items") {
          return {
            insert: jest.fn(() =>
              Promise.resolve({ error: { message: "insert failed", code: "23505" } })
            ),
            delete: jest.fn(() => ({ eq: itemsDeleteEq })),
          }
        }
        return {} as any
      }),
    }

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)

    const res = await PATCH(
      patchRequest("prf-sent-1", {
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [{ qty: 1, unit_price: 10, description: "Line", discount_amount: 0 }],
        apply_taxes: false,
      }),
      { params: Promise.resolve({ id: "prf-sent-1" }) }
    )

    expect(res.status).toBe(500)
    expect(revisionDelete).toHaveBeenCalled()
    expect(itemsDeleteEq).toHaveBeenCalledWith("proforma_invoice_id", "prf-rev-fail")
  })

  it("accepted proforma cannot be edited", async () => {
    const mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "test-user" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "proforma_invoices") {
          return {
            select: jest.fn(() =>
              queryChain({
                data: {
                  id: "prf-acc-1",
                  status: "accepted",
                  business_id: "test-business",
                  apply_taxes: true,
                  revision_number: 1,
                  proforma_number: "PRF-000002",
                },
                error: null,
              })
            ),
          }
        }
        return {} as any
      }),
    }

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)

    const res = await PATCH(
      patchRequest("prf-acc-1", {
        business_id: "test-business",
        issue_date: "2026-02-01",
        items: [{ qty: 1, unit_price: 10, description: "Line", discount_amount: 0 }],
      }),
      { params: Promise.resolve({ id: "prf-acc-1" }) }
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/accepted/i)
  })
})
