/**
 * Unit tests for lib/payrollEngine/index.ts (Ghana Phase 1A)
 */

import { calculatePayroll } from "../payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "../payrollEngine/errors"
import {
  ghanaPayrollEngine,
  calculateGhanaResidentGraduatedPaye,
  resolveGhanaInsurableBasicSalary,
} from "../payrollEngine/jurisdictions/ghana"

describe("Payroll Engine - Ghana Calculations", () => {
  describe("Basic payroll calculation", () => {
    it("calculates payroll correctly for basic salary only", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.earnings.basicSalary).toBe(1000)
      expect(result.earnings.grossSalary).toBe(1000)

      const ssnitEmployee = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.amount).toBeCloseTo(55, 2)
      expect(result.totals.taxableIncome).toBeCloseTo(945, 2)

      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(calculateGhanaResidentGraduatedPaye(945), 2)

      expect(result.totals.netSalary).toBeCloseTo(945 - (paye?.amount ?? 0), 2)

      const ssnitEmployer = result.employerContributions.find((c) => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployer?.amount).toBeCloseTo(130, 2)
    })

    it("calculates payroll correctly with allowances (SSNIT on basic only)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 2000,
        allowances: 500,
        otherDeductions: 0,
      })

      expect(result.earnings.grossSalary).toBe(2500)
      expect(result.totals.taxableIncome).toBeCloseTo(2390, 2)
      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(calculateGhanaResidentGraduatedPaye(2390), 2)
    })

    it("Ghana resident basic GHS 4,500 (2026 insurable, PAYE per GRA bands)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 4500,
        allowances: 0,
        otherDeductions: 0,
      })

      const empPen = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
      expect(empPen?.amount).toBeCloseTo(247.5, 2)
      expect(result.totals.taxableIncome).toBeCloseTo(4252.5, 2)
      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(661.62, 2)
      expect(paye?.amount).not.toBeCloseTo(398.44, 1)
    })
  })

  describe("PAYE graduated bands (GRA monthly)", () => {
    it("edge taxable incomes", () => {
      expect(calculateGhanaResidentGraduatedPaye(490)).toBe(0)
      expect(calculateGhanaResidentGraduatedPaye(600)).toBeCloseTo(5.5, 2)
      expect(calculateGhanaResidentGraduatedPaye(730)).toBeCloseTo(18.5, 2)
      expect(calculateGhanaResidentGraduatedPaye(3896.67)).toBeCloseTo(572.67, 2)
      expect(calculateGhanaResidentGraduatedPaye(19896.67)).toBeCloseTo(4572.67, 2)
      const at5041667 = calculateGhanaResidentGraduatedPaye(50416.67)
      expect(at5041667).toBeCloseTo(13728.67, 2)
      const above = calculateGhanaResidentGraduatedPaye(50416.67 + 1000)
      expect(above - at5041667).toBeCloseTo(350, 2)
    })
  })

  describe("SSNIT 2026 insurable clamp", () => {
    it("applies minimum base when basic is below floor", () => {
      expect(
        resolveGhanaInsurableBasicSalary({
          basicSalary: 400,
          pensionable: true,
          effectiveDate: "2026-01-01",
        })
      ).toBeCloseTo(587.8, 2)
    })

    it("applies maximum base when basic exceeds ceiling", () => {
      expect(
        resolveGhanaInsurableBasicSalary({
          basicSalary: 100_000,
          pensionable: true,
          effectiveDate: "2026-01-01",
        })
      ).toBe(69_000)
    })

    it("no minimum floor before 2026 schedule", () => {
      expect(
        resolveGhanaInsurableBasicSalary({
          basicSalary: 400,
          pensionable: true,
          effectiveDate: "2025-12-01",
        })
      ).toBe(400)
    })
  })

  describe("Tier split (18.5% = 5.5% + 13%; remit 13.5% Tier1 + 5% Tier2)", () => {
    it("reports tier amounts on compliance breakdown", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 10_000,
        allowances: 0,
        otherDeductions: 0,
      })
      const cb = r.complianceBreakdown
      expect(cb?.ssnitBase).toBeCloseTo(10_000, 2)
      expect(cb?.employeePensionContribution).toBeCloseTo(550, 2)
      expect(cb?.employerPensionContribution).toBeCloseTo(1300, 2)
      expect(cb?.totalMandatoryPension).toBeCloseTo(1850, 2)
      expect(cb?.tier1SsnitRemittance).toBeCloseTo(1350, 2)
      expect(cb?.tier2PensionRemittance).toBeCloseTo(500, 2)
    })
  })

  describe("Bonus YTD concessional room", () => {
    it("uses prior YTD to reduce remaining 15%-of-annual-basic room", () => {
      const annualCap = 5000 * 12 * 0.15
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-02-01",
        basicSalary: 5000,
        allowances: 1000,
        bonusAmount: 1000,
        overtimeAmount: 0,
        otherDeductions: 0,
        priorBonusPaidInCalendarYear: 8000,
      })
      expect(r.complianceBreakdown?.bonusCapAmount).toBeCloseTo(annualCap, 2)
      expect(r.complianceBreakdown?.bonusConcessionalRoomBeforeRun).toBeCloseTo(annualCap - 8000, 2)
      expect(r.complianceBreakdown?.bonusTax5).toBeCloseTo((annualCap - 8000) * 0.05, 2)
    })
  })

  describe("Non-resident and casual", () => {
    it("non-resident flat 25% on remainder and 20% on bonus/overtime slices", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 8000,
        allowances: 0,
        bonusAmount: 500,
        overtimeAmount: 200,
        otherDeductions: 0,
        isResident: false,
      })
      const taxable = r.totals.taxableIncome
      const remainder = Math.max(0, taxable - 500 - 200)
      const expected = round2(remainder * 0.25 + 500 * 0.2 + 200 * 0.2)
      const paye = r.statutoryDeductions.find((d) => d.code === "PAYE")?.amount ?? 0
      expect(paye).toBeCloseTo(expected, 2)
    })

    it("casual worker 5% flat on taxable income after employee pension", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 0,
        otherDeductions: 0,
        employmentCategory: "casual",
      })
      const paye = r.statutoryDeductions.find((d) => d.code === "PAYE")?.amount ?? 0
      expect(paye).toBeCloseTo(r.totals.taxableIncome * 0.05, 2)
      expect(r.complianceBreakdown?.casualWorkerFlatTaxApplied).toBe(true)
    })
  })

  describe("Junior overtime concession (needs annual income YTD)", () => {
    it("applies 5%/10% split only when junior + annual qualifying income ≤ 18,000", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 1500,
        bonusAmount: 0,
        overtimeAmount: 1500,
        isQualifyingJuniorEmployee: true,
        annualQualifyingEmploymentIncomeYtd: 10_000,
        otherDeductions: 0,
      })
      expect(r.complianceBreakdown?.juniorOvertimeConcessionApplies).toBe(true)
      expect(r.complianceBreakdown?.overtimeTax5).toBeCloseTo(50, 2)
      expect(r.complianceBreakdown?.overtimeTax10).toBeCloseTo(50, 2)
    })

    it("does not apply concession when annual qualifying income YTD is omitted (Phase 1A — no guessing)", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 1500,
        bonusAmount: 0,
        overtimeAmount: 1500,
        isQualifyingJuniorEmployee: true,
        otherDeductions: 0,
      })
      expect(r.complianceBreakdown?.juniorOvertimeConcessionApplies).toBe(false)
      expect(r.complianceBreakdown?.overtimeTax5).toBeCloseTo(0, 2)
    })

    it("non-junior overtime flows through graduated PAYE", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 1500,
        bonusAmount: 0,
        overtimeAmount: 1500,
        isQualifyingJuniorEmployee: false,
        otherDeductions: 0,
      })
      expect(r.complianceBreakdown?.overtimeTax5).toBeCloseTo(0, 2)
      expect(r.complianceBreakdown?.overtimeTaxGraduated).toBeGreaterThan(0)
    })
  })

  describe("Net salary and determinism", () => {
    it("ensures net salary is non-negative", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 2000,
      })
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })

    it("effectiveDate 2024 vs 2025 same bands (pre-2026 PAYE schedule identical key)", () => {
      const a = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      })
      const b = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2025-06-15",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      })
      expect(a.totals.netSalary).toBeCloseTo(b.totals.netSalary, 2)
    })
  })

  describe("Ghana bonus and overtime buckets (resident)", () => {
    it("applies 5% bonus tax within concessional cap", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 5000,
        allowances: 1000,
        bonusAmount: 1000,
        overtimeAmount: 0,
        otherDeductions: 0,
      })
      expect(r.complianceBreakdown?.bonusTax5).toBeCloseTo(50, 2)
      expect(r.complianceBreakdown?.bonusConcessionalAmount).toBeCloseTo(1000, 2)
      expect(r.complianceBreakdown?.bonusGraduatedAmount).toBeCloseTo(0, 2)
    })

    it("splits bonus between 5% concession and graduated PAYE above cap", () => {
      const r = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 1000,
        allowances: 3000,
        bonusAmount: 3000,
        overtimeAmount: 0,
        otherDeductions: 0,
      })
      expect(r.complianceBreakdown?.bonusCapAmount).toBeCloseTo(1800, 2)
      expect(r.complianceBreakdown?.bonusConcessionalAmount).toBeCloseTo(1800, 2)
      expect(r.complianceBreakdown?.bonusGraduatedAmount).toBeCloseTo(1200, 2)
      expect(r.complianceBreakdown?.bonusTax5).toBeCloseTo(90, 2)
      expect((r.complianceBreakdown?.bonusTaxGraduated ?? 0) + (r.complianceBreakdown?.bonusTax5 ?? 0)).toBeGreaterThan(
        0
      )
    })
  })
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

describe("Payroll Engine - Country Resolution", () => {
  it("calculates payroll for Ghana (GH)", () => {
    const result = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      },
      "GH"
    )

    expect(result.totals.grossSalary).toBeGreaterThan(0)
    expect(result.statutoryDeductions.length).toBeGreaterThan(0)
    expect(result.employerContributions.length).toBeGreaterThan(0)
  })

  it("calculates payroll for Ghana using country name", () => {
    const result = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      },
      "Ghana"
    )

    expect(result.totals.grossSalary).toBeGreaterThan(0)
  })

  it("throws MissingCountryError for null country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: "GH",
          effectiveDate: "2024-01-01",
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0,
        },
        null
      )
    }).toThrow(MissingCountryError)
  })

  it("throws MissingCountryError for undefined country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: "GH",
          effectiveDate: "2024-01-01",
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0,
        },
        undefined
      )
    }).toThrow(MissingCountryError)
  })

  it("throws UnsupportedCountryError for unsupported country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: "US",
          effectiveDate: "2024-01-01",
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0,
        },
        "US"
      )
    }).toThrow(UnsupportedCountryError)
  })
})

describe("Payroll Engine - Effective Date from Payroll Month", () => {
  it("uses payroll_month as effectiveDate for deterministic calculations", () => {
    const payrollMonth = "2024-06-01"

    const result1 = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: payrollMonth,
        basicSalary: 5000,
        allowances: 1000,
        otherDeductions: 200,
      },
      "GH"
    )

    const result2 = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: payrollMonth,
        basicSalary: 5000,
        allowances: 1000,
        otherDeductions: 200,
      },
      "GH"
    )

    expect(result1.totals.grossSalary).toBe(result2.totals.grossSalary)
    expect(result1.totals.netSalary).toBe(result2.totals.netSalary)
  })

  it("allows historical payroll calculations using past effectiveDate", () => {
    const result = calculatePayroll(
      {
        jurisdiction: "GH",
        effectiveDate: "2023-01-01",
        basicSalary: 3000,
        allowances: 500,
        otherDeductions: 100,
      },
      "GH"
    )

    expect(result.totals.grossSalary).toBe(3500)
    expect(result.totals.netSalary).toBeGreaterThan(0)
  })
})
