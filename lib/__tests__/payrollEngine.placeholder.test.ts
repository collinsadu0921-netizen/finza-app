/**
 * Unit tests for placeholder payroll country plugins
 * 
 * Tests validate:
 * - Registry resolves engines for all placeholder countries
 * - Placeholder calculations return valid structure
 * - netSalary = grossSalary - otherDeductions (never negative)
 * - No NaN or undefined values
 * - Works for arbitrary payroll_month dates
 */

import { calculatePayroll, hasPayrollEngine } from "../payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "../payrollEngine/errors"

describe("Payroll Engine - Placeholder Countries", () => {
  // Note: Nigeria (NG), Uganda (UG), Tanzania (TZ), Rwanda (RW), and Zambia (ZM) are now fully implemented and have their own test files
  const placeholderCountries: Array<{ code: string; name: string }> = []

  describe("Registry Resolution", () => {
    placeholderCountries.forEach(({ code, name }) => {
      it(`resolves ${name} (${code}) engine from registry`, () => {
        expect(hasPayrollEngine(code)).toBe(true)
        expect(hasPayrollEngine(name)).toBe(true)
      })

      it(`calculates payroll for ${name} (${code}) without throwing`, () => {
        expect(() => {
          const result = calculatePayroll(
            {
              jurisdiction: code,
              effectiveDate: "2024-01-01",
              basicSalary: 10000,
              allowances: 2000,
              otherDeductions: 500,
            },
            code
          )
          expect(result).toBeDefined()
        }).not.toThrow()
      })
    })
  })

  describe("Placeholder Calculation Logic", () => {
    placeholderCountries.forEach(({ code, name }) => {
      it(`returns valid structure for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-06-01",
            basicSalary: 50000,
            allowances: 10000,
            otherDeductions: 2000,
          },
          code
        )

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

      it(`calculates grossSalary correctly for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 30000,
            allowances: 5000,
            otherDeductions: 0,
          },
          code
        )

        expect(result.earnings.basicSalary).toBe(30000)
        expect(result.earnings.allowances).toBe(5000)
        expect(result.earnings.grossSalary).toBe(35000)
        expect(result.totals.grossSalary).toBe(35000)
      })

      it(`calculates netSalary = grossSalary - otherDeductions for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 40000,
            allowances: 5000,
            otherDeductions: 3000,
          },
          code
        )

        const expectedNet = 45000 - 3000 // grossSalary - otherDeductions
        expect(result.totals.netSalary).toBe(expectedNet)
        expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
      })

      it(`ensures netSalary never goes negative for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 1000,
            allowances: 0,
            otherDeductions: 5000, // More than gross
          },
          code
        )

        expect(result.totals.netSalary).toBe(0) // Should be capped at 0
        expect(result.totals.netSalary).toBeGreaterThanOrEqual(0)
      })

      it(`returns empty statutory deductions for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 20000,
            allowances: 0,
            otherDeductions: 0,
          },
          code
        )

        expect(result.statutoryDeductions).toEqual([])
        expect(result.totals.totalStatutoryDeductions).toBe(0)
      })

      it(`returns empty employer contributions for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 20000,
            allowances: 0,
            otherDeductions: 0,
          },
          code
        )

        expect(result.employerContributions).toEqual([])
        expect(result.totals.totalEmployerContributions).toBe(0)
      })

      it(`sets taxableIncome = grossSalary for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 25000,
            allowances: 5000,
            otherDeductions: 0,
          },
          code
        )

        expect(result.totals.taxableIncome).toBe(30000) // grossSalary
        expect(result.totals.taxableIncome).toBe(result.totals.grossSalary)
      })

      it(`has no NaN or undefined values for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-12-01",
            basicSalary: 15000,
            allowances: 3000,
            otherDeductions: 1000,
          },
          code
        )

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
        expect(result.employerContributions).toBeDefined()
      })

      it(`works with arbitrary payroll_month dates for ${name} (${code})`, () => {
        const dates = ["2020-01-01", "2024-06-15", "2025-12-31", "1970-01-01"]

        dates.forEach((date) => {
          const result = calculatePayroll(
            {
              jurisdiction: code,
              effectiveDate: date,
              basicSalary: 10000,
              allowances: 0,
              otherDeductions: 0,
            },
            code
          )

          expect(result).toBeDefined()
          expect(result.totals.netSalary).toBe(10000)
        })
      })

      it(`totals reconcile correctly for ${name} (${code})`, () => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 50000,
            allowances: 10000,
            otherDeductions: 5000,
          },
          code
        )

        // grossSalary = basicSalary + allowances
        expect(result.totals.grossSalary).toBe(result.earnings.basicSalary + result.earnings.allowances)

        // taxableIncome = grossSalary (no tax-deductible deductions)
        expect(result.totals.taxableIncome).toBe(result.totals.grossSalary)

        // netSalary = grossSalary - otherDeductions (no statutory deductions)
        expect(result.totals.netSalary).toBe(result.totals.grossSalary - result.totals.totalOtherDeductions)

        // totalStatutoryDeductions = 0 (placeholder)
        expect(result.totals.totalStatutoryDeductions).toBe(0)

        // totalEmployerContributions = 0 (placeholder)
        expect(result.totals.totalEmployerContributions).toBe(0)
      })
    })
  })

  describe("Error Handling", () => {
    it("does not throw errors for placeholder countries", () => {
      placeholderCountries.forEach(({ code }) => {
        expect(() => {
          calculatePayroll(
            {
              jurisdiction: code,
              effectiveDate: "2024-01-01",
              basicSalary: 0,
              allowances: 0,
              otherDeductions: 0,
            },
            code
          )
        }).not.toThrow()
      })
    })

    it("handles zero values correctly", () => {
      placeholderCountries.forEach(({ code }) => {
        const result = calculatePayroll(
          {
            jurisdiction: code,
            effectiveDate: "2024-01-01",
            basicSalary: 0,
            allowances: 0,
            otherDeductions: 0,
          },
          code
        )

        expect(result.totals.grossSalary).toBe(0)
        expect(result.totals.netSalary).toBe(0)
        expect(result.totals.taxableIncome).toBe(0)
      })
    })
  })
})
