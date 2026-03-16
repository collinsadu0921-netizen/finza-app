/**
 * Unit tests for lib/payrollEngine/jurisdictions/tanzania.ts
 * 
 * Tests validate:
 * - Tanzania payroll engine calculates correctly
 * - NSSF employee and employer contributions (10% each)
 * - PAYE progressive tax bands (monthly, residents)
 * - Taxable income calculation (NSSF is tax-deductible)
 * - Net salary calculation
 * - Structure matches PayrollCalculationResult contract
 */

import { calculatePayroll } from "../payrollEngine"
import { tanzaniaPayrollEngine, getTanzaniaComplianceWarnings, TANZANIA_PAYROLL_DUE_DATES } from "../payrollEngine/jurisdictions/tanzania"

describe("Payroll Engine - Tanzania Calculations", () => {
  describe("NSSF Calculations", () => {
    it("calculates NSSF employee correctly (10% of gross salary)", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 0,
      })

      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee).toBeDefined()
      expect(nssfEmployee?.amount).toBeCloseTo(1200000 * 0.10, 2) // 10% of 1,200,000
      expect(nssfEmployee?.rate).toBe(0.10)
      expect(nssfEmployee?.base).toBeCloseTo(1200000, 2)
      expect(nssfEmployee?.isTaxDeductible).toBe(true) // NSSF is tax-deductible
    })

    it("calculates NSSF employer correctly (10% of gross salary)", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 0,
      })

      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")
      expect(nssfEmployer).toBeDefined()
      expect(nssfEmployer?.amount).toBeCloseTo(1200000 * 0.10, 2) // 10% of 1,200,000
      expect(nssfEmployer?.rate).toBe(0.10)
      expect(nssfEmployer?.base).toBeCloseTo(1200000, 2)
    })
  })

  describe("PAYE Calculations", () => {
    describe("PAYE Boundary Checks", () => {
      it("calculates PAYE = 0 for taxableMonthly = 270,000", () => {
        // To get taxableMonthly = 270,000, we need grossMonthly such that:
        // taxableMonthly = grossMonthly - (0.10 * grossMonthly) = 270,000
        // 0.90 * grossMonthly = 270,000
        // grossMonthly = 300,000
        const grossMonthly = 300000
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        expect(paye?.amount).toBe(0)
        expect(paye?.base).toBeCloseTo(270000, 2) // taxableMonthly = 300,000 - 30,000
      })

      it("calculates PAYE = 20,000 for taxableMonthly = 520,000", () => {
        // To get taxableMonthly = 520,000, we need grossMonthly such that:
        // taxableMonthly = grossMonthly - (0.10 * grossMonthly) = 520,000
        // 0.90 * grossMonthly = 520,000
        // grossMonthly = 577,777.78
        const grossMonthly = 577777.78
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = (520,000 - 270,000) * 0.08 = 250,000 * 0.08 = 20,000
        expect(paye?.amount).toBeCloseTo(20000, 2)
        expect(paye?.base).toBeCloseTo(520000, 2)
      })

      it("calculates PAYE = 68,000 for taxableMonthly = 760,000", () => {
        // To get taxableMonthly = 760,000, we need grossMonthly such that:
        // taxableMonthly = grossMonthly - (0.10 * grossMonthly) = 760,000
        // 0.90 * grossMonthly = 760,000
        // grossMonthly = 844,444.44
        const grossMonthly = 844444.44
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 20,000 + (760,000 - 520,000) * 0.20 = 20,000 + 240,000 * 0.20 = 20,000 + 48,000 = 68,000
        expect(paye?.amount).toBeCloseTo(68000, 2)
        expect(paye?.base).toBeCloseTo(760000, 2)
      })

      it("calculates PAYE = 128,000 for taxableMonthly = 1,000,000", () => {
        // To get taxableMonthly = 1,000,000, we need grossMonthly such that:
        // taxableMonthly = grossMonthly - (0.10 * grossMonthly) = 1,000,000
        // 0.90 * grossMonthly = 1,000,000
        // grossMonthly = 1,111,111.11
        const grossMonthly = 1111111.11
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 68,000 + (1,000,000 - 760,000) * 0.25 = 68,000 + 240,000 * 0.25 = 68,000 + 60,000 = 128,000
        expect(paye?.amount).toBeCloseTo(128000, 2)
        expect(paye?.base).toBeCloseTo(1000000, 2)
      })

      it("calculates PAYE = 158,000 for taxableMonthly = 1,100,000", () => {
        // To get taxableMonthly = 1,100,000, we need grossMonthly such that:
        // taxableMonthly = grossMonthly - (0.10 * grossMonthly) = 1,100,000
        // 0.90 * grossMonthly = 1,100,000
        // grossMonthly = 1,222,222.22
        const grossMonthly = 1222222.22
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 128,000 + (1,100,000 - 1,000,000) * 0.30 = 128,000 + 100,000 * 0.30 = 128,000 + 30,000 = 158,000
        expect(paye?.amount).toBeCloseTo(158000, 2)
        expect(paye?.base).toBeCloseTo(1100000, 2)
      })
    })

    describe("PAYE Progressive Bands", () => {
      it("calculates PAYE correctly in first band (270,000 < taxable <= 520,000)", () => {
        // Use taxableMonthly = 400,000
        // grossMonthly = 400,000 / 0.90 = 444,444.44
        const grossMonthly = 444444.44
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = (400,000 - 270,000) * 0.08 = 130,000 * 0.08 = 10,400
        expect(paye?.amount).toBeCloseTo(10400, 2)
      })

      it("calculates PAYE correctly in second band (520,000 < taxable <= 760,000)", () => {
        // Use taxableMonthly = 600,000
        // grossMonthly = 600,000 / 0.90 = 666,666.67
        const grossMonthly = 666666.67
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 20,000 + (600,000 - 520,000) * 0.20 = 20,000 + 80,000 * 0.20 = 20,000 + 16,000 = 36,000
        expect(paye?.amount).toBeCloseTo(36000, 2)
      })

      it("calculates PAYE correctly in third band (760,000 < taxable <= 1,000,000)", () => {
        // Use taxableMonthly = 900,000
        // grossMonthly = 900,000 / 0.90 = 1,000,000
        const grossMonthly = 1000000
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 68,000 + (900,000 - 760,000) * 0.25 = 68,000 + 140,000 * 0.25 = 68,000 + 35,000 = 103,000
        expect(paye?.amount).toBeCloseTo(103000, 2)
      })

      it("calculates PAYE correctly in fourth band (taxable > 1,000,000)", () => {
        // Use taxableMonthly = 1,500,000
        // grossMonthly = 1,500,000 / 0.90 = 1,666,666.67
        const grossMonthly = 1666666.67
        const result = tanzaniaPayrollEngine.calculate({
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 128,000 + (1,500,000 - 1,000,000) * 0.30 = 128,000 + 500,000 * 0.30 = 128,000 + 150,000 = 278,000
        expect(paye?.amount).toBeCloseTo(278000, 2)
      })
    })
  })

  describe("Taxable Income Calculation", () => {
    it("sets taxable income = grossMonthly - nssfEmployee (NSSF is tax-deductible)", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 0,
      })

      const grossMonthly = 600000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const expectedTaxableIncome = grossMonthly - nssfEmployee

      expect(result.totals.taxableIncome).toBeCloseTo(expectedTaxableIncome, 2)
      expect(result.totals.taxableIncome).toBeCloseTo(540000, 2) // 600,000 - 60,000
    })

    it("ensures taxable income never goes negative", () => {
      // Even with very small gross, taxable should be >= 0
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.totals.taxableIncome).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Net Salary Calculation", () => {
    it("calculates netSalary = grossMonthly - NSSF - PAYE - otherDeductions", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      const grossMonthly = 600000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const expectedNet = grossMonthly - nssfEmployee - paye - 50000

      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })

    it("ensures netSalary never goes negative", () => {
      // Even with very high deductions, net should be >= 0
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 200000, // More than gross
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Output Structure", () => {
    it("returns valid PayrollCalculationResult structure", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      // Check earnings
      expect(result.earnings).toBeDefined()
      expect(typeof result.earnings.basicSalary).toBe("number")
      expect(typeof result.earnings.allowances).toBe("number")
      expect(typeof result.earnings.grossSalary).toBe("number")

      // Check statutory deductions
      expect(Array.isArray(result.statutoryDeductions)).toBe(true)
      expect(result.statutoryDeductions.length).toBe(2) // NSSF_EMPLOYEE + PAYE
      expect(result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")).toBeDefined()
      expect(result.statutoryDeductions.find(d => d.code === "PAYE")).toBeDefined()

      // Check employer contributions
      expect(Array.isArray(result.employerContributions)).toBe(true)
      expect(result.employerContributions.length).toBe(1) // NSSF_EMPLOYER
      expect(result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")).toBeDefined()

      // Check totals
      expect(result.totals).toBeDefined()
      expect(typeof result.totals.grossSalary).toBe("number")
      expect(typeof result.totals.totalStatutoryDeductions).toBe("number")
      expect(typeof result.totals.totalOtherDeductions).toBe("number")
      expect(typeof result.totals.taxableIncome).toBe("number")
      expect(typeof result.totals.netSalary).toBe("number")
      expect(typeof result.totals.totalEmployerContributions).toBe("number")
    })

    it("has no NaN or undefined values", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      // Check earnings
      expect(Number.isFinite(result.earnings.basicSalary)).toBe(true)
      expect(Number.isFinite(result.earnings.allowances)).toBe(true)
      expect(Number.isFinite(result.earnings.grossSalary)).toBe(true)

      // Check statutory deductions
      result.statutoryDeductions.forEach(d => {
        expect(Number.isFinite(d.amount)).toBe(true)
        expect(Number.isFinite(d.rate)).toBe(true)
        expect(Number.isFinite(d.base)).toBe(true)
        expect(d.amount).not.toBeNaN()
        expect(d.amount).not.toBeUndefined()
      })

      // Check employer contributions
      result.employerContributions.forEach(c => {
        expect(Number.isFinite(c.amount)).toBe(true)
        expect(Number.isFinite(c.rate)).toBe(true)
        expect(Number.isFinite(c.base)).toBe(true)
        expect(c.amount).not.toBeNaN()
        expect(c.amount).not.toBeUndefined()
      })

      // Check totals
      expect(Number.isFinite(result.totals.grossSalary)).toBe(true)
      expect(Number.isFinite(result.totals.totalStatutoryDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.totalOtherDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.taxableIncome)).toBe(true)
      expect(Number.isFinite(result.totals.netSalary)).toBe(true)
      expect(Number.isFinite(result.totals.totalEmployerContributions)).toBe(true)
    })

    it("rounds all amounts to 2 decimal places", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 333333.333,
        allowances: 111111.111,
        otherDeductions: 55555.555,
      })

      const checkDecimals = (value: number) => {
        const str = value.toString()
        const decimalPart = str.split('.')[1]
        return !decimalPart || decimalPart.length <= 2
      }

      expect(checkDecimals(result.earnings.basicSalary)).toBe(true)
      expect(checkDecimals(result.earnings.allowances)).toBe(true)
      expect(checkDecimals(result.earnings.grossSalary)).toBe(true)
      expect(checkDecimals(result.totals.netSalary)).toBe(true)

      result.statutoryDeductions.forEach(d => {
        expect(checkDecimals(d.amount)).toBe(true)
      })

      result.employerContributions.forEach(c => {
        expect(checkDecimals(c.amount)).toBe(true)
      })
    })
  })

  describe("Totals Reconciliation", () => {
    it("totals reconcile correctly with all employer contributions", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 50000,
      })

      // grossSalary = basicSalary + allowances
      expect(result.totals.grossSalary).toBe(result.earnings.basicSalary + result.earnings.allowances)

      // totalStatutoryDeductions = sum of all statutory deductions (NSSF + PAYE)
      const calculatedTotal = result.statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
      expect(result.totals.totalStatutoryDeductions).toBeCloseTo(calculatedTotal, 2)

      // totalEmployerContributions = sum of all employer contributions (NSSF + WCF + SDL)
      const calculatedEmployerTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedEmployerTotal, 2)

      // Verify all three employer contributions are included
      expect(result.employerContributions.length).toBe(3)
      expect(result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")).toBeDefined()
      expect(result.employerContributions.find(c => c.code === "WCF_EMPLOYER")).toBeDefined()
      expect(result.employerContributions.find(c => c.code === "SDL_EMPLOYER")).toBeDefined()

      // taxableIncome = grossMonthly - nssfEmployee (NSSF is tax-deductible)
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      expect(result.totals.taxableIncome).toBeCloseTo(result.totals.grossSalary - nssfEmployee, 2)

      // netSalary = grossSalary - totalStatutoryDeductions - totalOtherDeductions
      // NOTE: Employer contributions do NOT reduce netSalary
      const expectedNet = result.totals.grossSalary - result.totals.totalStatutoryDeductions - result.totals.totalOtherDeductions
      expect(result.totals.netSalary).toBeCloseTo(Math.max(0, expectedNet), 2)
    })
  })

  describe("Employer Contributions (Audit-Ready 2026)", () => {
    it("calculates all employer contributions correctly for grossMonthly = 1,000,000", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")
      const wcfEmployer = result.employerContributions.find(c => c.code === "WCF_EMPLOYER")
      const sdlEmployer = result.employerContributions.find(c => c.code === "SDL_EMPLOYER")

      // NSSF Employer: 10% of 1,000,000 = 100,000
      expect(nssfEmployer).toBeDefined()
      expect(nssfEmployer?.amount).toBeCloseTo(100000, 2)
      expect(nssfEmployer?.rate).toBe(0.10)
      expect(nssfEmployer?.base).toBeCloseTo(1000000, 2)

      // WCF Employer: 0.5% of 1,000,000 = 5,000
      expect(wcfEmployer).toBeDefined()
      expect(wcfEmployer?.amount).toBeCloseTo(5000, 2)
      expect(wcfEmployer?.rate).toBe(0.005)
      expect(wcfEmployer?.base).toBeCloseTo(1000000, 2)

      // SDL Employer: 3.5% of 1,000,000 = 35,000
      expect(sdlEmployer).toBeDefined()
      expect(sdlEmployer?.amount).toBeCloseTo(35000, 2)
      expect(sdlEmployer?.rate).toBe(0.035)
      expect(sdlEmployer?.base).toBeCloseTo(1000000, 2)

      // Total employer contributions: 100,000 + 5,000 + 35,000 = 140,000
      expect(result.totals.totalEmployerContributions).toBeCloseTo(140000, 2)
    })

    it("orders employer contributions as NSSF_EMPLOYER, WCF_EMPLOYER, SDL_EMPLOYER", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.employerContributions.length).toBe(3)
      expect(result.employerContributions[0].code).toBe("NSSF_EMPLOYER")
      expect(result.employerContributions[1].code).toBe("WCF_EMPLOYER")
      expect(result.employerContributions[2].code).toBe("SDL_EMPLOYER")
    })

    it("ensures employer contributions do NOT affect netSalary", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const grossMonthly = 1000000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const expectedNet = grossMonthly - nssfEmployee - paye

      // Net salary should be calculated without employer contributions
      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)

      // Verify employer contributions are separate
      const totalEmployerCost = result.totals.totalEmployerContributions
      expect(totalEmployerCost).toBeGreaterThan(0)
      expect(result.totals.netSalary).not.toBeLessThan(expectedNet)
    })

    it("includes all employer contributions in totals.totalEmployerContributions", () => {
      const result = tanzaniaPayrollEngine.calculate({
        jurisdiction: "TZ",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 200000,
        otherDeductions: 0,
      })

      const calculatedTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedTotal, 2)

      // Verify all three contributions are included
      expect(result.employerContributions.length).toBe(3)
      expect(result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")).toBeDefined()
      expect(result.employerContributions.find(c => c.code === "WCF_EMPLOYER")).toBeDefined()
      expect(result.employerContributions.find(c => c.code === "SDL_EMPLOYER")).toBeDefined()
    })
  })

  describe("Compliance Warnings", () => {
    it("returns no minimum wage warning for effectiveDate before 2026-01-01", () => {
      const warnings = getTanzaniaComplianceWarnings({
        jurisdiction: "TZ",
        effectiveDate: "2025-12-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(warnings).toEqual([])
    })

    it("returns minimum wage warning for effectiveDate >= 2026-01-01 and gross < 175,000", () => {
      const warnings = getTanzaniaComplianceWarnings({
        jurisdiction: "TZ",
        effectiveDate: "2026-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(warnings.length).toBe(1)
      expect(warnings[0]).toContain("TZ_MIN_WAGE_RISK")
      expect(warnings[0]).toContain("175,000")
    })

    it("returns no minimum wage warning for gross >= 175,000 in 2026+", () => {
      const warnings = getTanzaniaComplianceWarnings({
        jurisdiction: "TZ",
        effectiveDate: "2026-01-01",
        basicSalary: 175000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(warnings).toEqual([])
    })

    it("returns minimum wage warning for gross < 175,000 even with allowances", () => {
      const warnings = getTanzaniaComplianceWarnings({
        jurisdiction: "TZ",
        effectiveDate: "2026-06-01",
        basicSalary: 150000,
        allowances: 20000, // Total = 170,000 < 175,000
        otherDeductions: 0,
      })

      expect(warnings.length).toBe(1)
      expect(warnings[0]).toContain("TZ_MIN_WAGE_RISK")
    })

    it("returns no warning when gross >= 175,000 with allowances", () => {
      const warnings = getTanzaniaComplianceWarnings({
        jurisdiction: "TZ",
        effectiveDate: "2026-06-01",
        basicSalary: 150000,
        allowances: 30000, // Total = 180,000 >= 175,000
        otherDeductions: 0,
      })

      expect(warnings).toEqual([])
    })
  })

  describe("Due Date Constants", () => {
    it("exports PAYE_SDL_DUE_DAY constant", () => {
      expect(TANZANIA_PAYROLL_DUE_DATES.PAYE_SDL_DUE_DAY).toBe(7)
    })

    it("exports NSSF_DUE_DAY constant", () => {
      expect(TANZANIA_PAYROLL_DUE_DATES.NSSF_DUE_DAY).toBe(15)
    })
  })

  describe("Registry Integration", () => {
    it("resolves Tanzania engine from registry", () => {
      const result = calculatePayroll(
        {
          jurisdiction: "TZ",
          effectiveDate: "2024-01-01",
          basicSalary: 500000,
          allowances: 0,
          otherDeductions: 0,
        },
        "TZ"
      )

      expect(result).toBeDefined()
      expect(result.statutoryDeductions.length).toBeGreaterThan(0)
      expect(result.employerContributions.length).toBeGreaterThan(0)
    })
  })
})
