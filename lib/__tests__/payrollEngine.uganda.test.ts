/**
 * Unit tests for lib/payrollEngine/jurisdictions/uganda.ts
 * 
 * Tests validate:
 * - Uganda payroll engine calculates correctly
 * - NSSF employee and employer contributions
 * - PAYE progressive tax bands (monthly, residents)
 * - Chargeable income calculation (NSSF is NOT tax-deductible)
 * - Net salary calculation
 * - Structure matches PayrollCalculationResult contract
 */

import { calculatePayroll } from "../payrollEngine"
import { ugandaPayrollEngine } from "../payrollEngine/jurisdictions/uganda"

describe("Payroll Engine - Uganda Calculations", () => {
  describe("NSSF Calculations", () => {
    it("calculates NSSF employee correctly (5% of gross salary)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 0,
      })

      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      expect(nssfEmployee).toBeDefined()
      expect(nssfEmployee?.amount).toBeCloseTo(1200000 * 0.05, 2) // 5% of 1,200,000
      expect(nssfEmployee?.rate).toBe(0.05)
      expect(nssfEmployee?.base).toBeCloseTo(1200000, 2)
      expect(nssfEmployee?.isTaxDeductible).toBe(false) // NSSF is NOT tax-deductible
    })

    it("calculates NSSF employer correctly (10% of gross salary)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
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

  describe("PAYE Calculations - Band Boundaries", () => {
    it("calculates PAYE = 0 for chargeable income <= 235,000", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 235000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBe(0)
    })

    it("calculates PAYE correctly at 335,000 boundary (tax = 10,000)", () => {
      // At 335,000: tax = (335,000 - 235,000) * 0.10 = 10,000
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 335000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(10000, 2)
    })

    it("calculates PAYE correctly at 410,000 boundary (tax = 25,000)", () => {
      // At 410,000: tax = (410,000 - 335,000) * 0.20 + 10,000 = 15,000 + 10,000 = 25,000
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 410000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(25000, 2)
    })

    it("calculates PAYE correctly at 10,000,000 boundary", () => {
      // At 10,000,000: tax = (10,000,000 - 410,000) * 0.30 + 25,000
      //               = 9,590,000 * 0.30 + 25,000
      //               = 2,877,000 + 25,000 = 2,902,000
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 10000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      const expectedPaye = (10000000 - 410000) * 0.30 + 25000
      expect(paye?.amount).toBeCloseTo(expectedPaye, 2)
    })

    it("calculates PAYE correctly above 10,000,000 (adds 10% surcharge)", () => {
      // At 10,100,000: 
      // Base tax = (10,100,000 - 410,000) * 0.30 + 25,000 = 2,932,000
      // Surcharge = (10,100,000 - 10,000,000) * 0.10 = 10,000
      // Total = 2,932,000 + 10,000 = 2,942,000
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 10100000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      const baseTax = (10100000 - 410000) * 0.30 + 25000
      const surcharge = (10100000 - 10000000) * 0.10
      const expectedPaye = baseTax + surcharge
      expect(paye?.amount).toBeCloseTo(expectedPaye, 2)
    })

    it("calculates PAYE correctly in first band (235,000 < CI <= 335,000)", () => {
      // CI = 300,000: tax = (300,000 - 235,000) * 0.10 = 6,500
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 300000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(6500, 2)
    })

    it("calculates PAYE correctly in second band (335,000 < CI <= 410,000)", () => {
      // CI = 400,000: tax = (400,000 - 335,000) * 0.20 + 10,000 = 13,000 + 10,000 = 23,000
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 400000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(23000, 2)
    })

    it("calculates PAYE correctly in third band (410,000 < CI <= 10,000,000)", () => {
      // CI = 1,000,000: tax = (1,000,000 - 410,000) * 0.30 + 25,000 = 177,000 + 25,000 = 202,000
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 0,
        otherDeductions: 0,
      })

      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye).toBeDefined()
      expect(paye?.amount).toBeCloseTo(202000, 2)
    })
  })

  describe("Chargeable Income Calculation", () => {
    it("sets chargeable income = grossMonthly when LST = 0 (non-payment month)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01", // Non-payment month
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 0,
      })

      // Chargeable income should equal grossMonthly (NSSF is not deducted, LST = 0)
      expect(result.totals.taxableIncome).toBeCloseTo(600000, 2) // grossMonthly
      expect(result.totals.taxableIncome).toBe(result.totals.grossSalary)
    })

    it("sets chargeable income = grossMonthly - lstMonthly when LST applies (payment month)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 0,
      })

      const grossMonthly = 600000
      const lst = result.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      
      // Chargeable income should equal grossMonthly - lstMonthly (LST is tax-deductible)
      expect(result.totals.taxableIncome).toBeCloseTo(grossMonthly - lst, 2)
      
      // PAYE base should also reflect this
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
      expect(paye?.base).toBeCloseTo(grossMonthly - lst, 2)
    })
  })

  describe("Net Salary Calculation", () => {
    it("calculates netSalary = grossMonthly - NSSF employee - PAYE - otherDeductions", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
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
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 500000, // More than gross
      })

      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
      expect(result.totals.netSalary).toBe(0)
    })
  })

  describe("Structure Validation", () => {
    it("returns valid PayrollCalculationResult structure", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      // Verify structure
      expect(result).toHaveProperty("earnings")
      expect(result).toHaveProperty("statutoryDeductions")
      expect(result).toHaveProperty("otherDeductions")
      expect(result).toHaveProperty("employerContributions")
      expect(result).toHaveProperty("totals")

      // Verify earnings
      expect(result.earnings).toHaveProperty("basicSalary")
      expect(result.earnings).toHaveProperty("allowances")
      expect(result.earnings).toHaveProperty("grossSalary")

      // Verify totals
      expect(result.totals).toHaveProperty("grossSalary")
      expect(result.totals).toHaveProperty("totalStatutoryDeductions")
      expect(result.totals).toHaveProperty("totalOtherDeductions")
      expect(result.totals).toHaveProperty("taxableIncome")
      expect(result.totals).toHaveProperty("netSalary")
      expect(result.totals).toHaveProperty("totalEmployerContributions")
    })

    it("has no NaN or undefined values", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 50000,
      })

      // Check all numeric values
      expect(Number.isFinite(result.earnings.basicSalary)).toBe(true)
      expect(Number.isFinite(result.earnings.allowances)).toBe(true)
      expect(Number.isFinite(result.earnings.grossSalary)).toBe(true)
      expect(Number.isFinite(result.otherDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.grossSalary)).toBe(true)
      expect(Number.isFinite(result.totals.totalStatutoryDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.totalOtherDeductions)).toBe(true)
      expect(Number.isFinite(result.totals.taxableIncome)).toBe(true)
      expect(Number.isFinite(result.totals.netSalary)).toBe(true)
      expect(Number.isFinite(result.totals.totalEmployerContributions)).toBe(true)

      // Check arrays are defined
      expect(result.statutoryDeductions).toBeDefined()
      expect(Array.isArray(result.statutoryDeductions)).toBe(true)
      expect(result.employerContributions).toBeDefined()
      expect(Array.isArray(result.employerContributions)).toBe(true)

      // Check deduction amounts
      result.statutoryDeductions.forEach(d => {
        expect(Number.isFinite(d.amount)).toBe(true)
        expect(Number.isFinite(d.rate)).toBe(true)
        expect(Number.isFinite(d.base)).toBe(true)
      })

      // Check contribution amounts
      result.employerContributions.forEach(c => {
        expect(Number.isFinite(c.amount)).toBe(true)
        expect(Number.isFinite(c.rate)).toBe(true)
        expect(Number.isFinite(c.base)).toBe(true)
      })
    })

    it("includes NSSF_EMPLOYEE and PAYE in statutoryDeductions", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 0,
        otherDeductions: 0,
      })

      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")

      expect(nssfEmployee).toBeDefined()
      expect(paye).toBeDefined()
      expect(result.statutoryDeductions.length).toBe(2)
    })

    it("includes NSSF_EMPLOYER in employerContributions", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 500000,
        allowances: 0,
        otherDeductions: 0,
      })

      const nssfEmployer = result.employerContributions.find(c => c.code === "NSSF_EMPLOYER")

      expect(nssfEmployer).toBeDefined()
      expect(result.employerContributions.length).toBe(1)
    })

    it("rounds all amounts to 2 decimal places", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01",
        basicSalary: 333333.333,
        allowances: 111111.111,
        otherDeductions: 55555.555,
      })

      // Check that all amounts have at most 2 decimal places
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
    it("totals reconcile correctly (non-payment month, LST = 0)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-01-01", // Non-payment month
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 50000,
      })

      // grossSalary = basicSalary + allowances
      expect(result.totals.grossSalary).toBe(result.earnings.basicSalary + result.earnings.allowances)

      // totalStatutoryDeductions = sum of all statutory deductions
      const calculatedTotal = result.statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
      expect(result.totals.totalStatutoryDeductions).toBeCloseTo(calculatedTotal, 2)

      // totalEmployerContributions = sum of all employer contributions
      const calculatedEmployerTotal = result.employerContributions.reduce((sum, c) => sum + c.amount, 0)
      expect(result.totals.totalEmployerContributions).toBeCloseTo(calculatedEmployerTotal, 2)

      // taxableIncome = grossMonthly (LST = 0 in non-payment months)
      expect(result.totals.taxableIncome).toBeCloseTo(result.totals.grossSalary, 2)

      // netSalary = grossSalary - totalStatutoryDeductions - totalOtherDeductions
      const expectedNet = result.totals.grossSalary - result.totals.totalStatutoryDeductions - result.totals.totalOtherDeductions
      expect(result.totals.netSalary).toBeCloseTo(Math.max(0, expectedNet), 2)
    })

    it("totals reconcile correctly (payment month, LST applies)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 1000000,
        allowances: 200000,
        otherDeductions: 50000,
      })

      // grossSalary = basicSalary + allowances
      expect(result.totals.grossSalary).toBe(result.earnings.basicSalary + result.earnings.allowances)

      // totalStatutoryDeductions = sum of all statutory deductions (NSSF + LST + PAYE)
      const calculatedTotal = result.statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
      expect(result.totals.totalStatutoryDeductions).toBeCloseTo(calculatedTotal, 2)

      // taxableIncome = grossMonthly - lstMonthly (LST is tax-deductible)
      const lst = result.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      expect(result.totals.taxableIncome).toBeCloseTo(result.totals.grossSalary - lst, 2)

      // netSalary = grossSalary - totalStatutoryDeductions - totalOtherDeductions
      const expectedNet = result.totals.grossSalary - result.totals.totalStatutoryDeductions - result.totals.totalOtherDeductions
      expect(result.totals.netSalary).toBeCloseTo(Math.max(0, expectedNet), 2)
    })
  })

  describe("Local Service Tax (LST)", () => {
    describe("LST Schedule Mapping", () => {
      it("calculates annual LST = 0 for grossMonthly <= 100,000", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01", // Payment month
          basicSalary: 100000,
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBe(0) // Annual 0 / 4 = 0
      })

      it("calculates annual LST = 5,000 for grossMonthly = 200,000", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01", // Payment month
          basicSalary: 200000,
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBeCloseTo(5000 / 4, 2) // Annual 5,000 / 4 = 1,250
      })

      it("calculates annual LST = 30,000 for grossMonthly = 420,000", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01", // Payment month
          basicSalary: 420000,
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBeCloseTo(30000 / 4, 2) // Annual 30,000 / 4 = 7,500
      })

      it("calculates annual LST = 100,000 for grossMonthly > 1,000,000", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01", // Payment month
          basicSalary: 2000000,
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBeCloseTo(100000 / 4, 2) // Annual 100,000 / 4 = 25,000
      })
    })

    describe("LST Instalment Months", () => {
      it("calculates lstMonthly = annualLST / 4 for July (payment month)", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01",
          basicSalary: 420000, // Annual LST = 30,000
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBeCloseTo(30000 / 4, 2) // 7,500
      })

      it("calculates lstMonthly = annualLST / 4 for October (payment month)", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-10-01",
          basicSalary: 420000, // Annual LST = 30,000
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBeCloseTo(30000 / 4, 2) // 7,500
      })

      it("calculates lstMonthly = 0 for November (non-payment month)", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-11-01",
          basicSalary: 420000, // Annual LST = 30,000
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBe(0) // Not a payment month
      })

      it("calculates lstMonthly = 0 for January (non-payment month)", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-01-01",
          basicSalary: 420000, // Annual LST = 30,000
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.amount).toBe(0) // Not a payment month
      })
    })

    describe("LST Reduces PAYE Base", () => {
      it("PAYE in July is less than PAYE in November (LST reduces PAYE base)", () => {
        const grossMonthly = 500000 // PAYE will be non-zero

        const resultJuly = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01", // Payment month (LST applies)
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const resultNovember = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-11-01", // Non-payment month (LST = 0)
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        const payeJuly = resultJuly.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
        const payeNovember = resultNovember.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0

        // July PAYE should be less because LST reduces chargeable income
        expect(payeJuly).toBeLessThan(payeNovember)

        // Verify LST is present in July
        const lstJuly = resultJuly.statutoryDeductions.find(d => d.code === "LST")
        expect(lstJuly?.amount).toBeGreaterThan(0)

        // Verify LST is 0 in November
        const lstNovember = resultNovember.statutoryDeductions.find(d => d.code === "LST")
        expect(lstNovember?.amount).toBe(0)
      })

      it("chargeable income in July = grossMonthly - lstMonthly", () => {
        const grossMonthly = 500000
        const annualLst = 30000 // For grossMonthly = 500,000
        const lstMonthly = annualLst / 4 // 7,500

        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01",
          basicSalary: grossMonthly,
          allowances: 0,
          otherDeductions: 0,
        })

        // Chargeable income should be grossMonthly - lstMonthly
        const paye = result.statutoryDeductions.find(d => d.code === "PAYE")
        expect(paye?.base).toBeCloseTo(grossMonthly - lstMonthly, 2)
      })
    })

    describe("LST Structure", () => {
      it("includes LST in statutoryDeductions with correct properties", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01",
          basicSalary: 500000,
          allowances: 0,
          otherDeductions: 0,
        })

        const lst = result.statutoryDeductions.find(d => d.code === "LST")
        expect(lst).toBeDefined()
        expect(lst?.code).toBe("LST")
        expect(lst?.name).toBe("Local Service Tax")
        expect(lst?.rate).toBe(0) // LST uses banded amounts, not a rate
        expect(lst?.base).toBeCloseTo(500000, 2)
        expect(lst?.isTaxDeductible).toBe(true)
        expect(lst?.ledgerAccountCode).toBeNull()
      })

      it("orders statutoryDeductions as NSSF_EMPLOYEE, LST, PAYE", () => {
        const result = ugandaPayrollEngine.calculate({
          jurisdiction: "UG",
          effectiveDate: "2024-07-01",
          basicSalary: 500000,
          allowances: 0,
          otherDeductions: 0,
        })

        expect(result.statutoryDeductions.length).toBe(3)
        expect(result.statutoryDeductions[0].code).toBe("NSSF_EMPLOYEE")
        expect(result.statutoryDeductions[1].code).toBe("LST")
        expect(result.statutoryDeductions[2].code).toBe("PAYE")
      })
    })
  })

  describe("Net Salary with LST", () => {
    it("calculates netSalary = grossMonthly - NSSF - LST - PAYE - otherDeductions", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      const grossMonthly = 600000
      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const lst = result.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const expectedNet = grossMonthly - nssfEmployee - lst - paye - 50000

      expect(result.totals.netSalary).toBeCloseTo(expectedNet, 2)
      expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
    })

    it("totals.totalStatutoryDeductions includes NSSF + LST + PAYE", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 500000,
        allowances: 0,
        otherDeductions: 0,
      })

      const nssfEmployee = result.statutoryDeductions.find(d => d.code === "NSSF_EMPLOYEE")?.amount || 0
      const lst = result.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      const paye = result.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const expectedTotal = nssfEmployee + lst + paye

      expect(result.totals.totalStatutoryDeductions).toBeCloseTo(expectedTotal, 2)
    })
  })

  describe("Taxable Income with LST", () => {
    it("sets taxableIncome = grossMonthly - lstMonthly (LST is tax-deductible)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 500000,
        allowances: 0,
        otherDeductions: 0,
      })

      const grossMonthly = 500000
      const lst = result.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      const expectedTaxableIncome = grossMonthly - lst

      expect(result.totals.taxableIncome).toBeCloseTo(expectedTaxableIncome, 2)
    })

    it("sets taxableIncome = grossMonthly when LST = 0 (non-payment month)", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-11-01", // Non-payment month
        basicSalary: 500000,
        allowances: 0,
        otherDeductions: 0,
      })

      expect(result.totals.taxableIncome).toBeCloseTo(500000, 2)
      expect(result.totals.taxableIncome).toBe(result.totals.grossSalary)
    })
  })

  describe("Immediate Verification - July vs November", () => {
    it("July: LST > 0, PAYE lower, netSalary lower than November", () => {
      const grossMonthly = 500000
      
      const resultJuly = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: grossMonthly,
        allowances: 0,
        otherDeductions: 0,
      })

      const resultNovember = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-11-01", // Non-payment month
        basicSalary: grossMonthly,
        allowances: 0,
        otherDeductions: 0,
      })

      // LST checks
      const lstJuly = resultJuly.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      const lstNovember = resultNovember.statutoryDeductions.find(d => d.code === "LST")?.amount || 0
      expect(lstJuly).toBeGreaterThan(0)
      expect(lstNovember).toBe(0)

      // PAYE checks
      const payeJuly = resultJuly.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      const payeNovember = resultNovember.statutoryDeductions.find(d => d.code === "PAYE")?.amount || 0
      expect(payeJuly).toBeLessThan(payeNovember)

      // Net salary checks
      expect(resultJuly.totals.netSalary).toBeLessThan(resultNovember.totals.netSalary)

      // Verify the difference is due to LST
      const netDifference = resultNovember.totals.netSalary - resultJuly.totals.netSalary
      // Difference should be approximately LST amount (accounting for PAYE reduction)
      expect(netDifference).toBeGreaterThan(0)
    })
  })

  describe("Immediate Verification - LST Boundary Checks", () => {
    it("gross = 100,000 → LST = 0", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 100000,
        allowances: 0,
        otherDeductions: 0,
      })

      const lst = result.statutoryDeductions.find(d => d.code === "LST")
      expect(lst).toBeDefined()
      expect(lst?.amount).toBe(0)
    })

    it("gross = 100,000.01 → LST annual = 5,000; July monthly = 1,250", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 100000.01,
        allowances: 0,
        otherDeductions: 0,
      })

      const lst = result.statutoryDeductions.find(d => d.code === "LST")
      expect(lst).toBeDefined()
      expect(lst?.amount).toBeCloseTo(5000 / 4, 2) // Annual 5,000 / 4 = 1,250
      expect(lst?.amount).toBeCloseTo(1250, 2)
    })
  })

  describe("Immediate Verification - No NaN/Undefined", () => {
    it("has no NaN or undefined in statutoryDeductions amounts", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      result.statutoryDeductions.forEach(d => {
        expect(Number.isFinite(d.amount)).toBe(true)
        expect(d.amount).not.toBeNaN()
        expect(d.amount).not.toBeUndefined()
        expect(Number.isFinite(d.rate)).toBe(true)
        expect(Number.isFinite(d.base)).toBe(true)
      })
    })

    it("has no NaN or undefined in totals fields", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 500000,
        allowances: 100000,
        otherDeductions: 50000,
      })

      expect(Number.isFinite(result.totals.grossSalary)).toBe(true)
      expect(result.totals.grossSalary).not.toBeNaN()
      expect(result.totals.grossSalary).not.toBeUndefined()
      
      expect(Number.isFinite(result.totals.totalStatutoryDeductions)).toBe(true)
      expect(result.totals.totalStatutoryDeductions).not.toBeNaN()
      
      expect(Number.isFinite(result.totals.totalOtherDeductions)).toBe(true)
      expect(result.totals.totalOtherDeductions).not.toBeNaN()
      
      expect(Number.isFinite(result.totals.taxableIncome)).toBe(true)
      expect(result.totals.taxableIncome).not.toBeNaN()
      
      expect(Number.isFinite(result.totals.netSalary)).toBe(true)
      expect(result.totals.netSalary).not.toBeNaN()
      
      expect(Number.isFinite(result.totals.totalEmployerContributions)).toBe(true)
      expect(result.totals.totalEmployerContributions).not.toBeNaN()
    })

    it("rounds all amounts to 2 decimal places", () => {
      const result = ugandaPayrollEngine.calculate({
        jurisdiction: "UG",
        effectiveDate: "2024-07-01", // Payment month
        basicSalary: 333333.333,
        allowances: 111111.111,
        otherDeductions: 55555.555,
      })

      const checkDecimals = (value: number) => {
        const str = value.toString()
        const decimalPart = str.split('.')[1]
        return !decimalPart || decimalPart.length <= 2
      }

      // Check totals
      expect(checkDecimals(result.totals.grossSalary)).toBe(true)
      expect(checkDecimals(result.totals.totalStatutoryDeductions)).toBe(true)
      expect(checkDecimals(result.totals.totalOtherDeductions)).toBe(true)
      expect(checkDecimals(result.totals.taxableIncome)).toBe(true)
      expect(checkDecimals(result.totals.netSalary)).toBe(true)
      expect(checkDecimals(result.totals.totalEmployerContributions)).toBe(true)

      // Check statutory deductions
      result.statutoryDeductions.forEach(d => {
        expect(checkDecimals(d.amount)).toBe(true)
        expect(checkDecimals(d.base)).toBe(true)
      })

      // Check employer contributions
      result.employerContributions.forEach(c => {
        expect(checkDecimals(c.amount)).toBe(true)
        expect(checkDecimals(c.base)).toBe(true)
      })
    })
  })

  describe("Registry Integration", () => {
    it("resolves Uganda engine from registry", () => {
      const result = calculatePayroll(
        {
          jurisdiction: "UG",
          effectiveDate: "2024-01-01",
          basicSalary: 500000,
          allowances: 0,
          otherDeductions: 0,
        },
        "UG"
      )

      expect(result).toBeDefined()
      expect(result.statutoryDeductions.length).toBeGreaterThan(0)
      expect(result.employerContributions.length).toBeGreaterThan(0)
    })
  })
})
