/**
 * Unit tests for lib/payrollEngine/jurisdictions/kenya.ts
 * 
 * Tests validate:
 * - Kenya payroll engine calculates correctly
 * - PAYE tax bands are applied correctly
 * - NSSF calculations are correct (employee and employer)
 * - Legacy regime: NHIF flat amounts (before 2024-07-01)
 * - Current regime: SHIF (2.75%) and AHL (1.5% employee, 1.5% employer) (on/after 2024-07-01)
 * - Net salary calculation is correct
 * - Effective date versioning works correctly
 * - Structure matches Ghana plugin
 */

import { calculatePayroll } from "../payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "../payrollEngine/errors"
import { kenyaPayrollEngine } from "../payrollEngine/jurisdictions/kenya"

describe("Payroll Engine - Kenya Calculations", () => {
  describe("Legacy regime (NHIF-based, before 2024-07-01)", () => {
    it("calculates payroll correctly for legacy regime (50,000 KES, effectiveDate 2024-01-01)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction (2024-07-01)
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.earnings.basicSalary).toBe(50000)
      expect(result.earnings.allowances).toBe(0)
      expect(result.earnings.grossSalary).toBe(50000)

      // NSSF Employee: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 540 + 2,460 = 3,000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee).toBeDefined()
      expect(nssfEmployee?.amount).toBeCloseTo(3000, 2)

      // Legacy regime: NHIF (not SHIF or AHL)
      const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif).toBeDefined()
      expect(nhif?.amount).toBe(1200) // For gross 50,000, NHIF band is 1,200

      // Should NOT have SHIF or AHL in legacy regime
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
      expect(shif).toBeUndefined()

      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
      expect(ahlEmployee).toBeUndefined()

      // Taxable income: 50,000 - 3,000 - 1,200 = 45,800
      expect(result.totals.taxableIncome).toBeCloseTo(45800, 2)

      // PAYE on 45,800 (with Personal Relief):
      // Gross PAYE:
      // Band 1 (0-24,000): 24,000 * 0.10 = 2,400
      // Band 2 (24,001-32,333): 8,333 * 0.25 = 2,083.25
      // Band 3 (32,334-500,000): (45,800 - 32,333) * 0.30 = 4,040.10
      // Gross Total: 2,400 + 2,083.25 + 4,040.10 = 8,523.35
      // Net PAYE: 8,523.35 - 2,400 (Personal Relief) = 6,123.35
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(6123.35, 2)

      // Net salary: 45,800 - 6,123.35 = 39,676.65
      expect(result.totals.netSalary).toBeCloseTo(39676.65, 2)

      // NSSF Employer: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 540 + 2,460 = 3,000
      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")
      expect(nssfEmployer).toBeDefined()
      expect(nssfEmployer?.amount).toBeCloseTo(3000, 2)

      // Should NOT have AHL employer in legacy regime
      const ahlEmployer = result.employerContributions.find(c => c.code === "AHL_EMPLOYER")
      expect(ahlEmployer).toBeUndefined()
    })
  })

  describe("Current regime (SHIF + AHL, on/after 2024-07-01)", () => {
    it("calculates payroll correctly for current regime (50,000 KES, effectiveDate 2024-07-01)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.earnings.basicSalary).toBe(50000)
      expect(result.earnings.allowances).toBe(0)
      expect(result.earnings.grossSalary).toBe(50000)

      // NSSF Employee: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 540 + 2,460 = 3,000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee).toBeDefined()
      expect(nssfEmployee?.amount).toBeCloseTo(3000, 2)

      // Current regime: SHIF (2.75% of gross) = 50,000 * 0.0275 = 1,375
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
      expect(shif).toBeDefined()
      expect(shif?.rate).toBe(0.0275)
      expect(shif?.amount).toBeCloseTo(1375, 2)

      // Current regime: AHL Employee (1.5% of gross) = 50,000 * 0.015 = 750
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
      expect(ahlEmployee).toBeDefined()
      expect(ahlEmployee?.rate).toBe(0.015)
      expect(ahlEmployee?.amount).toBeCloseTo(750, 2)

      // Should NOT have NHIF in current regime
      const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif).toBeUndefined()

      // Taxable income: 50,000 - 3,000 - 1,375 - 750 = 44,875
      expect(result.totals.taxableIncome).toBeCloseTo(44875, 2)

      // PAYE on 44,875 (with Personal Relief):
      // Gross PAYE:
      // Band 1 (0-24,000): 24,000 * 0.10 = 2,400
      // Band 2 (24,001-32,333): 8,333 * 0.25 = 2,083.25
      // Band 3 (32,334-500,000): (44,875 - 32,333) * 0.30 = 3,762.60
      // Gross Total: 2,400 + 2,083.25 + 3,762.60 = 8,245.85
      // Net PAYE: 8,245.85 - 2,400 (Personal Relief) = 5,845.85
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(5845.85, 2)

      // Net salary: 44,875 - 5,845.85 = 39,029.15
      expect(result.totals.netSalary).toBeCloseTo(39029.15, 2)

      // NSSF Employer: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 540 + 2,460 = 3,000
      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")
      expect(nssfEmployer).toBeDefined()
      expect(nssfEmployer?.amount).toBeCloseTo(3000, 2)

      // Current regime: AHL Employer (1.5% of gross) = 50,000 * 0.015 = 750
      const ahlEmployer = result.employerContributions.find(c => c.code === "AHL_EMPLOYER")
      expect(ahlEmployer).toBeDefined()
      expect(ahlEmployer?.rate).toBe(0.015)
      expect(ahlEmployer?.amount).toBeCloseTo(750, 2)
    })

    it("calculates payroll correctly with allowances (current regime)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-08-01", // After SHIF introduction
        basicSalary: 40000,
        allowances: 10000,
        otherDeductions: 0,
      })

      expect(result.earnings.grossSalary).toBe(50000)
      expect(result.totals.grossSalary).toBe(50000)

      // NSSF Employee: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 3,000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee?.amount).toBeCloseTo(3000, 2)

      // SHIF: 2.75% of 50,000 = 1,375
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
      expect(shif?.amount).toBeCloseTo(1375, 2)

      // AHL Employee: 1.5% of 50,000 = 750
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
      expect(ahlEmployee?.amount).toBeCloseTo(750, 2)
    })

    it("calculates payroll correctly with other deductions", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 5000, // Loan repayment, etc.
      })

      expect(result.totals.totalOtherDeductions).toBe(5000)

      // Net salary should deduct other deductions
      const taxableIncome = result.totals.taxableIncome
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      expect(result.totals.netSalary).toBeCloseTo(taxableIncome - paye - 5000, 2)
    })
  })

  describe("PAYE tax bands", () => {
    it("calculates PAYE correctly for 0-24,000 band (10% tax)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 20000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 20,000, NSSF: ~1,200, NHIF: 1,200, Taxable: ~17,600
      // Gross PAYE: 17,600 * 0.10 = 1,760
      // Net PAYE: max(0, 1,760 - 2,400) = 0 (Personal Relief exceeds gross PAYE)
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      const taxableIncome = result.totals.taxableIncome
      const grossPaye = taxableIncome * 0.10
      const expectedNetPaye = Math.max(0, grossPaye - 2400) // Personal Relief
      expect(paye?.amount).toBeCloseTo(expectedNetPaye, 2)
    })

    it("calculates PAYE correctly for 24,001-32,333 band (25% tax)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 30000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 30,000, NSSF: ~1,860, NHIF: 900, Taxable: ~27,240
      // Gross PAYE calculation:
      // Band 1: 24,000 * 0.10 = 2,400
      // Band 2: (27,240 - 24,000) * 0.25 = 810
      // Gross Total: 2,400 + 810 = 3,210
      // Net PAYE: 3,210 - 2,400 (Personal Relief) = 810
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      const taxableIncome = result.totals.taxableIncome
      if (taxableIncome <= 32333) {
        const grossPaye = 24000 * 0.10 + (taxableIncome - 24000) * 0.25
        const expectedNetPaye = Math.max(0, grossPaye - 2400) // Personal Relief
        expect(paye?.amount).toBeCloseTo(expectedNetPaye, 2)
      }
    })

    it("calculates PAYE correctly for 32,334-500,000 band (30% tax)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 50,000, NSSF: 3,000, NHIF: 1,200, Taxable: 45,800
      // Gross PAYE calculation:
      // Band 1: 24,000 * 0.10 = 2,400
      // Band 2: 8,333 * 0.25 = 2,083.25
      // Band 3: (45,800 - 32,333) * 0.30 = 4,040.10
      // Gross Total: 2,400 + 2,083.25 + 4,040.10 = 8,523.35
      // Net PAYE: 8,523.35 - 2,400 (Personal Relief) = 6,123.35
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.amount).toBeCloseTo(6123.35, 2)
    })

    it("calculates PAYE correctly for 500,001-800,000 band (32.5% tax)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 600000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 600,000, NSSF: capped at Tier II (6% of 108,000 - 9,000 = 5,940), NHIF: 1,700
      // Taxable income calculation depends on NSSF and NHIF
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      const taxableIncome = result.totals.taxableIncome
      
      // For income in this band, PAYE should be calculated correctly with Personal Relief
      if (taxableIncome > 500000 && taxableIncome <= 800000) {
        const grossPaye = 
          24000 * 0.10 +
          8333 * 0.25 +
          (500000 - 32333) * 0.30 +
          (taxableIncome - 500000) * 0.325
        const expectedNetPaye = Math.max(0, grossPaye - 2400) // Personal Relief
        expect(paye?.amount).toBeCloseTo(expectedNetPaye, 2)
      }
    })

    it("calculates PAYE correctly for 800,001+ band (35% tax)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 1,000,000, NSSF: capped at Tier II, NHIF: 1,700
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      const taxableIncome = result.totals.taxableIncome
      
      // For income above 800,000, PAYE should include the top band with Personal Relief
      if (taxableIncome > 800000) {
        const grossPaye = 
          24000 * 0.10 +
          8333 * 0.25 +
          (500000 - 32333) * 0.30 +
          (800000 - 500000) * 0.325 +
          (taxableIncome - 800000) * 0.35
        const expectedNetPaye = Math.max(0, grossPaye - 2400) // Personal Relief
        expect(paye?.amount).toBeCloseTo(expectedNetPaye, 2)
      }
    })
  })

  describe("NSSF calculations", () => {
    it("calculates NSSF employee contribution correctly (6%)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NSSF Employee: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 540 + 2,460 = 3,000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee?.rate).toBe(0.06)
      expect(nssfEmployee?.base).toBe(50000)
      expect(nssfEmployee?.amount).toBeCloseTo(3000, 2) // 6% of 50,000
      expect(nssfEmployee?.isTaxDeductible).toBe(true)
    })

    it("calculates NSSF employee contribution correctly for low salary (below Tier I limit)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 8000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NSSF Employee: 6% of 8,000 = 480
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee?.amount).toBeCloseTo(480, 2) // 6% of 8,000
    })

    it("calculates NSSF employee contribution correctly for high salary (above Tier II limit)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 200000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NSSF Employee: 6% on first 9,000 + 6% on next (108,000 - 9,000) = 540 + 5,940 = 6,480
      // Capped at Tier II limit (108,000)
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee?.amount).toBeCloseTo(6480, 2) // 6% of 108,000 (capped)
    })

    it("calculates NSSF employer contribution correctly (matches employee)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NSSF Employer: 6% on first 9,000 + 6% on next (50,000 - 9,000) = 540 + 2,460 = 3,000
      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")
      expect(nssfEmployer?.rate).toBe(0.06)
      expect(nssfEmployer?.base).toBe(50000)
      expect(nssfEmployer?.amount).toBeCloseTo(3000, 2) // 6% of 50,000

      // Employer contribution should match employee contribution
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployer?.amount).toBeCloseTo(nssfEmployee?.amount || 0, 2)
    })
  })

  describe("NHIF calculations (legacy regime only)", () => {
    it("calculates NHIF correctly for low salary (KES 150, legacy regime)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction
        basicSalary: 3000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NHIF: For gross 0-5,999, should be 150
      const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif).toBeDefined()
      expect(nhif?.amount).toBe(150)
      expect(nhif?.isTaxDeductible).toBe(true)
    })

    it("calculates NHIF correctly for medium salary (KES 1,200, legacy regime)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NHIF: For gross 50,000-59,999, should be 1,200
      const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif).toBeDefined()
      expect(nhif?.amount).toBe(1200)
    })

    it("calculates NHIF correctly for high salary (KES 1,700, legacy regime)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction
        basicSalary: 150000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NHIF: For gross 100,000+, should be 1,700
      const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif).toBeDefined()
      expect(nhif?.amount).toBe(1700)
    })

    it("calculates NHIF correctly for salary at band boundaries", () => {
      // Test at 6,000 (start of 300 band)
      const result1 = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 6000,
        allowances: 0,
        otherDeductions: 0,
      })
      const nhif1 = result1.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif1?.amount).toBe(300)

      // Test at 100,000 (start of 1,700 band)
      const result2 = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
      })
      const nhif2 = result2.statutoryDeductions.find(d => d.code === "NHIF")
      expect(nhif2?.amount).toBe(1700)
    })
  })

  describe("SHIF calculations (current regime only)", () => {
    it("calculates SHIF correctly (2.75% of gross salary)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // SHIF: 2.75% of 50,000 = 1,375
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
      expect(shif).toBeDefined()
      expect(shif?.rate).toBe(0.0275)
      expect(shif?.base).toBe(50000)
      expect(shif?.amount).toBeCloseTo(1375, 2)
      expect(shif?.isTaxDeductible).toBe(true)
    })

    it("calculates SHIF correctly for different salary amounts", () => {
      // Test 100,000 KES
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
      })

      // SHIF: 2.75% of 100,000 = 2,750
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
      expect(shif?.amount).toBeCloseTo(2750, 2)
    })
  })

  describe("AHL calculations (current regime only)", () => {
    it("calculates AHL employee correctly (1.5% of gross salary)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // AHL Employee: 1.5% of 50,000 = 750
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
      expect(ahlEmployee).toBeDefined()
      expect(ahlEmployee?.rate).toBe(0.015)
      expect(ahlEmployee?.base).toBe(50000)
      expect(ahlEmployee?.amount).toBeCloseTo(750, 2)
      expect(ahlEmployee?.isTaxDeductible).toBe(true)
    })

    it("calculates AHL employer correctly (1.5% of gross salary, matches employee)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // AHL Employer: 1.5% of 50,000 = 750
      const ahlEmployer = result.employerContributions.find(c => c.code === "AHL_EMPLOYER")
      expect(ahlEmployer).toBeDefined()
      expect(ahlEmployer?.rate).toBe(0.015)
      expect(ahlEmployer?.base).toBe(50000)
      expect(ahlEmployer?.amount).toBeCloseTo(750, 2)

      // Employer contribution should match employee contribution
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
      expect(ahlEmployer?.amount).toBeCloseTo(ahlEmployee?.amount || 0, 2)
    })
  })

  describe("Taxable income calculation", () => {
    it("calculates taxable income correctly for legacy regime (gross - NSSF - NHIF)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      const grossSalary = result.earnings.grossSalary
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")?.amount || 0

      // Taxable income = Gross - NSSF Employee - NHIF (both are tax-deductible)
      const expectedTaxableIncome = grossSalary - nssfEmployee - nhif
      expect(result.totals.taxableIncome).toBeCloseTo(expectedTaxableIncome, 2)
    })

    it("calculates taxable income correctly for current regime (gross - NSSF - SHIF - AHL employee)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      const grossSalary = result.earnings.grossSalary
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")?.amount || 0
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")?.amount || 0

      // Taxable income = Gross - NSSF Employee - SHIF - AHL Employee (all are tax-deductible)
      const expectedTaxableIncome = grossSalary - nssfEmployee - shif - ahlEmployee
      expect(result.totals.taxableIncome).toBeCloseTo(expectedTaxableIncome, 2)
    })
  })

  describe("Net salary calculation", () => {
    it("calculates net salary correctly (taxable income - PAYE - other deductions)", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 2000,
      })

      const taxableIncome = result.totals.taxableIncome
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0

      // Net salary = Taxable Income - PAYE - Other Deductions
      const expectedNetSalary = taxableIncome - paye - 2000
      expect(result.totals.netSalary).toBeCloseTo(expectedNetSalary, 2)
    })

    it("ensures net salary is non-negative", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 0,
        otherDeductions: 50000, // Deductions exceed taxable income
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Structure validation", () => {
    it("returns correct structure matching Ghana plugin", () => {
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 10000,
        otherDeductions: 2000,
      })

      // Verify earnings structure
      expect(result.earnings).toHaveProperty("basicSalary")
      expect(result.earnings).toHaveProperty("allowances")
      expect(result.earnings).toHaveProperty("grossSalary")

      // Verify statutory deductions structure
      expect(Array.isArray(result.statutoryDeductions)).toBe(true)
      expect(result.statutoryDeductions.length).toBeGreaterThan(0)
      
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee).toBeDefined()
      expect(nssfEmployee).toHaveProperty("code")
      expect(nssfEmployee).toHaveProperty("name")
      expect(nssfEmployee).toHaveProperty("rate")
      expect(nssfEmployee).toHaveProperty("base")
      expect(nssfEmployee).toHaveProperty("amount")
      expect(nssfEmployee).toHaveProperty("ledgerAccountCode")
      expect(nssfEmployee).toHaveProperty("isTaxDeductible")

      // Verify employer contributions structure
      expect(Array.isArray(result.employerContributions)).toBe(true)
      expect(result.employerContributions.length).toBeGreaterThan(0)
      
      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")
      expect(nssfEmployer).toBeDefined()
      expect(nssfEmployer).toHaveProperty("code")
      expect(nssfEmployer).toHaveProperty("name")
      expect(nssfEmployer).toHaveProperty("rate")
      expect(nssfEmployer).toHaveProperty("base")
      expect(nssfEmployer).toHaveProperty("amount")
      expect(nssfEmployer).toHaveProperty("ledgerExpenseAccountCode")
      expect(nssfEmployer).toHaveProperty("ledgerLiabilityAccountCode")

      // Verify totals structure
      expect(result.totals).toHaveProperty("grossSalary")
      expect(result.totals).toHaveProperty("totalStatutoryDeductions")
      expect(result.totals).toHaveProperty("totalOtherDeductions")
      expect(result.totals).toHaveProperty("taxableIncome")
      expect(result.totals).toHaveProperty("netSalary")
      expect(result.totals).toHaveProperty("totalEmployerContributions")
    })
  })
})

describe("Payroll Engine - Kenya Country Resolution", () => {
  it("calculates payroll for Kenya (KE)", () => {
    const result = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      },
      "KE"
    )

    expect(result.totals.grossSalary).toBeGreaterThan(0)
    expect(result.statutoryDeductions.length).toBeGreaterThan(0)
    expect(result.employerContributions.length).toBeGreaterThan(0)
    
    // Verify Kenya-specific deductions exist
    const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
    const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
    const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
    
    expect(nssfEmployee).toBeDefined()
    expect(nhif).toBeDefined()
    expect(paye).toBeDefined()
  })

  it("calculates payroll for Kenya using country name", () => {
    const result = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: "2024-01-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      },
      "Kenya"
    )

    expect(result.totals.grossSalary).toBeGreaterThan(0)
  })

  it("throws MissingCountryError for null country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: "KE",
          effectiveDate: "2024-01-01",
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0,
        },
        null
      )
    }).toThrow(MissingCountryError)
  })

  it("throws UnsupportedCountryError for unsupported country", () => {
    expect(() => {
      calculatePayroll(
        {
          jurisdiction: "US",
          effectiveDate: "2024-01-01",
          basicSalary: 50000,
          allowances: 0,
          otherDeductions: 0,
        },
        "US"
      )
    }).toThrow(UnsupportedCountryError)
  })
})

describe("Payroll Engine - Kenya Effective Date Versioning", () => {
  it("uses legacy regime (NHIF) for dates before 2024-07-01", () => {
    const result = kenyaPayrollEngine.calculate({
      jurisdiction: "KE",
      effectiveDate: "2024-06-30", // Just before SHIF introduction
      basicSalary: 50000,
      allowances: 0,
      otherDeductions: 0,
    })

    // Should use NHIF (legacy regime)
    const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
    expect(nhif).toBeDefined()
    expect(nhif?.amount).toBe(1200)

    // Should NOT have SHIF or AHL
    const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
    expect(shif).toBeUndefined()

    const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
    expect(ahlEmployee).toBeUndefined()

    const ahlEmployer = result.employerContributions.find(c => c.code === "AHL_EMPLOYER")
    expect(ahlEmployer).toBeUndefined()
  })

  it("uses current regime (SHIF + AHL) for dates on/after 2024-07-01", () => {
    const result = kenyaPayrollEngine.calculate({
      jurisdiction: "KE",
      effectiveDate: "2024-07-01", // SHIF introduction date
      basicSalary: 50000,
      allowances: 0,
      otherDeductions: 0,
    })

    // Should use SHIF + AHL (current regime)
    const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
    expect(shif).toBeDefined()
    expect(shif?.amount).toBeCloseTo(1375, 2)

    const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
    expect(ahlEmployee).toBeDefined()
    expect(ahlEmployee?.amount).toBeCloseTo(750, 2)

    const ahlEmployer = result.employerContributions.find(c => c.code === "AHL_EMPLOYER")
    expect(ahlEmployer).toBeDefined()
    expect(ahlEmployer?.amount).toBeCloseTo(750, 2)

    // Should NOT have NHIF
    const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
    expect(nhif).toBeUndefined()
  })

  it("uses current regime for future dates", () => {
    const result = kenyaPayrollEngine.calculate({
      jurisdiction: "KE",
      effectiveDate: "2025-01-01", // After SHIF introduction
      basicSalary: 50000,
      allowances: 0,
      otherDeductions: 0,
    })

    // Should use SHIF + AHL (current regime)
    const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
    expect(shif).toBeDefined()

    const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
    expect(ahlEmployee).toBeDefined()

    // Should NOT have NHIF
    const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
    expect(nhif).toBeUndefined()
  })
})

describe("Payroll Engine - Kenya Deterministic Calculations", () => {
  it("uses payroll_month as effectiveDate for deterministic calculations (legacy regime)", () => {
    const payrollMonth = "2024-06-01" // Before SHIF introduction

    // Same staff, same amounts, same payroll_month should produce same results
    const result1 = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: payrollMonth,
        basicSalary: 50000,
        allowances: 10000,
        otherDeductions: 2000,
      },
      "KE"
    )

    const result2 = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: payrollMonth,
        basicSalary: 50000,
        allowances: 10000,
        otherDeductions: 2000,
      },
      "KE"
    )

    // Results should be identical (deterministic)
    expect(result1.totals.grossSalary).toBe(result2.totals.grossSalary)
    expect(result1.totals.netSalary).toBe(result2.totals.netSalary)
    expect(result1.statutoryDeductions[0].amount).toBe(result2.statutoryDeductions[0].amount)
    expect(result1.statutoryDeductions[1].amount).toBe(result2.statutoryDeductions[1].amount)
    expect(result1.statutoryDeductions[2].amount).toBe(result2.statutoryDeductions[2].amount)
  })

  it("uses payroll_month as effectiveDate for deterministic calculations (current regime)", () => {
    const payrollMonth = "2024-07-01" // SHIF introduction date

    // Same staff, same amounts, same payroll_month should produce same results
    const result1 = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: payrollMonth,
        basicSalary: 50000,
        allowances: 10000,
        otherDeductions: 2000,
      },
      "KE"
    )

    const result2 = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: payrollMonth,
        basicSalary: 50000,
        allowances: 10000,
        otherDeductions: 2000,
      },
      "KE"
    )

    // Results should be identical (deterministic)
    expect(result1.totals.grossSalary).toBe(result2.totals.grossSalary)
    expect(result1.totals.netSalary).toBe(result2.totals.netSalary)
    expect(result1.statutoryDeductions.length).toBe(result2.statutoryDeductions.length)
    expect(result1.employerContributions.length).toBe(result2.employerContributions.length)
  })

  it("produces known outputs for standard salary examples (legacy regime)", () => {
    // Test known example: 50,000 KES salary, legacy regime
    const result = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      },
      "KE"
    )

    // Verify known values
    expect(result.earnings.grossSalary).toBe(50000)
    
    // NSSF Employee: 6% of 50,000 = 3,000
    const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
    expect(nssfEmployee?.amount).toBeCloseTo(3000, 2)
    
    // NHIF: 1,200 (for gross 50,000, legacy regime)
    const nhif = result.statutoryDeductions.find(d => d.code === "NHIF")
    expect(nhif?.amount).toBe(1200)
    
    // Taxable: 50,000 - 3,000 - 1,200 = 45,800
    expect(result.totals.taxableIncome).toBeCloseTo(45800, 2)
    
    // PAYE: Gross 8,523.35 - Personal Relief 2,400 = 6,123.35
    const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
    expect(paye?.amount).toBeCloseTo(6123.35, 2)
    
    // Net: 45,800 - 6,123.35 = 39,676.65
    expect(result.totals.netSalary).toBeCloseTo(39676.65, 2)
  })

  it("produces known outputs for standard salary examples (current regime)", () => {
    // Test known example: 50,000 KES salary, current regime
    const result = calculatePayroll(
      {
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      },
      "KE"
    )

    // Verify known values
    expect(result.earnings.grossSalary).toBe(50000)
    
    // NSSF Employee: 6% of 50,000 = 3,000
    const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
    expect(nssfEmployee?.amount).toBeCloseTo(3000, 2)
    
    // SHIF: 2.75% of 50,000 = 1,375
    const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
    expect(shif?.amount).toBeCloseTo(1375, 2)
    
    // AHL Employee: 1.5% of 50,000 = 750
    const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
    expect(ahlEmployee?.amount).toBeCloseTo(750, 2)
    
    // Taxable: 50,000 - 3,000 - 1,375 - 750 = 44,875
    expect(result.totals.taxableIncome).toBeCloseTo(44875, 2)
    
    // PAYE: Gross 8,245.85 - Personal Relief 2,400 = 5,845.85
    const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
    expect(paye?.amount).toBeCloseTo(5845.85, 2)
    
    // Net: 44,875 - 5,845.85 = 39,029.15
    expect(result.totals.netSalary).toBeCloseTo(39029.15, 2)
  })

  describe("Personal Relief", () => {
    it("applies Personal Relief (KES 2,400) to PAYE after gross calculation (current regime)", () => {
      // Test case: 50,000 KES salary with Personal Relief
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01", // SHIF introduction date
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 50,000
      expect(result.earnings.grossSalary).toBe(50000)

      // Taxable: 44,875 (after NSSF, SHIF, AHL)
      expect(result.totals.taxableIncome).toBeCloseTo(44875, 2)

      // Gross PAYE: 8,245.85
      // Net PAYE: 8,245.85 - 2,400 (Personal Relief) = 5,845.85
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(5845.85, 2)

      // Net Salary: 44,875 - 5,845.85 = 39,029.15
      expect(result.totals.netSalary).toBeCloseTo(39029.15, 2)
    })

    it("applies Personal Relief (KES 2,400) to PAYE after gross calculation (legacy regime)", () => {
      // Test case: 50,000 KES salary with Personal Relief (legacy regime)
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-01-01", // Before SHIF introduction
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // Gross: 50,000
      expect(result.earnings.grossSalary).toBe(50000)

      // Taxable: 45,800 (after NSSF, NHIF)
      expect(result.totals.taxableIncome).toBeCloseTo(45800, 2)

      // Gross PAYE: 8,523.35
      // Net PAYE: 8,523.35 - 2,400 (Personal Relief) = 6,123.35
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(6123.35, 2)

      // Net Salary: 45,800 - 6,123.35 = 39,676.65
      expect(result.totals.netSalary).toBeCloseTo(39676.65, 2)
    })

    it("ensures PAYE never goes negative for low-income earners (Personal Relief caps at zero)", () => {
      // Test case: Low taxable income where Personal Relief exceeds gross PAYE
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01",
        basicSalary: 15000, // Low income
        allowances: 0,
        otherDeductions: 0,
      })

      // Calculate expected values
      const grossSalary = 15000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")?.amount || 0
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")?.amount || 0
      const taxableIncome = grossSalary - nssfEmployee - shif - ahlEmployee

      // For low taxable income (e.g., ~12,000), gross PAYE might be less than 2,400
      // Example: Taxable 12,000, gross PAYE = 12,000 * 0.10 = 1,200
      // Net PAYE: max(0, 1,200 - 2,400) = 0

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      
      // PAYE should never be negative (Personal Relief is capped at zero)
      expect(paye?.amount).toBeGreaterThanOrEqual(0)

      // For very low income, PAYE should be 0 after Personal Relief
      if (taxableIncome <= 24000) {
        // Gross PAYE is at most 2,400 (10% of 24,000)
        // After Personal Relief of 2,400, net PAYE should be 0
        expect(paye?.amount).toBe(0)
      }
    })

    it("applies Personal Relief correctly when gross PAYE exactly equals Personal Relief", () => {
      // Test case: Taxable income where gross PAYE = Personal Relief (2,400)
      // Gross PAYE of 2,400 means taxable income of 24,000 (10% band)
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01",
        basicSalary: 30000, // Adjusted to get taxable income close to 24,000
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()

      // Net PAYE should be >= 0
      expect(paye?.amount).toBeGreaterThanOrEqual(0)

      // If taxable income is exactly 24,000, gross PAYE = 2,400, net PAYE = 0
      // If taxable income > 24,000, gross PAYE > 2,400, net PAYE > 0
      const taxableIncome = result.totals.taxableIncome
      if (taxableIncome <= 24000) {
        expect(paye?.amount).toBe(0)
      } else {
        expect(paye?.amount).toBeGreaterThan(0)
      }
    })

    it("verifies Personal Relief does not affect other deductions", () => {
      // Verify that Personal Relief only affects PAYE, not NSSF, SHIF, or AHL
      const result = kenyaPayrollEngine.calculate({
        jurisdiction: "KE",
        effectiveDate: "2024-07-01",
        basicSalary: 50000,
        allowances: 0,
        otherDeductions: 0,
      })

      // NSSF Employee should be unchanged
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee?.amount).toBeCloseTo(3000, 2)

      // SHIF should be unchanged
      const shif = result.statutoryDeductions.find(d => d.code === "SHIF")
      expect(shif?.amount).toBeCloseTo(1375, 2)

      // AHL Employee should be unchanged
      const ahlEmployee = result.statutoryDeductions.find(d => d.code === "AHL_EMPLOYEE")
      expect(ahlEmployee?.amount).toBeCloseTo(750, 2)

      // Taxable income should be unchanged (Personal Relief doesn't affect taxable income)
      expect(result.totals.taxableIncome).toBeCloseTo(44875, 2)
    })
  })
})
