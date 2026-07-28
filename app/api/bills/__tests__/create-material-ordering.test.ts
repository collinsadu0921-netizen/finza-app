/**
 * Create-as-open: insert draft → insert lines → update status open.
 * Item-insert failure never opens/posts; cleanup path covered.
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
import { fireAfterAccountingPost } from "@/lib/server/fireAfterAccountingPost"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BILL_ID = "bill2222-2222-4222-8222-222222222222"
const MATERIAL_ID = "m2222222-2222-4222-8222-222222222222"

describe("POST /api/bills/create — draft→lines→open ordering", () => {
  let billsInsert: jest.Mock
  let billsUpdate: jest.Mock
  let billsDelete: jest.Mock
  let billItemsInsert: jest.Mock
  let callOrder: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    callOrder = []
    ;(getCurrentBusiness as jest.Mock).mockResolvedValue({
      id: BUSINESS_ID,
      industry: "service",
    })

    billsInsert = jest.fn((row: { status?: string }) => {
      callOrder.push(`bills.insert:${row.status}`)
      return {
        select: jest.fn(() => ({
          single: jest.fn(() =>
            Promise.resolve({
              data: {
                id: BILL_ID,
                status: row.status,
                issue_date: "2026-07-01",
                business_id: BUSINESS_ID,
              },
              error: null,
            })
          ),
        })),
      }
    })

    billsUpdate = jest.fn((row: { status?: string }) => {
      callOrder.push(`bills.update:${row.status}`)
      return {
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
      }
    })

    billsDelete = jest.fn(() => {
      callOrder.push("bills.delete")
      return {
        eq: jest.fn(() => Promise.resolve({ error: null })),
      }
    })

    billItemsInsert = jest.fn(() => {
      callOrder.push("bill_items.insert")
      return Promise.resolve({ data: null, error: null })
    })

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "businesses") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: { default_currency: "GHS" }, error: null })
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
                    maybeSingle: jest.fn(() =>
                      Promise.resolve({
                        data: { id: "acct-1450" },
                        error: null,
                      })
                    ),
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
                    maybeSingle: jest.fn(() =>
                      Promise.resolve({
                        data: { id: "coa-1450" },
                        error: null,
                      })
                    ),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === "bills") {
          return { insert: billsInsert, update: billsUpdate, delete: billsDelete }
        }
        if (table === "bill_items") {
          return { insert: billItemsInsert }
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        }
      }),
    })
  })

  it("inserts draft, then lines, then opens when status=open requested", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-OPEN-1",
        issue_date: "2026-07-01",
        status: "open",
        apply_taxes: false,
        items: [
          {
            description: "Mat",
            qty: 1,
            unit_price: 10,
            discount_amount: 0,
            material_id: MATERIAL_ID,
          },
        ],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(callOrder).toEqual([
      "bills.insert:draft",
      "bill_items.insert",
      "bills.update:open",
    ])
    expect(fireAfterAccountingPost).toHaveBeenCalled()
  })

  it("on bill_items insert failure: never opens, never posts, deletes draft, returns 500", async () => {
    billItemsInsert.mockImplementation(() => {
      callOrder.push("bill_items.insert")
      return Promise.resolve({
        data: null,
        error: { message: "bill_items insert failed" },
      })
    })

    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-FAIL-1",
        issue_date: "2026-07-01",
        status: "open",
        apply_taxes: false,
        items: [
          {
            description: "Mat",
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
    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(String(body.error)).toMatch(/bill_items insert failed/i)
    expect(callOrder).toEqual([
      "bills.insert:draft",
      "bill_items.insert",
      "bills.delete",
    ])
    expect(billsUpdate).not.toHaveBeenCalled()
    expect(fireAfterAccountingPost).not.toHaveBeenCalled()
  })

  it("when cleanup delete fails after item insert failure: reports original error, never opens/posts", async () => {
    billItemsInsert.mockImplementation(() => {
      callOrder.push("bill_items.insert")
      return Promise.resolve({
        data: null,
        error: { message: "bill_items insert failed" },
      })
    })
    billsDelete.mockImplementation(() => {
      callOrder.push("bills.delete")
      return {
        eq: jest.fn(() =>
          Promise.resolve({ error: { message: "cleanup delete failed" } })
        ),
      }
    })

    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-FAIL-2",
        issue_date: "2026-07-01",
        status: "open",
        apply_taxes: false,
        items: [
          {
            description: "Mat",
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
    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(String(body.error)).toMatch(/bill_items insert failed/i)
    expect(body.cleanup_failed).toBe(true)
    expect(body.bill_id).toBe(BILL_ID)
    expect(callOrder).toEqual([
      "bills.insert:draft",
      "bill_items.insert",
      "bills.delete",
    ])
    expect(billsUpdate).not.toHaveBeenCalled()
    expect(fireAfterAccountingPost).not.toHaveBeenCalled()
  })
})
