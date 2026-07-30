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
import { GOLDEN_FULL_PAYROLL_1000 } from "@/lib/payrollEngine/__tests__/fixtures/ghanaStatutoryGolden"

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
    basic_salary: GOLDEN_FULL_PAYROLL_1000.basic,
    regular_allowances_amount: 0,
    bonus_amount: 0,
    overtime_amount: 0,
    allowances_total: 0,
    gross_salary: GOLDEN_FULL_PAYROLL_1000.basic,
    deductions_total: 0,
    employee_pension_contribution: GOLDEN_FULL_PAYROLL_1000.employeeSsnit,
    ssnit_employee: GOLDEN_FULL_PAYROLL_1000.employeeSsnit,
    employer_pension_contribution: GOLDEN_FULL_PAYROLL_1000.employerSsnit,
    ssnit_employer: GOLDEN_FULL_PAYROLL_1000.employerSsnit,
    pensionable_base: GOLDEN_FULL_PAYROLL_1000.basic,
    total_mandatory_pension: 185,
    tier1_ssnit_remittance: GOLDEN_FULL_PAYROLL_1000.tier1,
    tier2_pension_remittance: GOLDEN_FULL_PAYROLL_1000.tier2,
    taxable_income: GOLDEN_FULL_PAYROLL_1000.chargeable,
    paye: GOLDEN_FULL_PAYROLL_1000.paye,
    net_salary: GOLDEN_FULL_PAYROLL_1000.net,
    bonus_cap_amount: 1800,
    bonus_concessional_amount: 0,
    bonus_graduated_amount: 0,
    overtime_threshold_amount: 500,
    bonus_tax_5: 0,
    bonus_tax_graduated: 0,
    overtime_tax_5: 0,
    overtime_tax_10: 0,
    overtime_tax_graduated: 0,
    payroll_tax_profile: {
      staff_is_tax_resident: true,
      staff_is_pensionable: true,
      secondary_employment: false,
      employment_type: "temporary",
      income_tax_method: "gh_resident_graduated",
      income_tax_method_version: GHANA_PROFILE_TAX_2024_01.version,
    },
    income_tax_method: "gh_resident_graduated",
    income_tax_method_version: GHANA_PROFILE_TAX_2024_01.version,
    income_tax_regular_base: GOLDEN_FULL_PAYROLL_1000.chargeable,
    income_tax_regular_amount: GOLDEN_FULL_PAYROLL_1000.paye,
    income_tax_bonus_base: 0,
    income_tax_bonus_amount: 0,
    income_tax_overtime_base: 0,
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

  it("blocks missing pensionability snapshot on v3", () => {
    const entry = {
      ...v3TemporaryEntry,
      payroll_tax_profile: {
        staff_is_tax_resident: true,
        secondary_employment: false,
        employment_type: "temporary",
        income_tax_method: "gh_resident_graduated",
        income_tax_method_version: GHANA_PROFILE_TAX_2024_01.version,
      },
    }
    expect(classifyUnsupportedV3Entry(entry, "2026-01-01")).toBe("missing_pensionability_snapshot")
  })

  it("blocks profile/entry income-tax method snapshot mismatch on v3", () => {
    const entry = {
      ...v3TemporaryEntry,
      payroll_tax_profile: {
        ...v3TemporaryEntry.payroll_tax_profile,
        income_tax_method: "gh_casual_flat_5",
      },
    }
    expect(classifyUnsupportedV3Entry(entry, "2026-01-01")).toBe(
      "income_tax_method_snapshot_mismatch"
    )
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
            staff_is_pensionable: true,
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
