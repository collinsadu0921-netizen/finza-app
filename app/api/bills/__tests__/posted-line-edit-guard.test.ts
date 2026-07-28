/**
 * Posted/open bill line mutations blocked; draft line replace still allowed.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { PUT } from "../[id]/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(() => Promise.resolve(null)),
  enforceServiceWorkspaceWriteAccess: jest.fn(() => Promise.resolve(null)),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BILL_ID = "bill3333-3333-4333-8333-333333333333"

describe("PUT /api/bills/[id] — posted line edit guard", () => {
  let billItemsDelete: jest.Mock
  let billItemsInsert: jest.Mock
  let billStatus: string

  beforeEach(() => {
    jest.clearAllMocks()
    billStatus = "open"
    billItemsDelete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }))
    billItemsInsert = jest.fn(() => Promise.resolve({ error: null }))

    ;(getCurrentBusiness as jest.Mock).mockResolvedValue({
      id: BUSINESS_ID,
      industry: "service",
    })

    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === "bills") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  single: jest.fn(() =>
                    Promise.resolve({
                      data: {
                        id: BILL_ID,
                        status: billStatus,
                        total: 100,
                        currency_code: null,
                        fx_rate: null,
                      },
                      error: null,
                    })
                  ),
                })),
              })),
            })),
            update: jest.fn(() => ({
              eq: jest.fn(() => ({
                select: jest.fn(() => ({
                  single: jest.fn(() =>
                    Promise.resolve({
                      data: {
                        id: BILL_ID,
                        status: billStatus,
                        business_id: BUSINESS_ID,
                      },
                      error: null,
                    })
                  ),
                })),
              })),
            })),
          }
        }
        if (table === "bill_items") {
          return { delete: billItemsDelete, insert: billItemsInsert }
        }
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

  it("rejects line replacement when bill is open", async () => {
    billStatus = "open"
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        bill_type: "standard",
        items: [{ description: "x", qty: 1, unit_price: 10, discount_amount: 0 }],
        apply_taxes: false,
      }),
    })

    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("posted_bill_lines_locked")
    expect(billItemsDelete).not.toHaveBeenCalled()
    expect(billItemsInsert).not.toHaveBeenCalled()
  })

  it("allows line replacement when bill is draft", async () => {
    billStatus = "draft"
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        bill_type: "standard",
        supplier_name: "Vendor",
        bill_number: "B-DRAFT-1",
        issue_date: "2026-07-01",
        items: [{ description: "x", qty: 1, unit_price: 10, discount_amount: 0 }],
        apply_taxes: false,
      }),
    })

    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(200)
    expect(billItemsDelete).toHaveBeenCalled()
    expect(billItemsInsert).toHaveBeenCalled()
  })
})
