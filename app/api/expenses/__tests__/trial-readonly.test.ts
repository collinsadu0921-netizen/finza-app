/**
 * Expense API blocks financial writes when subscription is read-only locked.
 */

import { POST as createExpense } from "../create/route"
import { PUT as updateExpense, DELETE as deleteExpense } from "../[id]/route"
import { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { TRIAL_EXPIRED_READ_ONLY_MESSAGE } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(() => Promise.resolve({ id: "biz-1" })),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(() => Promise.resolve("owner")),
}))
jest.mock("@/lib/expenses/insertExpenseForBusiness", () => ({
  insertExpenseForBusiness: jest.fn(() =>
    Promise.resolve({ ok: true, expense: { id: "exp-1" } })
  ),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite", () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceIndustryFinancialWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite"

function lockedWriteResponse() {
  return NextResponse.json(
    {
      error: TRIAL_EXPIRED_READ_ONLY_MESSAGE,
      code: "TRIAL_EXPIRED_READ_ONLY",
    },
    { status: 403 }
  )
}

describe("Expense APIs — trial read-only lock", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(enforceServiceIndustryFinancialWrite as jest.Mock).mockImplementation(() =>
      Promise.resolve(lockedWriteResponse())
    )
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({ data: { user: { id: "user-1" } }, error: null })
        ),
      },
    })
  })

  it("POST /api/expenses/create returns TRIAL_EXPIRED_READ_ONLY when write guard blocks", async () => {
    const req = new NextRequest("http://localhost/api/expenses/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: "biz-1",
        supplier: "Acme",
        amount: 50,
        date: "2026-06-01",
      }),
    })

    const res = await createExpense(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TRIAL_EXPIRED_READ_ONLY")
    expect(enforceServiceIndustryFinancialWrite).toHaveBeenCalled()
  })

  it("DELETE /api/expenses/[id] returns TRIAL_EXPIRED_READ_ONLY when write guard blocks", async () => {
    const req = new NextRequest("http://localhost/api/expenses/exp-1", {
      method: "DELETE",
    })

    const res = await deleteExpense(req, { params: Promise.resolve({ id: "exp-1" }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TRIAL_EXPIRED_READ_ONLY")
  })

  it("PUT /api/expenses/[id] returns TRIAL_EXPIRED_READ_ONLY when write guard blocks", async () => {
    const req = new NextRequest("http://localhost/api/expenses/exp-1", {
      method: "PUT",
      body: JSON.stringify({
        business_id: "biz-1",
        supplier: "Acme",
        amount: 60,
        date: "2026-06-01",
      }),
    })

    const res = await updateExpense(req, { params: Promise.resolve({ id: "exp-1" }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TRIAL_EXPIRED_READ_ONLY")
  })
})
