/**
 * Supplier relationship must persist on create/update and stay tenant-scoped.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { POST } from "../create/route"
import { PUT, GET } from "../[id]/route"
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
const OTHER_BIZ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const BILL_ID = "bill4444-4444-4444-8444-444444444444"
const SUPPLIER_A = "saaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SUPPLIER_B = "sbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const FORGED = "sfffffff-ffff-4fff-8fff-ffffffffffff"

describe("bill supplier persistence", () => {
  let lastInsert: Record<string, unknown> | null
  let lastUpdate: Record<string, unknown> | null
  let storedBill: Record<string, unknown>
  let supplierById: Record<string, { id: string; name: string; phone: string | null; email: string | null; business_id: string }>

  beforeEach(() => {
    jest.clearAllMocks()
    lastInsert = null
    lastUpdate = null
    storedBill = {
      id: BILL_ID,
      business_id: BUSINESS_ID,
      supplier_id: SUPPLIER_A,
      supplier_name: "Supplier A",
      status: "draft",
      total: 10,
      currency_code: null,
      fx_rate: null,
    }
    supplierById = {
      [SUPPLIER_A]: {
        id: SUPPLIER_A,
        name: "Supplier A",
        phone: "0201",
        email: "a@t.test",
        business_id: BUSINESS_ID,
      },
      [SUPPLIER_B]: {
        id: SUPPLIER_B,
        name: "Supplier B",
        phone: "0202",
        email: "b@t.test",
        business_id: BUSINESS_ID,
      },
      [FORGED]: {
        id: FORGED,
        name: "Other Biz",
        phone: null,
        email: null,
        business_id: OTHER_BIZ,
      },
    }

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
        if (table === "suppliers") {
          return {
            select: jest.fn(() => {
              const filters: Record<string, string> = {}
              const chain = {
                eq: jest.fn((col: string, val: string) => {
                  filters[col] = val
                  return chain
                }),
                maybeSingle: jest.fn(async () => {
                  const row = supplierById[filters.id]
                  if (!row || row.business_id !== filters.business_id) {
                    return { data: null, error: null }
                  }
                  return { data: row, error: null }
                }),
              }
              return chain
            }),
          }
        }
        if (table === "businesses") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({ data: { default_currency: "GHS" }, error: null })
                ),
                maybeSingle: jest.fn(() =>
                  Promise.resolve({ data: { default_currency: "GHS" }, error: null })
                ),
              })),
            })),
          }
        }
        if (table === "bills") {
          return {
            insert: jest.fn((row: Record<string, unknown>) => {
              lastInsert = row
              storedBill = { ...storedBill, ...row, id: BILL_ID }
              return {
                select: jest.fn(() => ({
                  single: jest.fn(() => Promise.resolve({ data: storedBill, error: null })),
                })),
              }
            }),
            update: jest.fn((row: Record<string, unknown>) => {
              lastUpdate = row
              storedBill = { ...storedBill, ...row }
              return {
                eq: jest.fn(() => ({
                  select: jest.fn(() => ({
                    single: jest.fn(() => Promise.resolve({ data: storedBill, error: null })),
                  })),
                })),
              }
            }),
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  is: jest.fn(() => ({
                    single: jest.fn(() => Promise.resolve({ data: storedBill, error: null })),
                  })),
                  single: jest.fn(() => Promise.resolve({ data: storedBill, error: null })),
                })),
              })),
            })),
          }
        }
        if (table === "bill_items") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ error: null })),
            })),
            insert: jest.fn(() => Promise.resolve({ error: null })),
          }
        }
        if (table === "bill_payments") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => ({
                  order: jest.fn(() => Promise.resolve({ data: [], error: null })),
                })),
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

  it("create stores the selected supplier_id", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-SUP-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
        items: [{ description: "Item", qty: 1, unit_price: 10, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.supplier_id).toBe(SUPPLIER_A)
    expect(lastInsert?.supplier_name).toBe("Supplier A")
  })

  it("GET returns the stored supplier_id for reload/hydrate", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`)
    const res = await GET(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bill.supplier_id).toBe(SUPPLIER_A)
    expect(body.bill.supplier_name).toBe("Supplier A")
  })

  it("edit changes supplier_id", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        supplier_id: SUPPLIER_B,
        supplier_name: "Supplier B",
        bill_number: "B-SUP-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
      }),
    })
    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(200)
    expect(lastUpdate?.supplier_id).toBe(SUPPLIER_B)
  })

  it("unrelated field save without supplier_id does not clear the link", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        supplier_name: "Supplier A",
        notes: "updated notes only",
        bill_number: "B-SUP-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
      }),
    })
    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(200)
    expect(lastUpdate).not.toHaveProperty("supplier_id")
    expect(storedBill.supplier_id).toBe(SUPPLIER_A)
  })

  it("allows a name-only bill with null supplier_id", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: null,
        supplier_name: "Walk-in vendor",
        bill_number: "B-SUP-2",
        issue_date: "2026-08-01",
        apply_taxes: false,
        items: [{ description: "Item", qty: 1, unit_price: 10, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.supplier_id).toBeNull()
    expect(lastInsert?.supplier_name).toBe("Walk-in vendor")
  })

  it("rejects a forged cross-business supplier_id", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: FORGED,
        supplier_name: "Other Biz",
        bill_number: "B-SUP-3",
        issue_date: "2026-08-01",
        apply_taxes: false,
        items: [{ description: "Item", qty: 1, unit_price: 10, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(lastInsert).toBeNull()
  })

  it("explicit null supplier_id on update clears the relationship", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        supplier_id: null,
        supplier_name: "Walk-in vendor",
        bill_number: "B-SUP-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
      }),
    })
    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(200)
    expect(lastUpdate?.supplier_id).toBeNull()
    expect(storedBill.supplier_id).toBeNull()
  })

  it("rejects forged supplier_id on update", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        supplier_id: FORGED,
        supplier_name: "Other Biz",
        bill_number: "B-SUP-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
      }),
    })
    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(400)
    expect(lastUpdate).toBeNull()
    expect(storedBill.supplier_id).toBe(SUPPLIER_A)
  })
})
