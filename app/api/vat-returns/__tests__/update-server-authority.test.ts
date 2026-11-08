import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { PUT } from "../[id]/route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(() => Promise.resolve(null)),
  enforceServiceWorkspaceWriteAccess: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))

const ledgerRows = [
  { tax_code: "VAT", period_debits: 0, period_credits: 15 },
  { tax_code: "NHIL", period_debits: 0, period_credits: 2.5 },
  { tax_code: "GETFund", period_debits: 0, period_credits: 2.5 },
]

const completeBases = {
  standard_rated_sales: 100,
  zero_rated_sales: 50,
  exempt_sales: 25,
  standard_rated_purchases: 40,
  zero_rated_purchases: 0,
  exempt_purchases: 0,
  ledger_revenue_credits: 175,
  unclassified_sales_count: 0,
  unclassified_purchases_count: 0,
  fallback_sales_count: 0,
  fallback_purchases_count: 0,
  invalid_fx_count: 0,
  classification_conflict_count: 0,
  unsupported_fx_credit_note_count: 0,
  warnings: [],
}

const existingReturn = {
  id: "vat-1",
  business_id: "biz-1",
  status: "draft",
  period_start_date: "2026-03-01",
  period_end_date: "2026-03-31",
  output_adjustment: 0,
  input_adjustment: 0,
  adjustment_reason: null,
  submission_date: null,
  notes: null,
}

function setup(options: { bases?: Record<string, unknown> } = {}) {
  let updateData: Record<string, unknown> | null = null

  const mockSupabase = {
    auth: {
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
      ),
    },
    from: jest.fn((table: string) => {
      if (table === "vat_returns") {
        const chain: any = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.is = jest.fn(() => ({
          maybeSingle: jest.fn(() =>
            Promise.resolve({ data: existingReturn, error: null })
          ),
        }))
        chain.update = jest.fn((row: Record<string, unknown>) => {
          updateData = row
          return {
            eq: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: { ...existingReturn, ...row },
                    error: null,
                  })
                ),
              })),
            })),
          }
        })
        return chain
      }
      return {}
    }),
    rpc: jest.fn((name: string) => {
      if (name === "extract_tax_return_from_ledger") {
        return Promise.resolve({ data: ledgerRows, error: null })
      }
      if (name === "extract_vat_taxable_bases") {
        return Promise.resolve({
          data: options.bases ?? completeBases,
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }),
  }

  const { createSupabaseServerClient } = require("@/lib/supabaseServer")
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)
  return { getUpdateData: () => updateData }
}

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/vat-returns/vat-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

describe("VAT return update uses server-authoritative figures", () => {
  beforeEach(() => jest.clearAllMocks())

  it("ignores forged client totals and recalculates from ledger evidence", async () => {
    const { getUpdateData } = setup()

    const response = await PUT(request({
      total_taxable_sales: 999999,
      total_output_vat: 999999,
      net_vat_payable: 999999,
      notes: "draft edit",
    }), { params: { id: "vat-1" } })

    expect(response.status).toBe(200)
    const updateData = getUpdateData()!
    expect(updateData.total_taxable_sales).toBe(150)
    expect(updateData.total_zero_rated_sales).toBe(50)
    expect(updateData.total_exempt_sales).toBe(25)
    expect(updateData.total_output_vat).toBe(15)
    expect(updateData.net_vat_payable).not.toBe(999999)
    expect(updateData.notes).toBe("draft edit")
  })

  it("blocks submission when evidence is unclassified", async () => {
    setup({
      bases: { ...completeBases, unclassified_sales_count: 1 },
    })

    const response = await PUT(request({ status: "submitted" }), {
      params: { id: "vat-1" },
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("VAT_TAXABLE_BASE_UNCLASSIFIED")
  })

  it("blocks submission when a standard document fell back to its subtotal", async () => {
    setup({
      bases: { ...completeBases, fallback_purchases_count: 1 },
    })

    const response = await PUT(request({ status: "submitted" }), {
      params: { id: "vat-1" },
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("VAT_TAXABLE_BASE_FALLBACK")
  })
})
