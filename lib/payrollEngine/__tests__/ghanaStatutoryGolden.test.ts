/**
 * Official-source golden tests for Ghana PAYE + SSNIT (finza-ghana-v2).
 * Expected values come from fixtures/ghanaStatutoryGolden.ts — not production rate tables.
 */

import { calculatePayroll } from "@/lib/payrollEngine"
import { calculateGhanaPayeFromBands } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import { ghanaPayrollEngine } from "@/lib/payrollEngine/jurisdictions/ghana"
import { computeStaffPayrollEntry } from "@/lib/payroll/computeStaffPayrollEntry"
import { validateGhanaPayrollRunForApproval } from "@/lib/payroll/ghanaApprovalGuards"
import {
  GOLDEN_FULL_PAYROLL_1000,
  GOLDEN_GHANA_PAYE_2024_BANDS,
  GOLDEN_PAYE_BOUNDARY_TAXABLES,
  GOLDEN_REFERENCE_PAYE,
  GOLDEN_SSNIT_2026,
  goldenCalculatePaye,
  goldenClampPensionableBase,
  goldenPensionFromBase,
  goldenRound2,
} from "./fixtures/ghanaStatutoryGolden"
import {
  getGhanaPayeRatesForPeriod,
  getGhanaPensionRatesForPeriod,
  resolveGhanaStatutoryRatesByVersions,
  resolveGhanaStatutoryRatesForPeriod,
  GHANA_CALCULATION_ENGINE_VERSION,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"

describe("Ghana statutory golden — PAYE boundaries", () => {
  it.each([...GOLDEN_PAYE_BOUNDARY_TAXABLES])(
    "taxable %s matches independent golden PAYE",
    (taxable) => {
      const expected = goldenCalculatePaye(taxable)
      const actual = calculateGhanaPayeFromBands(taxable, [...GOLDEN_GHANA_PAYE_2024_BANDS])
      // Production bands must match golden fixture for 2024 schedule
      const prodBands = getGhanaPayeRatesForPeriod("2026-01-01").bands
      const fromProd = calculateGhanaPayeFromBands(taxable, prodBands)
      expect(actual).toBe(expected)
      expect(fromProd).toBe(expected)
    }
  )

  it("reference: taxable 650 → PAYE 10.50", () => {
    expect(goldenCalculatePaye(GOLDEN_REFERENCE_PAYE.taxable_650.taxable)).toBe(
      GOLDEN_REFERENCE_PAYE.taxable_650.paye
    )
    expect(
      calculateGhanaPayeFromBands(650, getGhanaPayeRatesForPeriod("2026-01-01").bands)
    ).toBe(10.5)
  })

  it("reference: taxable 10000 → PAYE 2098.50", () => {
    expect(goldenCalculatePaye(10000)).toBe(2098.5)
    expect(
      calculateGhanaPayeFromBands(10000, getGhanaPayeRatesForPeriod("2026-01-01").bands)
    ).toBe(2098.5)
  })

  it("reference: taxable 60000 → PAYE 17082.83 (includes 35% band)", () => {
    expect(goldenCalculatePaye(60000)).toBe(17082.83)
    expect(
      calculateGhanaPayeFromBands(60000, getGhanaPayeRatesForPeriod("2026-01-01").bands)
    ).toBe(17082.83)
  })

  it("includes 35% band for income above 50416.67", () => {
    const atEdge = goldenCalculatePaye(50416.67)
    const above = goldenCalculatePaye(51000)
    expect(above).toBeGreaterThan(atEdge)
    expect(atEdge).toBe(13728.67)
  })
})

describe("Ghana statutory golden — full payroll GH¢1000", () => {
  it("resident pensionable basic 1000 matches official reference net", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: "2026-01-01",
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
    })

    const ssnitEe = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
    const ssnitEr = result.employerContributions.find((c) => c.code === "SSNIT_EMPLOYER")
    const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")

    expect(ssnitEe?.amount).toBe(GOLDEN_FULL_PAYROLL_1000.employeeSsnit)
    expect(ssnitEr?.amount).toBe(GOLDEN_FULL_PAYROLL_1000.employerSsnit)
    expect(result.totals.taxableIncome).toBe(GOLDEN_FULL_PAYROLL_1000.chargeable)
    expect(paye?.amount).toBe(GOLDEN_FULL_PAYROLL_1000.paye)
    expect(result.totals.netSalary).toBe(GOLDEN_FULL_PAYROLL_1000.net)
    expect(result.complianceBreakdown?.tier1SsnitRemittance).toBe(GOLDEN_FULL_PAYROLL_1000.tier1)
    expect(result.complianceBreakdown?.tier2PensionRemittance).toBe(GOLDEN_FULL_PAYROLL_1000.tier2)
    expect(1000 - 55 - 56.13).toBeCloseTo(888.87, 2)
  })

  it("accounting shape for GH¢1000: expense + employer pension = paye + net + pension liabilities", () => {
    const gross = 1000
    const er = 130
    const paye = 56.13
    const net = 888.87
    const pensionTotal = 185
    expect(gross + er).toBeCloseTo(paye + net + pensionTotal, 2)
    expect(GOLDEN_FULL_PAYROLL_1000.tier1 + GOLDEN_FULL_PAYROLL_1000.tier2).toBe(185)
  })
})

describe("Ghana statutory golden — SSNIT min/max 2026", () => {
  const period = "2026-06-01"

  it("non-pensionable: zero SSNIT, PAYE on gross", () => {
    const entry = computeStaffPayrollEntry({
      staff: {
        id: "np-1",
        name: "Non Pensionable",
        basic_salary: 1000,
        is_pensionable: false,
        employment_type: "full_time",
      },
      businessCountry: "GH",
      effectiveDate: period,
      allowances: [],
      deductions: [],
    })
    expect(entry.ssnit_employee).toBe(0)
    expect(entry.ssnit_employer).toBe(0)
    expect(entry.pensionable_base).toBe(0)
    expect(entry.taxable_income).toBe(1000)
    expect(entry.paye).toBe(goldenCalculatePaye(1000))
  })

  it("salary below minimum clamps pensionable base to 587.80", () => {
    const base = goldenClampPensionableBase(400)
    expect(base).toBe(GOLDEN_SSNIT_2026.minimumInsurableEarnings)
    const expected = goldenPensionFromBase(base)
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 400,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.pensionableBase).toBe(expected.pensionableBase)
    expect(result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount).toBe(
      expected.employee
    )
    expect(result.complianceBreakdown?.tier1SsnitRemittance).toBe(expected.tier1)
    expect(result.complianceBreakdown?.tier2PensionRemittance).toBe(expected.tier2)
  })

  it("salary exactly at minimum 587.80", () => {
    const expected = goldenPensionFromBase(587.8)
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 587.8,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.pensionableBase).toBe(587.8)
    expect(result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount).toBe(
      expected.employee
    )
  })

  it("salary just above minimum", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 587.81,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.pensionableBase).toBe(587.81)
  })

  it("salary 1000: employee 55, employer 130, tier1 135, tier2 50", () => {
    const expected = goldenPensionFromBase(1000)
    expect(expected.employee).toBe(55)
    expect(expected.employer).toBe(130)
    expect(expected.tier1).toBe(135)
    expect(expected.tier2).toBe(50)
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 1000,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.tier1SsnitRemittance).toBe(135)
    expect(result.complianceBreakdown?.tier2PensionRemittance).toBe(50)
  })

  it("salary exactly at maximum 69000", () => {
    const expected = goldenPensionFromBase(69000)
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 69000,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.pensionableBase).toBe(69000)
    expect(result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount).toBe(
      expected.employee
    )
    expect(result.complianceBreakdown?.tier1SsnitRemittance).toBe(expected.tier1)
  })

  it("salary above maximum clamps to 69000", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 80000,
      allowances: 0,
      otherDeductions: 0,
    })
    expect(result.complianceBreakdown?.pensionableBase).toBe(69000)
    const expected = goldenPensionFromBase(69000)
    expect(result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")?.amount).toBe(
      expected.employee
    )
  })

  it("allowances / bonus / overtime are not in pensionable base (basic-only model)", () => {
    const result = ghanaPayrollEngine.calculate({
      jurisdiction: "GH",
      effectiveDate: period,
      basicSalary: 1000,
      allowances: 500,
      otherDeductions: 0,
      bonusAmount: 200,
      overtimeAmount: 100,
    })
    // Documented: pensionable earnings under current Finza Ghana model = basic salary only (clamped).
    expect(result.complianceBreakdown?.pensionableBase).toBe(1000)
    expect(result.earnings.grossSalary).toBe(1500)
  })
})

describe("Ghana statutory golden — versioning", () => {
  it("payroll period selects 2026 pension version", () => {
    const bundle = resolveGhanaStatutoryRatesForPeriod("2026-03-01")
    expect(bundle.pension.version).toBe("gh-pension-2026-01")
    expect(bundle.paye.version).toBe("gh-paye-2024-01")
    expect(bundle.calculationEngineVersion).toBe(GHANA_CALCULATION_ENGINE_VERSION)
  })

  it("2025 period selects 2025 pension caps", () => {
    const pension = getGhanaPensionRatesForPeriod("2025-06-15")
    expect(pension.version).toBe("gh-pension-2025-01")
    expect(pension.maximumInsurableEarnings).toBe(61000)
    expect(pension.minimumInsurableEarnings).toBe(539.19)
  })

  it("unsupported period before 2024 fails closed", () => {
    expect(() => resolveGhanaStatutoryRatesForPeriod("2023-12-01")).toThrow(/No Ghana/)
  })

  it("recalc lock keeps stored versions", () => {
    const locked = resolveGhanaStatutoryRatesByVersions({
      payeRateVersion: "gh-paye-2024-01",
      pensionRateVersion: "gh-pension-2026-01",
      periodBasis: "2026-01-01",
    })
    const result = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2099-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
        ghanaRateVersions: {
          payeRateVersion: locked.paye.version,
          pensionRateVersion: locked.pension.version,
          periodBasis: locked.periodBasis,
        },
      },
      "GH"
    )
    expect(result.complianceBreakdown?.payeRateVersion).toBe("gh-paye-2024-01")
    expect(result.complianceBreakdown?.pensionRateVersion).toBe("gh-pension-2026-01")
    expect(result.totals.netSalary).toBe(888.87)
  })
})

describe("Ghana statutory golden — unsupported profile approval blocks", () => {
  const baseRun = {
    calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-01-01",
    payroll_frequency: "monthly",
  }

  const supportedEntry = {
    staff_id: "s-ok",
    is_included: true,
    calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    payroll_tax_profile: {
      staff_is_tax_resident: true,
      secondary_employment: false,
    },
    filing_employee_name: "Ok Employee",
    staff: {
      id: "s-ok",
      name: "Ok Employee",
      employment_type: "full_time",
      is_tax_resident: true,
      secondary_employment: false,
    },
  }

  it("blocks non-resident", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: baseRun,
      entries: [
        {
          ...supportedEntry,
          staff_id: "s-nr",
          filing_employee_name: "Non Resident",
          payroll_tax_profile: { staff_is_tax_resident: false, secondary_employment: false },
          staff: { ...supportedEntry.staff!, id: "s-nr", name: "Non Resident", is_tax_resident: false },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE")
      expect(result.affectedEmployees[0].unsupportedClassification).toBe("non_resident")
    }
  })

  it("blocks secondary employment", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: baseRun,
      entries: [
        {
          ...supportedEntry,
          staff_id: "s-sec",
          payroll_tax_profile: { staff_is_tax_resident: true, secondary_employment: true },
          staff: { ...supportedEntry.staff!, secondary_employment: true },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE")
      expect(result.affectedEmployees[0].unsupportedClassification).toBe("secondary_employment")
    }
  })

  it("blocks casual worker", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: baseRun,
      entries: [
        {
          ...supportedEntry,
          staff_id: "s-cas",
          staff: { ...supportedEntry.staff!, employment_type: "casual" },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.affectedEmployees[0].unsupportedClassification).toBe("casual_worker")
    }
  })

  it("blocks missing rate version on run", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: { ...baseRun, paye_rate_version: null },
      entries: [supportedEntry],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("GHANA_PAYROLL_UNKNOWN_RATE_VERSION")
  })

  it("blocks mixed run with one unsupported employee", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: baseRun,
      entries: [
        supportedEntry,
        {
          ...supportedEntry,
          staff_id: "s-nr",
          is_included: true,
          payroll_tax_profile: { staff_is_tax_resident: false },
          staff: { ...supportedEntry.staff!, id: "s-nr", is_tax_resident: false },
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.affectedEmployees.some((e) => e.staffId === "s-nr")).toBe(true)
    }
  })

  it("allows supported resident monthly employee", () => {
    const result = validateGhanaPayrollRunForApproval({
      businessCountry: "GH",
      run: baseRun,
      entries: [supportedEntry],
    })
    expect(result.ok).toBe(true)
  })
})

describe("Ghana statutory golden — sanity", () => {
  it("goldenRound2 helper", () => {
    expect(goldenRound2(1.006)).toBe(1.01)
    expect(goldenRound2(56.125)).toBe(56.13)
  })
})
