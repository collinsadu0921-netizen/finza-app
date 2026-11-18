/**
 * Route-level regression tests for expense pricing mode.
 *
 * These exercise the ACTUAL route handlers (create + retail) with the REAL
 * insertExpenseForBusiness helper and a mock Supabase client that captures the
 * row passed to `.insert(...)`. They prove that `apply_taxes` and
 * `tax_pricing_mode` survive the route → helper boundary and produce the correct
 * persisted amounts (the earlier bug dropped both fields before the helper, so
 * exclusive expenses were persisted as inclusive).
 */

import { NextRequest } from "next/server"
import { POST as createExpenseRoute } from "../create/route"
import { POST as retailExpenseRoute } from "../../retail/expenses/route"

jest.mock("@/lib/supabaseServer", () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock("@/lib/userRoles", () => ({ getUserRole: jest.fn() }))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(),
}))
jest.mock("@/lib/server/fireAfterAccountingPost", () => ({ fireAfterAccountingPost: jest.fn() }))
jest.mock("@vercel/functions", () => ({ waitUntil: jest.fn() }))
jest.mock("@/lib/growth/recordBusinessActivationEvent", () => ({
  voidRecordBusinessActivationEvent: jest.fn(),
}))
jest.mock("@/lib/documents/incomingDocumentsService", () => ({
  getIncomingDocumentForBusiness: jest.fn(),
  linkIncomingDocumentToEntity: jest.fn(),
}))
jest.mock("@/lib/archivedBusiness", () => ({
  assertBusinessNotArchived: jest.fn(() => Promise.resolve()),
}))
jest.mock("@/lib/accountingBootstrap", () => ({
  ensureAccountingInitialized: jest.fn(() => Promise.resolve({ error: null })),
}))
jest.mock("@/lib/auditLog", () => ({ createAuditLog: jest.fn(() => Promise.resolve()) }))
jest.mock("@/lib/retail/expenseAccess", () => ({
  gateRetailExpenseBusiness: jest.fn(),
  assertRetailExpenseAction: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"
import { gateRetailExpenseBusiness, assertRetailExpenseAction } from "@/lib/retail/expenseAccess"

type CapturedRow = Record<string, unknown>

function makeSupabaseMock(captured: CapturedRow[]) {
  return {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: "user-1" } }, error: null })),
    },
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { address_country: "GH", default_currency: "GHS" }, error: null }),
            }),
          }),
        }
      }
      if (table === "expenses") {
        return {
          insert: (row: CapturedRow) => {
            captured.push(row)
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: "exp-1", ...row }, error: null }),
              }),
            }
          },
        }
      }
      return {}
    }),
  }
}

function jsonReq(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body) })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getUserRole as jest.Mock).mockResolvedValue("admin")
  ;(enforceServiceIndustryFinancialWrite as jest.Mock).mockResolvedValue(null)
  ;(gateRetailExpenseBusiness as jest.Mock).mockResolvedValue({ ok: true, businessId: "biz-1" })
  ;(assertRetailExpenseAction as jest.Mock).mockResolvedValue({ ok: true })
})

describe("POST /api/expenses/create — pricing mode reaches helper and persists correctly", () => {
  it("exclusive: entered 70,000 net → amount 70,000, tax 14,000, total 84,000, mode exclusive", async () => {
    const captured: CapturedRow[] = []
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabaseMock(captured))

    const res = await createExpenseRoute(
      jsonReq("http://localhost/api/expenses/create", {
        business_id: "biz-1",
        supplier: "Acme",
        amount: 70000,
        apply_taxes: true,
        tax_pricing_mode: "exclusive",
        date: "2026-11-18",
      })
    )

    expect(res.status).toBe(201)
    expect(captured).toHaveLength(1)
    const row = captured[0]
    expect(row.tax_pricing_mode).toBe("exclusive")
    expect(Number(row.amount)).toBe(70000)
    expect(Number(row.nhil)).toBe(1750)
    expect(Number(row.getfund)).toBe(1750)
    expect(Number(row.vat)).toBe(10500)
    expect(Number(row.total)).toBe(84000)
  })

  it("inclusive: entered 84,000 gross → amount 70,000, tax 14,000, total 84,000, mode inclusive", async () => {
    const captured: CapturedRow[] = []
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabaseMock(captured))

    const res = await createExpenseRoute(
      jsonReq("http://localhost/api/expenses/create", {
        business_id: "biz-1",
        supplier: "Acme",
        amount: 84000,
        apply_taxes: true,
        tax_pricing_mode: "inclusive",
        date: "2026-11-18",
      })
    )

    expect(res.status).toBe(201)
    const row = captured[0]
    expect(row.tax_pricing_mode).toBe("inclusive")
    expect(Number(row.amount)).toBe(70000)
    expect(Number(row.total)).toBe(84000)
  })

  it("taxes off: mode still persisted, no tax applied", async () => {
    const captured: CapturedRow[] = []
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabaseMock(captured))

    const res = await createExpenseRoute(
      jsonReq("http://localhost/api/expenses/create", {
        business_id: "biz-1",
        supplier: "Acme",
        amount: 70000,
        apply_taxes: false,
        tax_pricing_mode: "exclusive",
        date: "2026-11-18",
      })
    )

    expect(res.status).toBe(201)
    const row = captured[0]
    expect(row.tax_pricing_mode).toBe("exclusive")
    expect(Number(row.amount)).toBe(70000)
    expect(Number(row.total)).toBe(70000)
    expect(Number(row.nhil)).toBe(0)
    expect(Number(row.vat)).toBe(0)
  })
})

describe("POST /api/retail/expenses — pricing mode reaches helper and persists correctly", () => {
  it("exclusive: entered 70,000 net → amount 70,000, tax 14,000, total 84,000, mode exclusive", async () => {
    const captured: CapturedRow[] = []
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabaseMock(captured))

    const res = await retailExpenseRoute(
      jsonReq("http://localhost/api/retail/expenses", {
        supplier: "Acme",
        amount: 70000,
        apply_taxes: true,
        tax_pricing_mode: "exclusive",
        date: "2026-11-18",
      })
    )

    expect(res.status).toBe(201)
    const row = captured[0]
    expect(row.tax_pricing_mode).toBe("exclusive")
    expect(Number(row.amount)).toBe(70000)
    expect(Number(row.total)).toBe(84000)
    expect(Number(row.vat)).toBe(10500)
  })
})
