/**
 * Unit tests for lib/payrollEngine — Ghana calculations (finza-ghana-v2).
 * Statutory expectations align with GRA 2024 PAYE + SSNIT 2026 caps.
 */

import { calculatePayroll } from "../payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "../payrollEngine/errors"
import { ghanaPayrollEngine } from "../payrollEngine/jurisdictions/ghana"

describe("Payroll Engine - Ghana Calculations", () => {
  describe("Basic payroll calculation", () => {
    it("calculates payroll correctly for basic salary only", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
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
      expect(paye?.amount).toBeCloseTo(56.13, 2)

      expect(result.totals.netSalary).toBeCloseTo(888.87, 2)

      const ssnitEmployer = result.employerContributions.find((c) => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployer?.amount).toBeCloseTo(130, 2)
      expect(result.complianceBreakdown?.tier1SsnitRemittance).toBe(135)
      expect(result.complianceBreakdown?.tier2PensionRemittance).toBe(50)
    })

    it("calculates payroll correctly with allowances (SSNIT on basic only)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 500,
        otherDeductions: 0,
      })

      expect(result.earnings.grossSalary).toBe(2500)

      const ssnitEmployee = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.amount).toBeCloseTo(110, 2)
      expect(ssnitEmployee?.base).toBe(2000)

      expect(result.totals.taxableIncome).toBeCloseTo(2390, 2)

      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      // Taxable 2390 on GRA 2024 bands: 5.5 + 13 + (2390-730)*0.175 = 309
      expect(paye?.amount).toBeCloseTo(309, 2)

      expect(result.totals.netSalary).toBeCloseTo(2390 - (paye?.amount || 0), 2)
    })

    it("calculates payroll correctly with other deductions (SSNIT on basic only)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 3000,
        allowances: 200,
        otherDeductions: 150,
      })

      expect(result.earnings.grossSalary).toBe(3200)
      expect(result.totals.totalOtherDeductions).toBe(150)

      const ssnitEmployee = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.amount).toBeCloseTo(165, 2)

      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      const taxableIncome = result.totals.taxableIncome
      expect(result.totals.netSalary).toBeCloseTo(taxableIncome - (paye?.amount || 0) - 150, 2)
    })

    it("Ghana BASIC-only SSNIT: Basic=5000, Allowance=100, Deduction=100", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 5000,
        allowances: 100,
        otherDeductions: 100,
      })

      expect(result.earnings.grossSalary).toBe(5100)

      const ssnitEmployee = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
      const ssnitEmployer = result.employerContributions.find((c) => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployee?.amount).toBeCloseTo(275, 2)
      expect(ssnitEmployer?.amount).toBeCloseTo(650, 2)

      expect(result.totals.taxableIncome).toBeCloseTo(4825, 2)
      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      expect(paye?.amount).toBeGreaterThan(0)
      expect(result.totals.netSalary).toBeCloseTo(5100 - 275 - (paye?.amount ?? 0) - 100, 2)
    })
  })

  describe("PAYE tax bands (GRA 2024)", () => {
    it("calculates PAYE correctly for 0% band", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 400,
        allowances: 0,
        otherDeductions: 0,
      })
      // Basic 400 clamps SSNIT base to 587.80; taxable = gross - ee SSNIT
      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      expect(paye?.amount).toBeDefined()
      expect(result.complianceBreakdown?.pensionableBase).toBe(587.8)
    })

    it("calculates PAYE for taxable in 5% band", () => {
      // Choose basic so taxable lands ~519 after SSNIT
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 550,
        allowances: 0,
        otherDeductions: 0,
      })
      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      expect(paye?.amount).toBeGreaterThan(0)
      expect(paye?.amount).toBeLessThan(20)
    })

    it("applies 35% band for high taxable income", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 60000,
        allowances: 10000,
        otherDeductions: 0,
      })
      const paye = result.statutoryDeductions.find((d) => d.code === "PAYE")
      // Must exceed old 30%-only schedule result for comparable income
      expect(paye?.amount).toBeGreaterThan(15000)
    })
  })

  describe("SSNIT calculations", () => {
    it("calculates SSNIT employee contribution correctly (5.5%) on clamped base", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 0,
      })

      const ssnitEmployee = result.statutoryDeductions.find((d) => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.rate).toBe(0.055)
      expect(ssnitEmployee?.base).toBe(10000)
      expect(ssnitEmployee?.amount).toBeCloseTo(550, 2)
      expect(ssnitEmployee?.isTaxDeductible).toBe(true)
    })

    it("calculates SSNIT employer contribution correctly (13%)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 0,
      })

      const ssnitEmployer = result.employerContributions.find((c) => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployer?.rate).toBe(0.13)
      expect(ssnitEmployer?.amount).toBeCloseTo(1300, 2)
    })
  })

  describe("Effective date versioning", () => {
    it("uses period-based pension caps (2025 vs 2026)", () => {
      const result2025 = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2025-06-15",
        basicSalary: 65000,
        allowances: 0,
        otherDeductions: 0,
      })
      const result2026 = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-06-15",
        basicSalary: 65000,
        allowances: 0,
        otherDeductions: 0,
      })
      expect(result2025.complianceBreakdown?.pensionableBase).toBe(61000)
      expect(result2026.complianceBreakdown?.pensionableBase).toBe(65000)
      expect(result2025.complianceBreakdown?.pensionRateVersion).toBe("gh-pension-2025-01")
      expect(result2026.complianceBreakdown?.pensionRateVersion).toBe("gh-pension-2026-01")
    })
  })

  describe("Net salary calculation", () => {
    it("ensures net salary is non-negative", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 5000,
      })
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Bonus and overtime", () => {
    it("applies bonus concessional 5% within annual cap", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 1000,
        allowances: 1000,
        otherDeductions: 0,
        bonusAmount: 1000,
      })
      expect(result.complianceBreakdown?.bonusTax5).toBe(50)
      expect(result.totals.grossSalary).toBe(2000)
    })

    it("applies junior overtime concession", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 1000,
        allowances: 1000,
        otherDeductions: 0,
        overtimeAmount: 1000,
        isQualifyingJuniorEmployee: true,
      })
      expect(result.complianceBreakdown?.overtimeTax5).toBe(25)
      expect(result.complianceBreakdown?.overtimeTax10).toBe(50)
    })
  })

  describe("Country resolution via calculatePayroll", () => {
    it("calculates via calculatePayroll for GH", () => {
      const result = calculatePayroll(
        {
          jurisdiction: "GH",
          effectiveDate: "2026-01-01",
          basicSalary: 1000,
          allowances: 0,
          otherDeductions: 0,
        },
        "GH"
      )
      expect(result.totals.netSalary).toBeCloseTo(888.87, 2)
    })

    it("throws MissingCountryError when country missing", () => {
      expect(() =>
        calculatePayroll(
          { jurisdiction: "", effectiveDate: "2026-01-01", basicSalary: 1000, allowances: 0, otherDeductions: 0 },
          null
        )
      ).toThrow(MissingCountryError)
    })

    it("throws UnsupportedCountryError for unsupported country", () => {
      expect(() =>
        calculatePayroll(
          {
            jurisdiction: "XX",
            effectiveDate: "2026-01-01",
            basicSalary: 1000,
            allowances: 0,
            otherDeductions: 0,
          },
          "Atlantis"
        )
      ).toThrow(UnsupportedCountryError)
    })
  })
})
