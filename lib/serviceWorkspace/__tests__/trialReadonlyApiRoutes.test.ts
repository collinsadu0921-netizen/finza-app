/**
 * Service trial read-only: one mutation per major financial area returns TRIAL_EXPIRED_READ_ONLY.
 */

import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
      ),
    },
  },
}))

jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(() => Promise.resolve({ id: "biz-1" })),
  requireBusinessScopeForUser: jest.fn(() =>
    Promise.resolve({ ok: true, businessId: "biz-1" })
  ),
  resolveBusinessScopeForUser: jest.fn(() =>
    Promise.resolve({ ok: true, businessId: "biz-1" })
  ),
}))

jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(),
}))

jest.mock("@/lib/accounting/resolveAccountingContext", () => ({
  resolveAccountingContext: jest.fn(() => Promise.resolve({ businessId: "biz-1" })),
}))

jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(() => Promise.resolve({ authorized: true })),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(() => Promise.resolve("owner")),
}))

jest.mock("@/lib/expenses/insertExpenseForBusiness", () => ({
  insertExpenseForBusiness: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingWrite: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"
import { enforceServiceIndustryMinTierWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"
import { enforceServiceIndustryBusinessTierForAccountingWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { mockLockedFinancialWriteResponse, mockSupabaseAuthUser } from "./trialReadonlyMocks"
import { POST as createInvoice } from "@/app/api/invoices/create/route"
import { PUT as updatePayment } from "@/app/api/payments/[id]/route"
import { POST as createBill } from "@/app/api/bills/create/route"
import { POST as createPayrollRun } from "@/app/api/payroll/runs/route"
import { POST as createProforma } from "@/app/api/proforma/create/route"
import { POST as createCreditNote } from "@/app/api/credit-notes/create/route"
import { POST as applyAdjustment } from "@/app/api/accounting/adjustments/apply/route"
import { POST as createExpense } from "@/app/api/expenses/create/route"

describe("Service trial read-only — API mutations", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabaseAuthUser())
    const locked = () => Promise.resolve(mockLockedFinancialWriteResponse())
    ;(enforceServiceIndustryFinancialWrite as jest.Mock).mockImplementation(locked)
    ;(enforceServiceIndustryMinTierWrite as jest.Mock).mockImplementation(locked)
    ;(enforceServiceIndustryBusinessTierForAccountingWrite as jest.Mock).mockImplementation(
      locked
    )
  })

  async function expectReadOnly(res: Response) {
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TRIAL_EXPIRED_READ_ONLY")
  }

  it("POST /api/invoices/create", async () => {
    const res = await createInvoice(
      new NextRequest("http://localhost/api/invoices/create", {
        method: "POST",
        body: JSON.stringify({ customer_id: "c1", items: [] }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryFinancialWrite).toHaveBeenCalled()
  })

  it("PUT /api/payments/[id]", async () => {
    const res = await updatePayment(
      new NextRequest("http://localhost/api/payments/pay-1", {
        method: "PUT",
        body: JSON.stringify({ amount: 10 }),
      }),
      { params: Promise.resolve({ id: "pay-1" }) }
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryFinancialWrite).toHaveBeenCalled()
  })

  it("POST /api/bills/create", async () => {
    const res = await createBill(
      new NextRequest("http://localhost/api/bills/create", {
        method: "POST",
        body: JSON.stringify({
          business_id: "biz-1",
          supplier_name: "Vendor",
          bill_number: "BILL-001",
          issue_date: "2026-06-01",
          items: [{ description: "Item", quantity: 1, unit_price: 10 }],
        }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryMinTierWrite).toHaveBeenCalled()
  })

  it("POST /api/payroll/runs", async () => {
    const res = await createPayrollRun(
      new NextRequest("http://localhost/api/payroll/runs", {
        method: "POST",
        body: JSON.stringify({ payroll_month: "2026-06-01" }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryMinTierWrite).toHaveBeenCalled()
  })

  it("POST /api/proforma/create", async () => {
    const res = await createProforma(
      new NextRequest("http://localhost/api/proforma/create", {
        method: "POST",
        body: JSON.stringify({ customer_id: "c1", items: [] }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryFinancialWrite).toHaveBeenCalled()
  })

  it("POST /api/credit-notes/create", async () => {
    const res = await createCreditNote(
      new NextRequest("http://localhost/api/credit-notes/create", {
        method: "POST",
        body: JSON.stringify({
          business_id: "biz-1",
          invoice_id: "inv-1",
          date: "2026-06-01",
          items: [{ description: "Refund", quantity: 1, price: 10 }],
        }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryFinancialWrite).toHaveBeenCalled()
  })

  it("POST /api/accounting/adjustments/apply", async () => {
    const res = await applyAdjustment(
      new NextRequest("http://localhost/api/accounting/adjustments/apply", {
        method: "POST",
        body: JSON.stringify({
          business_id: "biz-1",
          period_start: "2026-06-01",
          entry_date: "2026-06-15",
          description: "Test",
          lines: [
            { account_id: "a1", debit: 1, credit: 0 },
            { account_id: "a2", debit: 0, credit: 1 },
          ],
          adjustment_reason: "Correction",
        }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryBusinessTierForAccountingWrite).toHaveBeenCalled()
  })

  it("POST /api/expenses/create", async () => {
    const res = await createExpense(
      new NextRequest("http://localhost/api/expenses/create", {
        method: "POST",
        body: JSON.stringify({
          business_id: "biz-1",
          supplier: "Acme",
          amount: 50,
          date: "2026-06-01",
        }),
      })
    )
    await expectReadOnly(res)
    expect(enforceServiceIndustryFinancialWrite).toHaveBeenCalled()
  })
})
