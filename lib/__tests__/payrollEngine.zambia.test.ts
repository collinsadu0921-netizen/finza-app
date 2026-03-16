/**
 * Unit tests for lib/payrollEngine/jurisdictions/zambia.ts
 * 
 * Tests validate:
 * - Zambia payroll engine calculates correctly
 * - PAYE progressive tax bands (monthly, ZRA bands)
 * - NAPSA contributions with versioned caps (2025 and 2026)
 * - NHIMA contributions (1%+1% on basic salary only)
 * - SDL employer-only contribution (0.5% of gross)
 * - Taxable income calculation (NAPSA employee is tax-deductible)
 * - Net salary calculation
 * - Structure matches PayrollCalculationResult contract
 */

import { calculatePayroll } from "../payrollEngine"
import { zambiaPayrollEngine, ZAMBIA_PAYROLL_DUE_DATES, getZambiaComplianceWarnings } from "../payrollEngine/jurisdictions/zambia"

describe("Payroll Engine - Zambia Calculations", () => {
  describe("PAYE Calculations", () => {
    describe("PAYE Boundary Checks", () => {
      it("calculates PAYE = 0 for chargeable = 5,100", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 5100,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        expect(paye?.amount).toBe(0)
        expect(paye?.base).toBeCloseTo(5100, 2)
      })

      it("calculates PAYE = 400 for chargeable = 7,100", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 7100,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = (7,100 - 5,100) * 0.20 = 2,000 * 0.20 = 400
        expect(paye?.amount).toBeCloseTo(400, 2)
        expect(paye?.base).toBeCloseTo(7100, 2)
      })

      it("calculates PAYE = 1,030 for chargeable = 9,200", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 9200,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 400 + (9,200 - 7,100) * 0.30 = 400 + 2,100 * 0.30 = 400 + 630 = 1,030
        expect(paye?.amount).toBeCloseTo(1030, 2)
        expect(paye?.base).toBeCloseTo(9200, 2)
      })

      it("calculates PAYE = 1,400 for chargeable = 10,200", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 10200,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 1,030 + (10,200 - 9,200) * 0.37 = 1,030 + 1,000 * 0.37 = 1,030 + 370 = 1,400
        expect(paye?.amount).toBeCloseTo(1400, 2)
        expect(paye?.base).toBeCloseTo(10200, 2)
      })
    })

    describe("PAYE Progressive Bands", () => {
      it("calculates PAYE correctly in first band (5,100.01 <= chargeable <= 7,100)", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 6000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = (6,000 - 5,100) * 0.20 = 900 * 0.20 = 180
        expect(paye?.amount).toBeCloseTo(180, 2)
      })

      it("calculates PAYE correctly in second band (7,100.01 <= chargeable <= 9,200)", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 8000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 400 + (8,000 - 7,100) * 0.30 = 400 + 900 * 0.30 = 400 + 270 = 670
        expect(paye?.amount).toBeCloseTo(670, 2)
      })

      it("calculates PAYE correctly in third band (chargeable > 9,200)", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 15000,
          allowances: 0,
          otherDeductions: 0,
        })

        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye).toBeDefined()
        // PAYE = 1,030 + (15,000 - 9,200) * 0.37 = 1,030 + 5,800 * 0.37 = 1,030 + 2,146 = 3,176
        expect(paye?.amount).toBeCloseTo(3176, 2)
      })
    })
  })

  describe("NAPSA Contributions", () => {
    describe("NAPSA Cap Versioning", () => {
      it("caps NAPSA at 1,708.20 for effectiveDate = 2025-06-01 with gross huge", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2025-06-01",
          basicSalary: 100000, // Very high gross to test cap
          allowances: 0,
          otherDeductions: 0,
        })

        const napsaEmployee = result.statutoryDeductions.find(d => d.code === "NAPSA_EMPLOYEE")
        const napsaEmployer = result.employerContributions.find(c => c.code === "NAPSA_EMPLOYER")

        expect(napsaEmployee).toBeDefined()
        // 5% of 100,000 = 5,000, but capped at 1,708.20
        expect(napsaEmployee?.amount).toBeCloseTo(1708.20, 2)
        expect(napsaEmployee?.rate).toBe(0.05)

        expect(napsaEmployer).toBeDefined()
        expect(napsaEmployer?.amount).toBeCloseTo(1708.20, 2)
        expect(napsaEmployer?.rate).toBe(0.05)
      })

      it("caps NAPSA at 1,861.80 for effectiveDate = 2026-01-01 with gross huge", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2026-01-01",
          basicSalary: 100000, // Very high gross to test cap
          allowances: 0,
          otherDeductions: 0,
        })

        const napsaEmployee = result.statutoryDeductions.find(d => d.code === "NAPSA_EMPLOYEE")
        const napsaEmployer = result.employerContributions.find(c => c.code === "NAPSA_EMPLOYER")

        expect(napsaEmployee).toBeDefined()
        // 5% of 100,000 = 5,000, but capped at 1,861.80
        expect(napsaEmployee?.amount).toBeCloseTo(1861.80, 2)

        expect(napsaEmployer).toBeDefined()
        expect(napsaEmployer?.amount).toBeCloseTo(1861.80, 2)
      })

      it("calculates NAPSA below cap correctly", () => {
        const result = zambiaPayrollEngine.calculate({
          jurisdiction: "ZM",
          effectiveDate: "2025-06-01",
          basicSalary: 20000,
          allowances: 0,
          otherDeductions: 0,
        })

        const napsaEmployee = result.statutoryDeductions.find(d => d.code === "NAPSA_EMPLOYEE")
        expect(napsaEmployee).toBeDefined()
        // 5% of 20,000 = 1,000 (below cap)
        expect(napsaEmployee?.amount).toBeCloseTo(1000, 2)
      })
    })
  })

  describe("NHIMA Contributions", () => {
    it("calculates NHIMA 1% employee + 1% employer on basic salary only (default)", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 90000, // NHIMA ignores allowances when nhimaBase='basic'
        otherDeductions: 0,
        // nhimaBase not provided (defaults to 'basic')
      })

      const nhimaEmployee = result.statutoryDeductions.find(d => d.code === "NHIMA_EMPLOYEE")
      const nhimaEmployer = result.employerContributions.find(c => c.code === "NHIMA_EMPLOYER")

      expect(nhimaEmployee).toBeDefined()
      // 1% of 10,000 = 100 (not 1,000 which would be 1% of 100,000)
      expect(nhimaEmployee?.amount).toBeCloseTo(100, 2)
      expect(nhimaEmployee?.rate).toBe(0.01)
      expect(nhimaEmployee?.base).toBeCloseTo(10000, 2) // Basic salary only

      expect(nhimaEmployer).toBeDefined()
      expect(nhimaEmployer?.amount).toBeCloseTo(100, 2)
      expect(nhimaEmployer?.rate).toBe(0.01)
      expect(nhimaEmployer?.base).toBeCloseTo(10000, 2) // Basic salary only
    })

    it("calculates NHIMA on gross when nhimaBase='gross'", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 90000,
        otherDeductions: 0,
        nhimaBase: 'gross',
      })

      const nhimaEmployee = result.statutoryDeductions.find(d => d.code === "NHIMA_EMPLOYEE")
      const nhimaEmployer = result.employerContributions.find(c => c.code === "NHIMA_EMPLOYER")

      expect(nhimaEmployee).toBeDefined()
      // 1% of 100,000 (gross) = 1,000
      expect(nhimaEmployee?.amount).toBeCloseTo(1000, 2)
      expect(nhimaEmployee?.base).toBeCloseTo(100000, 2) // Gross salary

      expect(nhimaEmployer).toBeDefined()
      expect(nhimaEmployer?.amount).toBeCloseTo(1000, 2)
      expect(nhimaEmployer?.base).toBeCloseTo(100000, 2) // Gross salary
    })
  })

  describe("SDL Contributions", () => {
    it("calculates SDL 0.5% employer-only on gross", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 80000,
        allowances: 20000,
        otherDeductions: 0,
      })

      const sdl = result.employerContributions.find(c => c.code === "SDL_EMPLOYER")
      expect(sdl).toBeDefined()
      // 0.5% of 100,000 = 500
      expect(sdl?.amount).toBeCloseTo(500, 2)
      expect(sdl?.rate).toBe(0.005)
      expect(sdl?.base).toBeCloseTo(100000, 2) // Gross salary

      // Verify SDL is not in statutory deductions (employer-only)
      const sdlInDeductions = result.statutoryDeductions.find(d => d.code === "SDL_EMPLOYER")
      expect(sdlInDeductions).toBeUndefined()
    })
  })

  describe("WCFCB Contributions (Audit-Ready 2026)", () => {
    it("includes WCFCB employer contribution when wcfcRate > 0", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 80000,
        allowances: 20000,
        otherDeductions: 0,
        wcfcRate: 0.01, // 1%
      })

      const wcfcb = result.employerContributions.find(c => c.code === "WCFCB_EMPLOYER")
      expect(wcfcb).toBeDefined()
      // 1% of 100,000 = 1,000
      expect(wcfcb?.amount).toBeCloseTo(1000, 2)
      expect(wcfcb?.rate).toBe(0.01)
      expect(wcfcb?.base).toBeCloseTo(100000, 2) // Gross salary

      // Verify WCFCB is not in statutory deductions (employer-only)
      const wcfcbInDeductions = result.statutoryDeductions.find(d => d.code === "WCFCB_EMPLOYER")
      expect(wcfcbInDeductions).toBeUndefined()
    })

    it("excludes WCFCB when wcfcRate = 0", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        wcfcRate: 0,
      })

      const wcfcb = result.employerContributions.find(c => c.code === "WCFCB_EMPLOYER")
      expect(wcfcb).toBeUndefined()
    })

    it("excludes WCFCB when wcfcRate is undefined (default)", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        // wcfcRate not provided (defaults to 0)
      })

      const wcfcb = result.employerContributions.find(c => c.code === "WCFCB_EMPLOYER")
      expect(wcfcb).toBeUndefined()
    })

    it("includes WCFCB in totalEmployerContributions", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        wcfcRate: 0.015, // 1.5%
      })

      const calculatedTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedTotal, 2)

      // Verify WCFCB is included
      const wcfcb = result.employerContributions.find(c => c.code === "WCFCB_EMPLOYER")
      expect(wcfcb?.amount).toBeGreaterThan(0)
    })
  })

  describe("Compliance Warnings", () => {
    it("returns warning when wcfcRate = 0", () => {
      const warnings = getZambiaComplianceWarnings({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        wcfcRate: 0,
      })

      expect(warnings.length).toBeGreaterThan(0)
      const wcfcbWarning = warnings.find(w => w.includes("ZM_WCFCB_MISSING_RATE"))
      expect(wcfcbWarning).toBeDefined()
      expect(wcfcbWarning).toContain("WCFCB employer rate not configured")
    })

    it("returns warning when wcfcRate is undefined", () => {
      const warnings = getZambiaComplianceWarnings({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        // wcfcRate not provided
      })

      expect(warnings.length).toBeGreaterThan(0)
      const wcfcbWarning = warnings.find(w => w.includes("ZM_WCFCB_MISSING_RATE"))
      expect(wcfcbWarning).toBeDefined()
    })

    it("returns no WCFCB warning when wcfcRate > 0", () => {
      const warnings = getZambiaComplianceWarnings({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        wcfcRate: 0.01,
      })

      const wcfcbWarning = warnings.find(w => w.includes("ZM_WCFCB_MISSING_RATE"))
      expect(wcfcbWarning).toBeUndefined()
    })

    it("returns warning when nhimaBase is undefined", () => {
      const warnings = getZambiaComplianceWarnings({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        // nhimaBase not provided
      })

      const nhimaWarning = warnings.find(w => w.includes("ZM_NHIMA_BASE_DEFAULTED"))
      expect(nhimaWarning).toBeDefined()
      expect(nhimaWarning).toContain("NHIMA base defaulted to BASIC")
    })

    it("returns no NHIMA warning when nhimaBase is explicitly set", () => {
      const warnings = getZambiaComplianceWarnings({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
        nhimaBase: 'basic',
      })

      const nhimaWarning = warnings.find(w => w.includes("ZM_NHIMA_BASE_DEFAULTED"))
      expect(nhimaWarning).toBeUndefined()
    })

    it("returns NAPSA cap informational for 2026+ high earners", () => {
      const warnings = getZambiaComplianceWarnings({
        jurisdiction: "ZM",
        effectiveDate: "2026-01-01",
        basicSalary: 100000, // High gross
        allowances: 0,
        otherDeductions: 0,
        wcfcRate: 0.01, // Set to avoid WCFCB warning
        nhimaBase: 'basic', // Set to avoid NHIMA warning
      })

      const napsaWarning = warnings.find(w => w.includes("ZM_NAPSA_CAP_APPLIED"))
      expect(napsaWarning).toBeDefined()
      expect(napsaWarning).toContain("1,861.80")
    })
  })

  describe("Taxable Income Calculation", () => {
    it("sets taxable income = grossMonthly - napsaEmployee (NAPSA is tax-deductible)", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 20000,
        allowances: 5000,
        otherDeductions: 0,
      })

      const grossMonthly = 25000
      const napsaEmployee = result.statutoryDeductions.find(d => d.code === "NAPSA_EMPLOYEE")?.amount || 0
      const expectedTaxableIncome = grossMonthly - napsaEmployee

      expect(result.totals.taxableIncome).toBeCloseTo(expectedTaxableIncome, 2)
    })
  })

  describe("Net Salary Calculation", () => {
    it("calculates netSalary = grossMonthly - PAYE - napsaEmployee - nhimaEmployee - otherDeductions", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 10000,
        allowances: 5000,
        otherDeductions: 2000,
      })

      const grossMonthly = 15000
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const napsaEmployee = result.statutoryDeductions.find(d => d.code === "NAPSA_EMPLOYEE")?.amount || 0
      const nhimaEmployee = result.statutoryDeductions.find(d => d.code === "NHIMA_EMPLOYEE")?.amount || 0
      const expectedNet = grossMonthly - paye - napsaEmployee - nhimaEmployee - 2000

      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })

    it("ensures netSalary never goes negative", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 1000,
        allowances: 0,
        otherDeductions: 50000, // More than gross
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })
  })

  describe("Output Structure", () => {
    it("returns valid PayrollCalculationResult structure", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 20000,
        allowances: 5000,
        otherDeductions: 1000,
      })

      // Check earnings
      expect(result.earnings).toBeDefined()
      expect(typeof result.earnings.basicSalary).toBe("number")
      expect(typeof result.earnings.allowances).toBe("number")
      expect(typeof result.earnings.grossSalary).toBe("number")

      // Check statutory deductions (ordered: PAYE, NAPSA_EMPLOYEE, NHIMA_EMPLOYEE)
      expect(Array.isArray(result.statutoryDeductions)).toBe(true)
      expect(result.statutoryDeductions.length).toBe(3)
      expect(result.statutoryDeductions[0].code).toBe("PAYE")
      expect(result.statutoryDeductions[1].code).toBe("NAPSA_EMPLOYEE")
      expect(result.statutoryDeductions[2].code).toBe("NHIMA_EMPLOYEE")

      // Check employer contributions (ordered: NAPSA_EMPLOYER, NHIMA_EMPLOYER, SDL_EMPLOYER)
      expect(Array.isArray(result.employerContributions)).toBe(true)
      expect(result.employerContributions.length).toBe(3)
      expect(result.employerContributions[0].code).toBe("NAPSA_EMPLOYER")
      expect(result.employerContributions[1].code).toBe("NHIMA_EMPLOYER")
      expect(result.employerContributions[2].code).toBe("SDL_EMPLOYER")

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
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 20000,
        allowances: 5000,
        otherDeductions: 1000,
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
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 33333.333,
        allowances: 11111.111,
        otherDeductions: 5555.555,
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
    it("totals reconcile correctly", () => {
      const result = zambiaPayrollEngine.calculate({
        jurisdiction: "ZM",
        effectiveDate: "2024-01-01",
        basicSalary: 20000,
        allowances: 5000,
        otherDeductions: 1000,
      })

      // grossSalary = basicSalary + allowances
      expect(result.totals.grossSalary).toBe(result.earnings.basicSalary + result.earnings.allowances)

      // totalStatutoryDeductions = sum of all statutory deductions (PAYE + NAPSA + NHIMA)
      const calculatedTotal = result.statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
      expect(result.totals.totalStatutoryDeductions).toBeCloseTo(calculatedTotal, 2)

      // totalEmployerContributions = sum of all employer contributions (NAPSA + NHIMA + SDL + WCFCB if applicable)
      const calculatedEmployerTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedEmployerTotal, 2)

      // taxableIncome = grossMonthly - napsaEmployee (NAPSA is tax-deductible)
      const napsaEmployee = result.statutoryDeductions.find(d => d.code === "NAPSA_EMPLOYEE")?.amount || 0
      expect(result.totals.taxableIncome).toBeCloseTo(result.totals.grossSalary - napsaEmployee, 2)

      // netSalary = grossSalary - totalStatutoryDeductions - totalOtherDeductions
      const expectedNet = result.totals.grossSalary - result.totals.totalStatutoryDeductions - result.totals.totalOtherDeductions
      expect(result.totals.netSalary).toBeCloseTo(Math.max(0, expectedNet), 2)
    })
  })

  describe("Due Date Constants", () => {
    it("exports ZM_PAYE_DUE_DAY constant", () => {
      expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_PAYE_DUE_DAY).toBe(10)
    })

    it("exports ZM_SDL_DUE_DAY constant", () => {
      expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_SDL_DUE_DAY).toBe(10)
    })

    it("exports ZM_NHIMA_DUE_DAY constant", () => {
      expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_NHIMA_DUE_DAY).toBe(10)
    })

    it("exports ZM_NAPSA_DUE_DAY constant", () => {
      expect(ZAMBIA_PAYROLL_DUE_DATES.ZM_NAPSA_DUE_DAY).toBe(10)
    })
  })

  describe("Registry Integration", () => {
    it("resolves Zambia engine from registry", () => {
      const result = calculatePayroll(
        {
          jurisdiction: "ZM",
          effectiveDate: "2024-01-01",
          basicSalary: 20000,
          allowances: 0,
          otherDeductions: 0,
        },
        "ZM"
      )

      expect(result).toBeDefined()
      expect(result.statutoryDeductions.length).toBeGreaterThan(0)
      expect(result.employerContributions.length).toBeGreaterThan(0)
    })
  })
})
