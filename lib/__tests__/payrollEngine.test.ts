/**
 * Unit tests for lib/payrollEngine/index.ts
 * 
 * Tests validate:
 * - Ghana payroll engine calculates correctly
 * - Effective date versioning works
 * - PAYE tax bands are applied correctly
 * - SSNIT calculations are correct
 * - Net salary calculation is correct
 * - Missing country and unsupported country error handling
 */

import { calculatePayroll } from "../payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "../payrollEngine/errors"
import { ghanaPayrollEngine } from "../payrollEngine/jurisdictions/ghana"

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
      expect(result.earnings.allowances).toBe(0)
      expect(result.earnings.grossSalary).toBe(1000)

      // SSNIT Employee: 5.5% of 1000 = 55
      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee).toBeDefined()
      expect(ssnitEmployee?.amount).toBeCloseTo(55, 2)

      // Taxable income: 1000 - 55 = 945
      expect(result.totals.taxableIncome).toBeCloseTo(945, 2)

      // PAYE on 945: band 2 (491-650) (650-490)*0.05=8, band 3 (945-650)*0.10=29.5 → 37.5
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(37.5, 2)

      // Net salary: 945 - 37.5 = 907.5
      expect(result.totals.netSalary).toBeCloseTo(907.5, 2)

      // SSNIT Employer: 13% of 1000 = 130
      const ssnitEmployer = result.employerContributions.find(c => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployer).toBeDefined()
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

      // SSNIT Employee: 5.5% of basic (2000) = 110 (Ghana default: basic only)
      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.amount).toBeCloseTo(110, 2)
      expect(ssnitEmployee?.base).toBe(2000)

      // Taxable income: 2500 - 110 = 2390
      expect(result.totals.taxableIncome).toBeCloseTo(2390, 2)

      // PAYE on 2390: (650-490)*0.05=8, (2390-650)*0.10=174 → 182
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(182, 2)

      // Net salary: 2390 - 182 = 2208
      expect(result.totals.netSalary).toBeCloseTo(2208, 2)
    })

    it("calculates payroll correctly with other deductions (SSNIT on basic only)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 3000,
        allowances: 200,
        otherDeductions: 150, // Loan repayment, etc.
      })

      expect(result.earnings.grossSalary).toBe(3200)
      expect(result.totals.totalOtherDeductions).toBe(150)

      // SSNIT on basic only: 5.5% of 3000 = 165
      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.amount).toBeCloseTo(165, 2)

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      const taxableIncome = result.totals.taxableIncome
      expect(result.totals.netSalary).toBeCloseTo(taxableIncome - (paye?.amount || 0) - 150, 2)
    })

    it("Ghana BASIC-only SSNIT: Basic=5000, Allowance=100, Deduction=100", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 5000,
        allowances: 100,
        otherDeductions: 100,
      })

      expect(result.earnings.grossSalary).toBe(5100)
      expect(result.earnings.basicSalary).toBe(5000)
      expect(result.earnings.allowances).toBe(100)

      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === "SSNIT_EMPLOYEE")
      const ssnitEmployer = result.employerContributions.find(c => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployee?.amount).toBeCloseTo(275, 2) // 5.5% of 5000
      expect(ssnitEmployee?.base).toBe(5000)
      expect(ssnitEmployer?.amount).toBeCloseTo(650, 2) // 13% of 5000
      expect(ssnitEmployer?.base).toBe(5000)

      expect(result.totals.taxableIncome).toBeCloseTo(4825, 2) // 5100 - 275
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(498.63, 2) // PAYE on 4825 (progressive)
      expect(result.totals.netSalary).toBeCloseTo(5100 - 275 - (paye?.amount ?? 0) - 100, 2)
    })
  })

  describe("PAYE tax bands", () => {
    it("calculates PAYE correctly for 0-490 band (0% tax)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 400,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 400, SSNIT: 22, Taxable: 378
      // 378 <= 490, so PAYE = 0
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBe(0)
    })

    it("calculates PAYE correctly for 491-650 band (5% tax)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 550,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 550, SSNIT: 30.25, Taxable: 519.75
      // 490 < 519.75 <= 650, so PAYE = (519.75 - 490) * 0.05 = 1.4875
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(1.49, 2)
    })

    it("calculates PAYE correctly for 651-3850 band (10% tax)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 3000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 3000, SSNIT: 165, Taxable: 2835
      // PAYE calculation:
      // - Band 1 (0-490): 490 * 0.00 = 0
      // - Band 2 (491-650): (650-490) * 0.05 = 8
      // - Band 3 (651-3850): (2835-650) * 0.10 = 218.5
      // Total: 0 + 8 + 218.5 = 226.5
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(226.5, 2)
    })

    it("calculates PAYE correctly for 3851-20000 band (17.5% tax)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 2000,
        otherDeductions: 0,
      })

      // Gross: 12000, SSNIT on basic: 550, Taxable: 11450
      // PAYE: 8 + 320 + (11450-3850)*0.175 = 8 + 320 + 1330 = 1658
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(1658, 2)
    })

    it("calculates PAYE correctly for 20001-50000 band (25% tax)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 25000,
        allowances: 5000,
        otherDeductions: 0,
      })

      // Gross: 30000, SSNIT on basic: 1375, Taxable: 28625
      // PAYE: 8 + 320 + 2826.25 + (28625-20000)*0.25 = 8 + 320 + 2826.25 + 2156.25 = 5310.5
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(5310.5, 2)
    })

    it("calculates PAYE correctly for 50000+ band (30% tax)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 60000,
        allowances: 10000,
        otherDeductions: 0,
      })

      // Gross: 70000, SSNIT on basic: 3300, Taxable: 66700
      // PAYE: 8 + 320 + 2826.25 + 7500 + (66700-50000)*0.30 = 8 + 320 + 2826.25 + 7500 + 5010 = 15664.25
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(15664.25, 2)
    })
  })

  describe("SSNIT calculations", () => {
    it("calculates SSNIT employee contribution correctly (5.5%)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 0,
      })

      const ssnitEmployee = result.statutoryDeductions.find(d => d.code === "SSNIT_EMPLOYEE")
      expect(ssnitEmployee?.rate).toBe(0.055)
      expect(ssnitEmployee?.base).toBe(10000)
      expect(ssnitEmployee?.amount).toBeCloseTo(550, 2) // 5.5% of 10000
      expect(ssnitEmployee?.isTaxDeductible).toBe(true)
    })

    it("calculates SSNIT employer contribution correctly (13%)", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 0,
      })

      const ssnitEmployer = result.employerContributions.find(c => c.code === "SSNIT_EMPLOYER")
      expect(ssnitEmployer?.rate).toBe(0.13)
      expect(ssnitEmployer?.base).toBe(10000)
      expect(ssnitEmployer?.amount).toBeCloseTo(1300, 2) // 13% of 10000
    })
  })

  describe("Effective date versioning", () => {
    it("uses effectiveDate for rate versioning", () => {
      // Same calculation with different effective dates should use same rates (currently)
      // This test verifies effectiveDate parameter is respected
      const result2024 = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      })

      const result2025 = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2025-06-15",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Currently same rates, so should produce same results
      expect(result2024.totals.netSalary).toBeCloseTo(result2025.totals.netSalary, 2)
      expect(result2024.statutoryDeductions[0].amount).toBeCloseTo(result2025.statutoryDeductions[0].amount, 2)
    })
  })

  describe("Net salary calculation", () => {
    it("ensures net salary is non-negative", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 2000, // Deductions exceed taxable income
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })

    it("correctly calculates net salary: taxableIncome - PAYE - otherDeductions", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2024-01-01",
        basicSalary: 5000,
        allowances: 1000,
        otherDeductions: 500,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const expectedNet = result.totals.taxableIncome - paye - 500

      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
    })
  })

  describe("Ghana bonus and overtime compliance buckets", () => {
    it("applies 5% bonus tax within concessional cap", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 5000,
        allowances: 1000,
        bonusAmount: 1000,
        overtimeAmount: 0,
        otherDeductions: 0,
      })

      expect(result.complianceBreakdown?.bonusAmount).toBeCloseTo(1000, 2)
      expect(result.complianceBreakdown?.bonusTax5).toBeCloseTo(50, 2)
      expect(result.complianceBreakdown?.bonusTaxGraduated).toBeCloseTo(0, 2)
      expect(result.statutoryDeductions.find(d => d.code === "PAYE")?.amount).toBeCloseTo(531.13, 2)
    })

    it("splits bonus between 5% concession and graduated PAYE above cap", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 1000,
        allowances: 3000,
        bonusAmount: 3000,
        overtimeAmount: 0,
        otherDeductions: 0,
      })

      expect(result.complianceBreakdown?.bonusCapAmount).toBeCloseTo(1800, 2)
      expect(result.complianceBreakdown?.bonusTax5).toBeCloseTo(90, 2)
      expect(result.complianceBreakdown?.bonusTaxGraduated).toBeCloseTo(120, 2)
    })

    it("applies junior overtime 5%/10% split and excludes it from graduated base", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 1500,
        bonusAmount: 0,
        overtimeAmount: 1500,
        isQualifyingJuniorEmployee: true,
        otherDeductions: 0,
      })

      expect(result.complianceBreakdown?.isQualifyingJuniorEmployee).toBe(true)
      expect(result.complianceBreakdown?.overtimeTax5).toBeCloseTo(50, 2)
      expect(result.complianceBreakdown?.overtimeTax10).toBeCloseTo(50, 2)
      expect(result.complianceBreakdown?.overtimeTaxGraduated).toBeCloseTo(0, 2)
    })

    it("routes non-qualifying overtime through graduated PAYE", () => {
      const result = ghanaPayrollEngine.calculate({
        jurisdiction: "GH",
        effectiveDate: "2026-01-01",
        basicSalary: 2000,
        allowances: 1500,
        bonusAmount: 0,
        overtimeAmount: 1500,
        isQualifyingJuniorEmployee: false,
        otherDeductions: 0,
      })

      expect(result.complianceBreakdown?.overtimeTax5).toBeCloseTo(0, 2)
      expect(result.complianceBreakdown?.overtimeTax10).toBeCloseTo(0, 2)
      expect(result.complianceBreakdown?.overtimeTaxGraduated).toBeCloseTo(150, 2)
      expect(result.statutoryDeductions.find(d => d.code === "PAYE")?.amount).toBeCloseTo(282, 2)
    })
  })
})

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

    // Same staff, same amounts, same payroll_month should produce same results
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

    // Results should be identical (deterministic)
    expect(result1.totals.grossSalary).toBe(result2.totals.grossSalary)
    expect(result1.totals.netSalary).toBe(result2.totals.netSalary)
    expect(result1.statutoryDeductions[0].amount).toBe(result2.statutoryDeductions[0].amount)
    expect(result1.statutoryDeductions[1].amount).toBe(result2.statutoryDeductions[1].amount)
  })

  it("allows historical payroll calculations using past effectiveDate", () => {
    // Calculate payroll for a past month
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
