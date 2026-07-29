import { validateGhanaPayrollRunForApproval, GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE, GHANA_PAYROLL_UNKNOWN_RATE_VERSION } from "@/lib/payroll/ghanaApprovalGuards"
import { GHANA_CALCULATION_ENGINE_VERSION } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"

describe("Ghana payroll approval guards (API-facing)", () => {
  const run = {
    calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-01-01",
    payroll_frequency: "monthly",
  }

  it("returns structured unsupported tax profile code", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run,
      entries: [
        {
          staff_id: "e1",
          is_included: true,
          calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
          paye_rate_version: "gh-paye-2024-01",
          pension_rate_version: "gh-pension-2026-01",
          payroll_tax_profile: { staff_is_tax_resident: false },
          filing_employee_name: "Ada",
          staff: { id: "e1", name: "Ada", employment_type: "full_time", is_tax_resident: false },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE)
      expect(result.affectedEmployees).toEqual([
        expect.objectContaining({
          staffId: "e1",
          employeeName: "Ada",
          unsupportedClassification: "non_resident",
        }),
      ])
    }
  })

  it("returns unknown rate version when run versions missing", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: { ...run, calculation_engine_version: null },
      entries: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(GHANA_PAYROLL_UNKNOWN_RATE_VERSION)
  })
})
