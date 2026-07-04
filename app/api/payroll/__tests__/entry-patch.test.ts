/**
 * PATCH /api/payroll/runs/[id]/entries/[entryId] — draft line adjustments
 */

import { PATCH } from "@/app/api/payroll/runs/[id]/entries/[entryId]/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/userPermissions", () => ({
  requirePermission: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/payroll/computeStaffPayrollEntry", () => ({
  computeStaffPayrollEntry: jest.fn(() => ({
    staff_id: "staff-1",
    is_included: false,
    base_salary_snapshot: 3000,
    adjustment_amount: 0,
    adjustment_reason: null,
    exclusion_reason: "Sick",
    basic_salary: 0,
    allowances_total: 0,
    regular_allowances_amount: 0,
    bonus_amount: 0,
    overtime_amount: 0,
    deductions_total: 0,
    gross_salary: 0,
    ssnit_employee: 0,
    ssnit_employer: 0,
    taxable_income: 0,
    paye: 0,
    bonus_tax_5: 0,
    bonus_tax_graduated: 0,
    overtime_tax_5: 0,
    overtime_tax_10: 0,
    overtime_tax_graduated: 0,
    is_qualifying_junior_employee: false,
    bonus_cap_amount: 0,
    overtime_threshold_amount: 0,
    net_salary: 0,
  })),
  isPayrollEngineCountryError: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>
const mockRequirePermission = requirePermission as jest.MockedFunction<typeof requirePermission>

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", address_country: "GH" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("PATCH /api/payroll/runs/[id]/entries/[entryId]", () => {
  it("rejects edits when payroll run is approved", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn((table: string) => {
        if (table === "payroll_runs") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: "run-1", business_id: "biz-1", status: "approved", payroll_month: "2026-01-01" },
              error: null,
            }),
          }
        }
        return {} as any
      }),
    } as any)

    const res = await PATCH(
      new NextRequest("http://localhost/api/payroll/runs/run-1/entries/entry-1", {
        method: "PATCH",
        body: JSON.stringify({ is_included: false }),
      }),
      { params: Promise.resolve({ id: "run-1", entryId: "entry-1" }) }
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/draft/i)
  })
})
