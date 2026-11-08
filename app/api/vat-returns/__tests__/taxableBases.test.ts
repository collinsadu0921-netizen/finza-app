import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST as calculatePost } from "../calculate/route"
import { POST as createPost } from "../create/route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  resolveProfessionalVatBusinessId: jest.fn(() =>
    Promise.resolve({ businessId: "biz-1" })
  ),
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
  warnings: [],
}

function setupSupabase(options: {
  bases?: Record<string, unknown>
  basesError?: { message: string } | null
  overlap?: Array<Record<string, unknown>>
  insert?: jest.Mock
}) {
  const insert =
    options.insert ||
    jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() =>
          Promise.resolve({ data: { id: "vat-1" }, error: null })
        ),
      })),
    }))

  const rpc = jest.fn((name: string) => {
    if (name === "extract_tax_return_from_ledger") {
      return Promise.resolve({ data: ledgerRows, error: null })
    }
    if (name === "extract_vat_taxable_bases") {
      return Promise.resolve({
        data: options.bases ?? completeBases,
        error: options.basesError ?? null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  })

  const mockSupabase = {
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
                Promise.resolve({
                  data: { address_country: "Ghana", vat_scheme: "standard" },
                  error: null,
                })
              ),
            })),
          })),
        }
      }
      if (table === "vat_returns") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() => ({
                lte: jest.fn(() => ({
                  gte: jest.fn(() => ({
                    limit: jest.fn(() =>
                      Promise.resolve({
                        data: options.overlap ?? [],
                        error: null,
                      })
                    ),
                  })),
                })),
              })),
            })),
          })),
          insert,
        }
      }
      return {}
    }),
    rpc,
  }

  const { createSupabaseServerClient } = require("@/lib/supabaseServer")
  ;(createSupabaseServerClient as jest.Mock).mockReturnValue(mockSupabase)
  return { rpc, insert }
}

function request(path: string, body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify({
      business_id: "biz-1",
      period_start_date: "2026-03-01",
      period_end_date: "2026-03-31",
      ...body,
    }),
    headers: { "Content-Type": "application/json" },
  })
}

describe("VAT return taxable bases - calculate", () => {
  beforeEach(() => jest.clearAllMocks())

  it("uses extracted bases and includes zero-rated in taxable sales", async () => {
    setupSupabase({})

    const response = await calculatePost(request("/api/vat-returns/calculate"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.calculation.total_standard_rated_sales).toBe(100)
    expect(body.calculation.total_taxable_sales).toBe(150)
    expect(body.calculation.total_zero_rated_sales).toBe(50)
    expect(body.calculation.total_exempt_sales).toBe(25)
    expect(body.calculation.total_taxable_purchases).toBe(40)
    expect(body.calculation.taxable_bases_source).toBe("provided")
    expect(body.data_quality_exception).toBeUndefined()
  })

  it("surfaces a data-quality exception when output VAT has no sales base", async () => {
    setupSupabase({
      bases: { ...completeBases, standard_rated_sales: 0, zero_rated_sales: 0 },
    })

    const response = await calculatePost(request("/api/vat-returns/calculate"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data_quality_exception.code).toBe(
      "VAT_TAXABLE_SALES_UNRECONCILED"
    )
  })

  it("fails when taxable-base extraction is unavailable", async () => {
    setupSupabase({ basesError: { message: "rpc unavailable" } })

    const response = await calculatePost(request("/api/vat-returns/calculate"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe("VAT_TAXABLE_BASE_UNAVAILABLE")
  })
})

describe("VAT return taxable bases - create", () => {
  beforeEach(() => jest.clearAllMocks())

  it("persists standard, zero-rated and exempt bases", async () => {
    const { insert } = setupSupabase({})

    const response = await createPost(request("/api/vat-returns/create"))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.vatReturn.id).toBe("vat-1")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        total_taxable_sales: 150,
        total_zero_rated_sales: 50,
        total_exempt_sales: 25,
        total_taxable_purchases: 40,
      })
    )
  })

  it("blocks creation when output VAT has no standard-rated sales base", async () => {
    const { insert } = setupSupabase({
      bases: { ...completeBases, standard_rated_sales: 0, zero_rated_sales: 0 },
    })

    const response = await createPost(request("/api/vat-returns/create"))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe("VAT_TAXABLE_SALES_UNRECONCILED")
    expect(insert).not.toHaveBeenCalled()
  })

  it("blocks creation when taxable bases are unavailable", async () => {
    setupSupabase({ basesError: { message: "rpc unavailable" } })

    const response = await createPost(request("/api/vat-returns/create"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe("VAT_TAXABLE_BASE_UNAVAILABLE")
  })
})
