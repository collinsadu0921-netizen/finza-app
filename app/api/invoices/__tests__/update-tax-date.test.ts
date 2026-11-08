import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { PUT } from "../[id]/route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(() =>
    Promise.resolve({ ok: true, businessId: "biz-1" })
  ),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(() => Promise.resolve("owner")),
}))
jest.mock("@/lib/documentState", () => ({
  canEditInvoice: jest.fn(() => true),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock("@/lib/accounting/reconciliation/engine-impl", () => ({
  createReconciliationEngine: jest.fn(),
}))
jest.mock("@/lib/accounting/reconciliation/mismatch-logger", () => ({
  logReconciliationMismatch: jest.fn(),
}))
jest.mock("@/lib/invoices/validateInvoiceLineMaterials", () => ({
  validateInvoiceLineMaterials: jest.fn(),
  mapInvoiceItemsForInsert: jest.fn(() => []),
}))
jest.mock("@/lib/invoices/invoiceMaterialReturnUi", () => ({
  lineFulfilledQuantity: jest.fn(() => 0),
  lineReturnedQuantity: jest.fn(() => 0),
  remainingToFulfilQuantity: jest.fn(() => 0),
  returnableQuantity: jest.fn(() => 0),
}))
jest.mock("@/lib/taxEngine", () => ({
  calculateTaxes: jest.fn(() => ({
    subtotal_excl_tax: 100,
    total_incl_tax: 120,
    taxLines: [{ code: "VAT", amount: 20 }],
  })),
  getLegacyTaxAmounts: jest.fn(() => ({
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 20,
    totalTax: 20,
    grandTotal: 120,
  })),
}))
jest.mock("@/lib/taxEngine/adapters", () => ({
  legacyToCanonicalResult: jest.fn(() => ({ lines: [] })),
}))
jest.mock("@/lib/taxEngine/helpers", () => ({
  deriveLegacyGhanaTaxAmounts: jest.fn(() => ({
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 20,
  })),
  getTaxEngineCode: jest.fn(() => "ghana"),
}))
jest.mock("@/lib/taxEngine/jurisdictions/ghana-shared", () => ({
  getGhanaEngineVersion: jest.fn(() => "GH-2025-A"),
}))
jest.mock("@/lib/taxEngine/serialize", () => ({
  toTaxLinesJsonb: jest.fn(() => ({ lines: [] })),
}))
jest.mock("@/lib/tax/ghanaTaxScheduleMetadata", () => ({
  fetchGhanaEvatLevyScheduleMetadataMap: jest.fn(() => Promise.resolve(new Map())),
  enrichGhanaTaxResultWithScheduleMetadata: jest.fn((result) => result),
}))

const existingInvoice = {
  id: "inv-1",
  business_id: "biz-1",
  status: "draft",
  sent_at: null,
  paid_at: null,
  apply_taxes: true,
  invoice_number: null,
  issue_date: "2026-01-15",
}

const existingItems = [
  {
    description: "Service",
    qty: 1,
    unit_price: 120,
    discount_amount: 0,
    product_service_id: null,
    product_id: null,
    material_id: null,
  },
]

function setup() {
  let updateData: Record<string, unknown> | null = null

  const invoicesChain: any = {}
  invoicesChain.select = jest.fn(() => {
    const chain: any = {}
    chain.eq = jest.fn(() => chain)
    chain.single = jest.fn(() =>
      Promise.resolve({ data: existingInvoice, error: null })
    )
    return chain
  })
  invoicesChain.update = jest.fn((row: Record<string, unknown>) => {
    updateData = row
    return {
      eq: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() =>
            Promise.resolve({
              data: { ...existingInvoice, ...row },
              error: null,
            })
          ),
        })),
      })),
    }
  })

  const mockSupabase = {
    auth: {
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
      ),
    },
    from: jest.fn((table: string) => {
      if (table === "invoices") return invoicesChain
      if (table === "invoice_items") {
        const chain: any = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.order = jest.fn(() => Promise.resolve({ data: existingItems, error: null }))
        chain.delete = jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        }))
        chain.insert = jest.fn(() => Promise.resolve({ error: null }))
        return chain
      }
      if (table === "businesses") {
        const chain: any = {}
        chain.select = jest.fn(() => chain)
        chain.eq = jest.fn(() => chain)
        chain.single = jest.fn(() =>
          Promise.resolve({ data: { address_country: "Ghana" }, error: null })
        )
        return chain
      }
      if (table === "products_services") {
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        }
      }
      return {}
    }),
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  }

  const { createSupabaseServerClient } = require("@/lib/supabaseServer")
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)
  return { getUpdateData: () => updateData }
}

describe("draft invoice issue-date update", () => {
  beforeEach(() => jest.clearAllMocks())

  it("recalculates tax from existing lines when only the issue date changes", async () => {
    const { getUpdateData } = setup()
    const request = new NextRequest("http://localhost/api/invoices/inv-1", {
      method: "PUT",
      body: JSON.stringify({ issue_date: "2025-12-31" }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await PUT(request, { params: { id: "inv-1" } })

    expect(response.status).toBe(200)
    const updateData = getUpdateData()!
    expect(updateData.issue_date).toBe("2025-12-31")
    expect(updateData.tax_engine_effective_from).toBe("2025-12-31")
    expect(updateData.total_tax).toBe(20)
    expect(updateData.total).toBe(120)

    const { calculateTaxes } = require("@/lib/taxEngine") as {
      calculateTaxes: jest.Mock
    }
    expect(calculateTaxes).toHaveBeenCalledWith(
      [{ quantity: 1, unit_price: 120, discount_amount: 0 }],
      "Ghana",
      "2025-12-31",
      true
    )
  })
})
