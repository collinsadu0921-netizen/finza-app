import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import {
  GHANA_ENGINE_V3,
  GHANA_NEW_RUN_ENGINE_VERSION,
  assertGhanaProfileTaxVersionCoversPeriod,
  calculateGhanaCasualFlatTax,
  calculateGhanaNonResidentSplitTax,
  GHANA_PROFILE_TAX_2024_01,
  resolveGhanaIncomeTaxMethodFromProfile,
} from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"
import { goldenCalculatePaye, goldenPensionFromBase } from "./fixtures/ghanaStatutoryGolden"

describe("Ghana v3 profile-tax — unit golden", () => {
  it("profile tax version covers 2026-01 payroll period", () => {
    expect(() =>
      assertGhanaProfileTaxVersionCoversPeriod(GHANA_PROFILE_TAX_2024_01.version, "2026-01-01")
    ).not.toThrow()
  })

  it("casual flat 5% on gross 2000", () => {
    const result = calculateGhanaCasualFlatTax({
      grossRemuneration: 2000,
      rates: GHANA_PROFILE_TAX_2024_01,
    })
    expect(result.incomeTaxMethod).toBe("gh_casual_flat_5")
    expect(result.incomeTaxRegularBase).toBe(2000)
    expect(result.incomeTaxRegularAmount).toBe(100)
    expect(result.totalIncomeTax).toBe(100)
  })

  it("non-resident split 25/20 on reference amounts", () => {
    const pension = goldenPensionFromBase(8500).employee
    const result = calculateGhanaNonResidentSplitTax({
      regularEmploymentAmount: 8500,
      employeePension: pension,
      bonusAmount: 1000,
      overtimeAmount: 500,
      rates: GHANA_PROFILE_TAX_2024_01,
    })
    expect(result.incomeTaxMethod).toBe("gh_nonresident_split_25_20")
    expect(result.incomeTaxRegularBase).toBe(8500 - pension)
    expect(result.incomeTaxRegularAmount).toBe(Math.round((8500 - pension) * 0.25 * 100) / 100)
    expect(result.incomeTaxBonusAmount).toBe(200)
    expect(result.incomeTaxOvertimeAmount).toBe(100)
    expect(result.totalIncomeTax).toBe(
      result.incomeTaxRegularAmount + result.incomeTaxBonusAmount + result.incomeTaxOvertimeAmount
    )
  })

  it("resident temporary resolves to graduated method", () => {
    const resolved = resolveGhanaIncomeTaxMethodFromProfile({
      staff_is_tax_resident: true,
      secondary_employment: false,
      employment_type: "temporary",
    })
    expect(resolved).toEqual({ ok: true, method: "gh_resident_graduated" })
  })
})

describe("Ghana v3 profile-tax — computeStaffPayrollEntry wiring", () => {
  const period = "2026-03-01"

  it("defaults new Ghana runs to v3 engine", () => {
    const entry = computeStaffPayrollEntry({
      staff: {
        id: "v3-default",
        name: "Default V3",
        basic_salary: 1000,
        employment_type: "full_time",
        is_tax_resident: true,
        secondary_employment: false,
      },
      businessCountry: "GH",
      effectiveDate: period,
      allowances: [],
      deductions: [],
    })
    expect(entry.calculation_engine_version).toBe(GHANA_NEW_RUN_ENGINE_VERSION)
    expect(entry.income_tax_method).toBe("gh_resident_graduated")
    expect(entry.income_tax_method_version).toBe(GHANA_PROFILE_TAX_2024_01.version)
    const componentSum =
      Number(entry.income_tax_regular_amount) +
      Number(entry.income_tax_bonus_amount) +
      Number(entry.income_tax_overtime_amount)
    expect(Math.abs(componentSum - entry.paye)).toBeLessThanOrEqual(0.01)
  })

  it("casual worker applies 5% flat tax on gross", () => {
    const entry = computeStaffPayrollEntry({
      staff: {
        id: "casual-1",
        name: "Casual Worker",
        basic_salary: 2000,
        employment_type: "casual",
        is_tax_resident: true,
        secondary_employment: false,
      },
      businessCountry: "GH",
      effectiveDate: period,
      allowances: [],
      deductions: [],
      calculationEngineVersion: GHANA_ENGINE_V3,
    })
    expect(entry.income_tax_method).toBe("gh_casual_flat_5")
    expect(entry.paye).toBe(100)
    expect(entry.taxable_income).toBe(2000)
    expect(entry.bonus_tax_5).toBe(0)
    expect(entry.bonus_tax_graduated).toBe(0)
    expect(entry.overtime_tax_graduated).toBe(0)
    expect(entry.payroll_tax_profile?.casual_worker_flat_tax_applied).toBe(true)
  })

  it("non-resident uses split 25/20 rates", () => {
    const entry = computeStaffPayrollEntry({
      staff: {
        id: "nr-1",
        name: "Non Resident",
        basic_salary: 8000,
        employment_type: "full_time",
        is_tax_resident: false,
        secondary_employment: false,
      },
      businessCountry: "GH",
      effectiveDate: period,
      allowances: [
        { type: "transport", amount: 500 },
        { type: "bonus", amount: 1000 },
        { type: "overtime", amount: 500 },
      ],
      deductions: [],
      calculationEngineVersion: GHANA_ENGINE_V3,
    })
    expect(entry.income_tax_method).toBe("gh_nonresident_split_25_20")
    expect(entry.bonus_tax_5).toBe(0)
    expect(entry.bonus_tax_graduated).toBe(entry.income_tax_bonus_amount)
    expect(entry.overtime_tax_graduated).toBe(entry.income_tax_overtime_amount)
    const expectedPension = goldenPensionFromBase(8000).employee
    const expected = calculateGhanaNonResidentSplitTax({
      regularEmploymentAmount: 8500,
      employeePension: expectedPension,
      bonusAmount: 1000,
      overtimeAmount: 500,
      rates: GHANA_PROFILE_TAX_2024_01,
    })
    expect(entry.paye).toBe(expected.totalIncomeTax)
  })

  it("resident temporary uses graduated PAYE", () => {
    const entry = computeStaffPayrollEntry({
      staff: {
        id: "temp-1",
        name: "Temp Worker",
        basic_salary: 1000,
        employment_type: "temporary",
        is_tax_resident: true,
        secondary_employment: false,
      },
      businessCountry: "GH",
      effectiveDate: period,
      allowances: [],
      deductions: [],
      calculationEngineVersion: GHANA_ENGINE_V3,
    })
    expect(entry.income_tax_method).toBe("gh_resident_graduated")
    expect(entry.paye).toBe(goldenCalculatePaye(Number(entry.taxable_income)))
  })

  it("throws for unsupported secondary employment on v3", () => {
    expect(() =>
      computeStaffPayrollEntry({
        staff: {
          id: "sec-1",
          name: "Secondary",
          basic_salary: 1000,
          employment_type: "full_time",
          is_tax_resident: true,
          secondary_employment: true,
        },
        businessCountry: "GH",
        effectiveDate: period,
        allowances: [],
        deductions: [],
        calculationEngineVersion: GHANA_ENGINE_V3,
      })
    ).toThrow(/GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE:secondary_employment_requires_verified_withholding_method/)
  })

  it("v2 path leaves income_tax columns null", () => {
    const entry = computeStaffPayrollEntry({
      staff: {
        id: "v2-1",
        name: "V2 Resident",
        basic_salary: 1000,
        employment_type: "full_time",
        is_tax_resident: true,
        secondary_employment: false,
      },
      businessCountry: "GH",
      effectiveDate: period,
      allowances: [],
      deductions: [],
      calculationEngineVersion: "finza-ghana-v2",
    })
    expect(entry.income_tax_method).toBeNull()
    expect(entry.income_tax_regular_amount).toBeNull()
  })
})
