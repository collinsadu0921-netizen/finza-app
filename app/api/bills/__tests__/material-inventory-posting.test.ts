/**
 * Bill create: material lines resolve CoA 1450 into bill_items.account_id
 * and fail closed when inventory account is missing.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST } from "../create/route"
import { NextRequest } from "next/server"

jest.mock("@vercel/functions", () => ({
  waitUntil: jest.fn((p: Promise<unknown>) => p),
}))
jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/server/fireAfterAccountingPost", () => ({
  fireAfterAccountingPost: jest.fn(),
}))
jest.mock("@/lib/documents/incomingDocumentsService", () => ({
  getIncomingDocumentForBusiness: jest.fn(),
  linkIncomingDocumentToEntity: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn(() => Promise.resolve(null)),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const MATERIAL_ID = "m1111111-1111-4111-8111-111111111111"
const BILL_ID = "bill1111-1111-4111-8111-111111111111"
const COA_1450 = "coa14500-1450-4450-8450-145014501450"
const ACCT_1450 = "acct1450-1450-4450-8450-145014501450"

describe("POST /api/bills/create — material inventory posting intent", () => {
  let billItemsInsert: jest.Mock
  let accountsMaybeSingle: jest.Mock
  let coaMaybeSingle: jest.Mock
  let billsDelete: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getCurrentBusiness as jest.Mock).mockResolvedValue({
      id: BUSINESS_ID,
      industry: "service",
    })

    billItemsInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    accountsMaybeSingle = jest.fn(() =>
      Promise.resolve({ data: { id: ACCT_1450 }, error: null })
    )
    coaMaybeSingle = jest.fn(() =>
      Promise.resolve({ data: { id: COA_1450 }, error: null })
    )
    billsDelete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }))

    const fromMock = jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: { default_currency: "GHS" },
                  error: null,
                })
              ),
            })),
          })),
        }
      }
      if (table === "accounts") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => ({
                  maybeSingle: accountsMaybeSingle,
                })),
              })),
            })),
          })),
        }
      }
      if (table === "chart_of_accounts") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  maybeSingle: coaMaybeSingle,
                })),
              })),
            })),
          })),
        }
      }
      if (table === "bills") {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: {
                    id: BILL_ID,
                    status: "draft",
                    issue_date: "2026-07-01",
                    business_id: BUSINESS_ID,
                  },
                  error: null,
                })
              ),
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                select: jest.fn(() => ({
                  single: jest.fn(() =>
                    Promise.resolve({
                      data: {
                        id: BILL_ID,
                        status: "open",
                        issue_date: "2026-07-01",
                        business_id: BUSINESS_ID,
                      },
                      error: null,
                    })
                  ),
                })),
              })),
            })),
          })),
          delete: billsDelete,
        }
      }
      if (table === "bill_items") {
        return { insert: billItemsInsert }
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
            single: jest.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      }
    })

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
        ),
      },
      from: fromMock,
    })
  })

  it("stores CoA 1450 on material lines and does not leave account_id null", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-MAT-1",
        issue_date: "2026-07-01",
        status: "draft",
        apply_taxes: false,
        items: [
          {
            description: "Cement",
            qty: 2,
            unit_price: 50,
            discount_amount: 0,
            material_id: MATERIAL_ID,
          },
        ],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(accountsMaybeSingle).toHaveBeenCalled()
    expect(coaMaybeSingle).toHaveBeenCalled()
    expect(billItemsInsert).toHaveBeenCalled()
    const rows = billItemsInsert.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].material_id).toBe(MATERIAL_ID)
    expect(rows[0].account_id).toBe(COA_1450)
  })

  it("fails closed when materials inventory account 1450 is missing", async () => {
    accountsMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    coaMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-MAT-FAIL",
        issue_date: "2026-07-01",
        status: "draft",
        apply_taxes: false,
        items: [
          {
            description: "Cement",
            qty: 1,
            unit_price: 10,
            discount_amount: 0,
            material_id: MATERIAL_ID,
          },
        ],
      }),
    })

    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe("material_inventory_account_missing")
    expect(billItemsInsert).not.toHaveBeenCalled()
  })

  it("ordinary expense lines do not set material_id and leave account_id null by default", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-EXP-1",
        issue_date: "2026-07-01",
        status: "draft",
        apply_taxes: false,
        items: [
          {
            description: "Cleaning",
            qty: 1,
            unit_price: 40,
            discount_amount: 0,
          },
        ],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const rows = billItemsInsert.mock.calls[0][0]
    expect(rows[0].material_id).toBeNull()
    expect(rows[0].account_id).toBeNull()
    expect(accountsMaybeSingle).not.toHaveBeenCalled()
  })
})
