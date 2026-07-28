/**
 * Non-zero / malformed bill-level header discount is rejected (fail closed).
 * Valid line-level discounts still accepted.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST } from "../create/route"
import { PUT } from "../[id]/route"
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
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(() => Promise.resolve(null)),
  enforceServiceWorkspaceWriteAccess: jest.fn(() => Promise.resolve(null)),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const BILL_ID = "bill4444-4444-4444-8444-444444444444"

function mockCreateClient(opts?: { captureItems?: jest.Mock }) {
  const billItemsInsert =
    opts?.captureItems ||
    jest.fn(() => Promise.resolve({ data: null, error: null }))

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
                      status: "draft",
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
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: {
                      id: BILL_ID,
                      status: "draft",
                      business_id: BUSINESS_ID,
                    },
                    error: null,
                  })
                ),
              })),
            })),
          })),
          delete: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ error: null })),
          })),
        }
      }
      if (table === "bill_items") {
        return {
          insert: billItemsInsert,
          delete: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ error: null })),
          })),
        }
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({ data: { default_currency: "GHS" }, error: null })
            ),
            maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      }
    }),
  })

  return { billItemsInsert }
}

describe("Bill-level discount rejection", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getCurrentBusiness as jest.Mock).mockResolvedValue({
      id: BUSINESS_ID,
      industry: "service",
    })
    mockCreateClient()
  })

  it("POST rejects non-zero discount_amount at bill root", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-HDR-1",
        issue_date: "2026-07-01",
        discount_amount: 25,
        apply_taxes: false,
        items: [{ description: "x", qty: 1, unit_price: 100, discount_amount: 0 }],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("unsupported_bill_level_discount")
  })

  it("POST rejects non-zero bill_discount_amount", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-HDR-2",
        issue_date: "2026-07-01",
        bill_discount_amount: 5,
        apply_taxes: false,
        items: [{ description: "x", qty: 1, unit_price: 100, discount_amount: 0 }],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("unsupported_bill_level_discount")
  })

  it("POST rejects numeric string non-zero header discount", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-HDR-3",
        issue_date: "2026-07-01",
        discount_amount: "12.5",
        apply_taxes: false,
        items: [{ description: "x", qty: 1, unit_price: 100, discount_amount: 0 }],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("unsupported_bill_level_discount")
  })

  it.each([
    ["abc"],
    [{ amount: 1 }],
    [[1]],
    [""],
    ["1e2"],
    ["--1"],
  ])("POST rejects malformed header discount %p", async (bad) => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-HDR-BAD",
        issue_date: "2026-07-01",
        discount_amount: bad,
        apply_taxes: false,
        items: [{ description: "x", qty: 1, unit_price: 100, discount_amount: 0 }],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("unsupported_bill_level_discount")
  })

  it("POST allows omitted header discount and zero header discount", async () => {
    const { billItemsInsert } = mockCreateClient()
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-HDR-0",
        issue_date: "2026-07-01",
        discount_amount: 0,
        apply_taxes: false,
        items: [{ description: "x", qty: 1, unit_price: 100, discount_amount: 10 }],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(billItemsInsert).toHaveBeenCalled()
    const rows = billItemsInsert.mock.calls[0][0]
    expect(rows[0].discount_amount).toBe(10)
  })

  it("POST allows valid line-level discount without header discount", async () => {
    const { billItemsInsert } = mockCreateClient()
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Vendor",
        bill_number: "B-LINE-1",
        issue_date: "2026-07-01",
        apply_taxes: false,
        items: [{ description: "x", qty: 2, unit_price: 50, discount_amount: 5 }],
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const rows = billItemsInsert.mock.calls[0][0]
    expect(rows[0].discount_amount).toBe(5)
    expect(rows[0].line_subtotal).toBe(95)
  })

  it("PUT rejects non-zero bill_discount_amount", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        bill_discount_amount: 10,
        notes: "n",
      }),
    })

    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("unsupported_bill_level_discount")
  })

  it("PUT rejects malformed header discount", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        discount_amount: "abc",
        notes: "n",
      }),
    })

    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("unsupported_bill_level_discount")
  })
})
