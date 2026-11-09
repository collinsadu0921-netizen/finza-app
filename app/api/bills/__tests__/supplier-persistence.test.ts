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
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))
jest.mock("@/lib/accounting/requireAccountingWriteRole", () => {
  const actual = jest.requireActual(
    "@/lib/accounting/requireAccountingWriteRole"
  )
  return {
    ...actual,
    requireAccountingWriteRole: jest.fn(),
  }
})
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
import { getUserRole } from "@/lib/userRoles"
import { requireAccountingWriteRole } from "@/lib/accounting/requireAccountingWriteRole"

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
    ;(getUserRole as jest.Mock).mockResolvedValue("owner")
    ;(requireAccountingWriteRole as jest.Mock).mockResolvedValue(null)

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
                is: jest.fn(() => ({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: storedBill, error: null })),
                })),
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
        if (table === "wht_rates") {
          const chain: any = {}
          chain.select = jest.fn(() => chain)
          chain.eq = jest.fn(() => chain)
          chain.lte = jest.fn(() => chain)
          chain.or = jest.fn(() => chain)
          chain.order = jest.fn(() => chain)
          chain.limit = jest.fn(() => chain)
          chain.maybeSingle = jest.fn(() =>
            Promise.resolve({ data: null, error: null })
          )
          return chain
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

  it("ignores forged WHT rate and amount, calculating 7.5% on the pre-tax base", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-WHT-1",
        issue_date: "2026-08-01",
        apply_taxes: true,
        apply_wht: true,
        wht_rate_code: "GH_SVC_75",
        wht_rate: 0.5,
        wht_amount: 9999,
        items: [{ description: "Service", qty: 1, unit_price: 121.9, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.wht_rate_code).toBe("GH_SVC_75")
    expect(lastInsert?.wht_rate).toBe(0.075)
    const base = Number(lastInsert?.subtotal)
    const total = Number(lastInsert?.total)
    expect(base).toBeLessThan(total)
    expect(lastInsert?.wht_amount).toBeCloseTo(Math.round(base * 0.075 * 100) / 100, 2)
    expect(lastInsert?.wht_amount).not.toBeCloseTo(
      Math.round(total * 0.075 * 100) / 100,
      2
    )
  })

  it("allows WHT below the reminder threshold and still calculates it", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-WHT-2",
        issue_date: "2026-08-01",
        apply_taxes: false,
        apply_wht: true,
        wht_rate_code: "GH_SVC_75",
        items: [{ description: "Service", qty: 1, unit_price: 1000, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.wht_rate).toBe(0.075)
    expect(lastInsert?.wht_amount).toBe(75)
  })

  it("rejects an unknown or legacy WHT category for new withholding", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-WHT-3",
        issue_date: "2026-08-01",
        apply_taxes: false,
        apply_wht: true,
        wht_rate_code: "GH_SVC_5",
        wht_rate: 0.075,
        wht_amount: 75,
        items: [{ description: "Service", qty: 1, unit_price: 1000, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("WHT_CATEGORY_INVALID")
    expect(lastInsert).toBeNull()
  })

  it("rejects a pre-2026 bill mixing inventory materials and services", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_name: "Supplier A",
        bill_number: "B-MIXED-PRE-2026",
        issue_date: "2025-12-31",
        apply_taxes: true,
        items: [
          {
            description: "Material",
            qty: 1,
            unit_price: 100,
            discount_amount: 0,
            material_id: "mat-1",
          },
          {
            description: "Service",
            qty: 1,
            unit_price: 50,
            discount_amount: 0,
          },
        ],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("BILL_MIXED_MATERIAL_TAX_UNSUPPORTED")
    expect(lastInsert).toBeNull()
  })

  it("rejects a pre-2026 bill update mixing inventory materials and services", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        issue_date: "2025-12-31",
        apply_taxes: true,
        items: [
          {
            description: "Material",
            qty: 1,
            unit_price: 100,
            discount_amount: 0,
            material_id: "mat-1",
          },
          {
            description: "Service",
            qty: 1,
            unit_price: 50,
            discount_amount: 0,
          },
        ],
      }),
    })
    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("BILL_MIXED_MATERIAL_TAX_UNSUPPORTED")
    expect(lastUpdate).toBeNull()
  })

  it("uses the bill issue date for pre-2026 tax and persists absorbed input levies", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-TAX-2025",
        issue_date: "2025-12-31",
        apply_taxes: true,
        apply_wht: false,
        items: [{ description: "Service", qty: 1, unit_price: 121.9, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.subtotal).toBeCloseTo(100, 2)
    expect(lastInsert?.nhil).toBeCloseTo(2.5, 2)
    expect(lastInsert?.getfund).toBeCloseTo(2.5, 2)
    expect(lastInsert?.covid).toBeCloseTo(1, 2)
    expect(lastInsert?.vat).toBeCloseTo(15.9, 2)
    expect(lastInsert?.total_tax).toBeCloseTo(21.9, 2)
    expect(lastInsert?.tax_engine_effective_from).toBe("2025-12-31")

    const taxLines = (lastInsert?.tax_lines as any)?.tax_lines as any[]
    const byCode = Object.fromEntries(taxLines.map((line) => [line.code, line]))
    expect(byCode.NHIL.ledger_account_code).toBe("5200")
    expect(byCode.NHIL.ledger_side).toBe("debit")
    expect(byCode.NHIL.absorbed_to_cost).toBe(true)
    expect(byCode.NHIL.is_creditable_input).toBe(false)
    expect(byCode.GETFUND.ledger_account_code).toBe("5200")
    expect(byCode.COVID.ledger_account_code).toBe("5200")
    expect(byCode.VAT.ledger_account_code).toBe("2100")
    expect(byCode.VAT.is_creditable_input).toBe(true)
    expect(byCode.VAT.absorbed_to_cost).toBe(false)
  })

  it("uses the bill issue date for post-2026 tax and persists creditable input lines", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-TAX-2026",
        issue_date: "2026-01-01",
        apply_taxes: true,
        apply_wht: false,
        items: [{ description: "Service", qty: 1, unit_price: 120, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.subtotal).toBeCloseTo(100, 2)
    expect(lastInsert?.nhil).toBeCloseTo(2.5, 2)
    expect(lastInsert?.getfund).toBeCloseTo(2.5, 2)
    expect(lastInsert?.covid).toBe(0)
    expect(lastInsert?.vat).toBeCloseTo(15, 2)
    expect(lastInsert?.total_tax).toBeCloseTo(20, 2)
    expect(lastInsert?.tax_engine_effective_from).toBe("2026-01-01")

    const taxLines = (lastInsert?.tax_lines as any)?.tax_lines as any[]
    const byCode = Object.fromEntries(taxLines.map((line) => [line.code, line]))
    expect(byCode.NHIL.ledger_account_code).toBe("2110")
    expect(byCode.NHIL.is_creditable_input).toBe(true)
    expect(byCode.NHIL.absorbed_to_cost).toBe(false)
    expect(byCode.GETFUND.ledger_account_code).toBe("2120")
    expect(byCode.VAT.ledger_account_code).toBe("2100")
    expect(byCode.VAT.is_creditable_input).toBe(true)
  })

  it("persists tax lines in the bill currency for foreign-currency bills", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-TAX-USD",
        issue_date: "2026-01-01",
        currency_code: "USD",
        fx_rate: 15,
        apply_taxes: true,
        apply_wht: false,
        items: [{ description: "Service", qty: 1, unit_price: 120, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.currency_code).toBe("USD")
    expect(lastInsert?.fx_rate).toBe(15)
    expect(lastInsert?.subtotal).toBeCloseTo(100, 2)
    expect(lastInsert?.vat).toBeCloseTo(15, 2)
    expect(lastInsert?.home_currency_total).toBeCloseTo(1800, 2)

    const taxLines = (lastInsert?.tax_lines as any)?.tax_lines as any[]
    const vat = taxLines.find((line) => line.code === "VAT")
    expect(vat?.amount).toBeCloseTo(15, 2)
    expect(vat?.ledger_account_code).toBe("2100")
  })

  it("stores no WHT when the tenant leaves withholding off", async () => {
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-WHT-4",
        issue_date: "2026-08-01",
        apply_taxes: false,
        apply_wht: false,
        wht_rate_code: "GH_SVC_75",
        wht_rate: 0.075,
        wht_amount: 75,
        items: [{ description: "Service", qty: 1, unit_price: 1000, discount_amount: 0 }],
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(lastInsert?.wht_applicable).toBe(false)
    expect(lastInsert?.wht_rate).toBeNull()
    expect(lastInsert?.wht_amount).toBe(0)
  })

  it("recalculates draft bill tax with the new issue date and persists tax lines", async () => {
    const req = new NextRequest(`http://localhost/api/bills/${BILL_ID}`, {
      method: "PUT",
      body: JSON.stringify({
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-TAX-EDIT",
        issue_date: "2025-12-31",
        apply_taxes: true,
        items: [{ description: "Service", qty: 1, unit_price: 121.9, discount_amount: 0 }],
      }),
    })
    const res = await PUT(req, { params: { id: BILL_ID } })
    expect(res.status).toBe(200)
    expect(lastUpdate?.subtotal).toBeCloseTo(100, 2)
    expect(lastUpdate?.nhil).toBeCloseTo(2.5, 2)
    expect(lastUpdate?.getfund).toBeCloseTo(2.5, 2)
    expect(lastUpdate?.covid).toBeCloseTo(1, 2)
    expect(lastUpdate?.vat).toBeCloseTo(15.9, 2)
    expect(lastUpdate?.tax_engine_effective_from).toBe("2025-12-31")

    const taxLines = (lastUpdate?.tax_lines as any)?.tax_lines as any[]
    const byCode = Object.fromEntries(taxLines.map((line) => [line.code, line]))
    expect(byCode.NHIL.ledger_account_code).toBe("5200")
    expect(byCode.NHIL.absorbed_to_cost).toBe(true)
    expect(byCode.VAT.ledger_account_code).toBe("2100")
    expect(byCode.VAT.is_creditable_input).toBe(true)
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

  it("rejects a read-only accountant before any bill insert or posting", async () => {
    ;(requireAccountingWriteRole as jest.Mock).mockResolvedValue({
      status: 403,
      error: "Forbidden: accountant access is read-only",
      code: "ACCOUNTING_WRITE_READ_ONLY",
    })
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-RO-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
        items: [
          { description: "Item", qty: 1, unit_price: 10, discount_amount: 0 },
        ],
        status: "open",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(lastInsert).toBeNull()
    const { fireAfterAccountingPost } = require("@/lib/server/fireAfterAccountingPost")
    expect(fireAfterAccountingPost).not.toHaveBeenCalled()
  })

  it("rejects unauthorized staff before any bill insert or posting", async () => {
    ;(requireAccountingWriteRole as jest.Mock).mockResolvedValue({
      status: 403,
      error: "Forbidden: accounting write authority is required",
      code: "ACCOUNTING_WRITE_PERMISSION_DENIED",
    })
    const req = new NextRequest("http://localhost/api/bills/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        supplier_id: SUPPLIER_A,
        supplier_name: "Supplier A",
        bill_number: "B-STAFF-1",
        issue_date: "2026-08-01",
        apply_taxes: false,
        items: [
          { description: "Item", qty: 1, unit_price: 10, discount_amount: 0 },
        ],
        status: "open",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(lastInsert).toBeNull()
    const { fireAfterAccountingPost } = require("@/lib/server/fireAfterAccountingPost")
    expect(fireAfterAccountingPost).not.toHaveBeenCalled()
  })
})
