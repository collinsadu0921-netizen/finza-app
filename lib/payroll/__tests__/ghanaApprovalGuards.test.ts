import {
  validateGhanaPayrollRunForApproval,
  classifyUnsupportedV3Entry,
  GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE,
  GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
  GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
} from "@/lib/payroll/ghanaApprovalGuards"
import {
  GHANA_CALCULATION_ENGINE_VERSION,
  GHANA_NEW_RUN_ENGINE_VERSION,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import { GHANA_PROFILE_TAX_2024_01 } from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"

describe("Ghana payroll approval guards (API-facing)", () => {
  const run = {
    calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-01-01",
    payroll_frequency: "monthly",
  }

  const supportedProfile = {
    staff_is_tax_resident: true,
    secondary_employment: false,
    employment_type: "full_time",
  }

  it("returns structured unsupported tax profile code from snapshot", () => {
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
          calculation_jurisdiction: "GH",
          statutory_period_basis: "2026-01-01",
          payroll_tax_profile: {
            staff_is_tax_resident: false,
            secondary_employment: false,
            employment_type: "full_time",
          },
          filing_employee_name: "Ada",
          staff: { id: "e1", name: "Ada", employment_type: "full_time", is_tax_resident: true },
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

  it("blocks casual snapshot even when live staff is full_time", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run,
      entries: [
        {
          staff_id: "e-cas",
          is_included: true,
          calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
          paye_rate_version: "gh-paye-2024-01",
          pension_rate_version: "gh-pension-2026-01",
          calculation_jurisdiction: "GH",
          statutory_period_basis: "2026-01-01",
          payroll_tax_profile: { ...supportedProfile, employment_type: "casual" },
          filing_employee_name: "Casual Snap",
          staff: {
            id: "e-cas",
            name: "Casual Snap",
            employment_type: "full_time",
            is_tax_resident: true,
            secondary_employment: false,
          },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE)
      expect(result.affectedEmployees[0].unsupportedClassification).toBe("casual_worker")
    }
  })

  it("blocks temporary snapshot even when live staff is permanent", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run,
      entries: [
        {
          staff_id: "e-tmp",
          is_included: true,
          calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
          paye_rate_version: "gh-paye-2024-01",
          pension_rate_version: "gh-pension-2026-01",
          calculation_jurisdiction: "GH",
          statutory_period_basis: "2026-01-01",
          payroll_tax_profile: { ...supportedProfile, employment_type: "temporary" },
          filing_employee_name: "Temp Snap",
          staff: {
            id: "e-tmp",
            name: "Temp Snap",
            employment_type: "permanent",
            is_tax_resident: true,
            secondary_employment: false,
          },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.affectedEmployees[0].unsupportedClassification).toBe("temporary_worker")
    }
  })

  it("fails statutory validation when tax profile snapshot fields are missing", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run,
      entries: [
        {
          staff_id: "e-miss",
          is_included: true,
          calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
          paye_rate_version: "gh-paye-2024-01",
          pension_rate_version: "gh-pension-2026-01",
          calculation_jurisdiction: "GH",
          statutory_period_basis: "2026-01-01",
          payroll_tax_profile: { staff_is_tax_resident: true, secondary_employment: false },
          filing_employee_name: "Missing Emp",
          staff: { employment_type: "full_time" },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED)
      expect(result.affectedEmployees[0].unsupportedClassification).toBe("missing_tax_profile_snapshot")
    }
  })
})

describe("Ghana payroll approval guards — v3", () => {
  const runV3 = {
    calculation_engine_version: GHANA_NEW_RUN_ENGINE_VERSION,
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-01-01",
    payroll_frequency: "monthly",
  }

  const v3TemporaryEntry = {
    staff_id: "e-tmp-v3",
    is_included: true,
    calculation_engine_version: GHANA_NEW_RUN_ENGINE_VERSION,
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-01-01",
    paye: 56.13,
    payroll_tax_profile: {
      staff_is_tax_resident: true,
      secondary_employment: false,
      employment_type: "temporary",
      income_tax_method: "gh_resident_graduated",
      income_tax_method_version: GHANA_PROFILE_TAX_2024_01.version,
    },
    income_tax_method: "gh_resident_graduated",
    income_tax_method_version: GHANA_PROFILE_TAX_2024_01.version,
    income_tax_regular_amount: 56.13,
    income_tax_bonus_amount: 0,
    income_tax_overtime_amount: 0,
    filing_employee_name: "Temp V3",
  }

  it("allows resident temporary worker on v3 when income-tax snapshot is complete", () => {
    expect(classifyUnsupportedV3Entry(v3TemporaryEntry, "2026-01-01")).toBeNull()
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: runV3,
      entries: [v3TemporaryEntry],
    })
    expect(result.ok).toBe(true)
  })

  it("blocks secondary employment on v3 with new classification", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: runV3,
      entries: [
        {
          ...v3TemporaryEntry,
          staff_id: "e-sec-v3",
          payroll_tax_profile: {
            staff_is_tax_resident: true,
            secondary_employment: true,
            employment_type: "full_time",
            income_tax_method: "gh_resident_graduated",
            income_tax_method_version: GHANA_PROFILE_TAX_2024_01.version,
          },
          filing_employee_name: "Secondary V3",
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE)
      expect(result.affectedEmployees[0].unsupportedClassification).toBe(
        "secondary_employment_requires_verified_withholding_method"
      )
    }
  })
})
