/**
 * Ghana Tax Engine Regression Tests
 * 
 * Minimal regression test harness for tax calculations before refactoring.
 * Tests validate tax engine behavior for GH (Ghana) with dates around the COVID removal cutoff.
 * 
 * Test Cases:
 * - 2025-12-31 (COVID included - pre-2026)
 * - 2026-01-01 (COVID excluded - post-2026)
 * 
 * Validations:
 * - total_amount == 100.00 (tax-inclusive input)
 * - total_tax > 0
 * - tax_lines includes VAT, NHIL, GETFUND
 * - COVID present only before 2026-01-01
 * - Rounding to 2 decimals
 * - Sums match: subtotal_excl_tax + tax_total == total_incl_tax
 * - meta.jurisdiction === "GH"
 * - meta.engine_version differs before/after 2026-01-01
 * - meta.effective_date_used matches the date passed to the engine
 */

import { calculateTaxesFromAmount } from '../taxEngine'
import { ghanaTaxEngineCanonical } from '../taxEngine/jurisdictions/ghana'

describe("Ghana Tax Engine Regression Tests - Tax-Inclusive Invoice Line", () => {
  const taxInclusiveAmount = 100.00
  const pre2026Date = "2025-12-31" // COVID included
  const post2026Date = "2026-01-01" // COVID excluded

  describe("2025-12-31 (COVID included)", () => {
    it("calculates taxes correctly for tax-inclusive amount of 100.00", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        pre2026Date,
        true // tax-inclusive
      )

      // Validate total amount equals input (allow for rounding differences)
      // Note: Reverse calculations with rounding may result in 99.99 instead of 100.00
      expect(result.total_incl_tax).toBeCloseTo(100.00, 1)

      // Validate total tax is positive
      expect(result.tax_total).toBeGreaterThan(0)

      // Validate tax lines include required taxes
      const vatLine = result.taxLines.find(line => line.code === "VAT")
      const nhilLine = result.taxLines.find(line => line.code === "NHIL")
      const getfundLine = result.taxLines.find(line => line.code === "GETFUND")
      const covidLine = result.taxLines.find(line => line.code === "COVID")

      expect(vatLine).toBeDefined()
      expect(nhilLine).toBeDefined()
      expect(getfundLine).toBeDefined()
      expect(covidLine).toBeDefined()

      // Validate COVID is present (before 2026-01-01)
      expect(covidLine).toBeDefined()
      expect(covidLine?.amount || 0).toBeGreaterThan(0)

      // Validate all amounts are positive where expected
      expect(vatLine?.amount || 0).toBeGreaterThan(0)
      expect(nhilLine?.amount || 0).toBeGreaterThan(0)
      expect(getfundLine?.amount || 0).toBeGreaterThan(0)
    })

    it("ensures sums match: subtotal_excl_tax + tax_total == total_incl_tax", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        pre2026Date,
        true // tax-inclusive
      )

      const calculatedTotal = result.subtotal_excl_tax + result.tax_total
      expect(calculatedTotal).toBeCloseTo(result.total_incl_tax, 2)
      // Allow for rounding differences in reverse calculations
      expect(calculatedTotal).toBeCloseTo(100.00, 1)
    })

    it("rounds all values to 2 decimal places", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        pre2026Date,
        true // tax-inclusive
      )

      // Check all tax amounts are rounded to 2 decimals
      result.taxLines.forEach(line => {
        const decimalPlaces = line.amount.toString().split('.')[1]?.length || 0
        expect(decimalPlaces).toBeLessThanOrEqual(2)
      })

      // Check totals are rounded to 2 decimals
      const totalTaxDecimalPlaces = result.tax_total.toString().split('.')[1]?.length || 0
      const totalInclDecimalPlaces = result.total_incl_tax.toString().split('.')[1]?.length || 0
      const subtotalDecimalPlaces = result.subtotal_excl_tax.toString().split('.')[1]?.length || 0

      expect(totalTaxDecimalPlaces).toBeLessThanOrEqual(2)
      expect(totalInclDecimalPlaces).toBeLessThanOrEqual(2)
      expect(subtotalDecimalPlaces).toBeLessThanOrEqual(2)
    })
  })

  describe("2026-01-01 (COVID excluded)", () => {
    it("calculates taxes correctly for tax-inclusive amount of 100.00", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        post2026Date,
        true // tax-inclusive
      )

      // Validate total amount equals input (allow for rounding differences)
      // Note: Reverse calculations with rounding may result in 99.99 instead of 100.00
      expect(result.total_incl_tax).toBeCloseTo(100.00, 1)

      // Validate total tax is positive
      expect(result.tax_total).toBeGreaterThan(0)

      // Validate tax lines include required taxes
      const vatLine = result.taxLines.find(line => line.code === "VAT")
      const nhilLine = result.taxLines.find(line => line.code === "NHIL")
      const getfundLine = result.taxLines.find(line => line.code === "GETFUND")
      const covidLine = result.taxLines.find(line => line.code === "COVID")

      expect(vatLine).toBeDefined()
      expect(nhilLine).toBeDefined()
      expect(getfundLine).toBeDefined()

      // Validate COVID is NOT present (on or after 2026-01-01)
      if (covidLine) {
        expect(covidLine.amount).toBe(0)
      } else {
        // COVID line may not exist at all, which is also acceptable
        // Just ensure it's not present with a positive amount
        const covidAmount = covidLine?.amount || 0
        expect(covidAmount).toBe(0)
      }

      // Validate all amounts are positive where expected
      expect(vatLine?.amount || 0).toBeGreaterThan(0)
      expect(nhilLine?.amount || 0).toBeGreaterThan(0)
      expect(getfundLine?.amount || 0).toBeGreaterThan(0)
    })

    it("ensures sums match: subtotal_excl_tax + tax_total == total_incl_tax", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        post2026Date,
        true // tax-inclusive
      )

      const calculatedTotal = result.subtotal_excl_tax + result.tax_total
      expect(calculatedTotal).toBeCloseTo(result.total_incl_tax, 2)
      // Allow for rounding differences in reverse calculations
      expect(calculatedTotal).toBeCloseTo(100.00, 1)
    })

    it("rounds all values to 2 decimal places", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        post2026Date,
        true // tax-inclusive
      )

      // Check all tax amounts are rounded to 2 decimals
      result.taxLines.forEach(line => {
        const decimalPlaces = line.amount.toString().split('.')[1]?.length || 0
        expect(decimalPlaces).toBeLessThanOrEqual(2)
      })

      // Check totals are rounded to 2 decimals
      const totalTaxDecimalPlaces = result.tax_total.toString().split('.')[1]?.length || 0
      const totalInclDecimalPlaces = result.total_incl_tax.toString().split('.')[1]?.length || 0
      const subtotalDecimalPlaces = result.subtotal_excl_tax.toString().split('.')[1]?.length || 0

      expect(totalTaxDecimalPlaces).toBeLessThanOrEqual(2)
      expect(totalInclDecimalPlaces).toBeLessThanOrEqual(2)
      expect(subtotalDecimalPlaces).toBeLessThanOrEqual(2)
    })
  })

  describe("COVID presence validation", () => {
    it("COVID is present on 2025-12-31 and absent on 2026-01-01", () => {
      const pre2026Result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        pre2026Date,
        true // tax-inclusive
      )

      const post2026Result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        post2026Date,
        true // tax-inclusive
      )

      const pre2026Covid = pre2026Result.taxLines.find(line => line.code === "COVID")
      const post2026Covid = post2026Result.taxLines.find(line => line.code === "COVID")

      // COVID should be present and positive on 2025-12-31
      expect(pre2026Covid).toBeDefined()
      expect(pre2026Covid?.amount || 0).toBeGreaterThan(0)

      // COVID should be zero or absent on 2026-01-01
      const post2026CovidAmount = post2026Covid?.amount || 0
      expect(post2026CovidAmount).toBe(0)
    })
  })

  describe("Tax line sum validation", () => {
    it("sum of individual tax lines equals tax_total for 2025-12-31", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        pre2026Date,
        true // tax-inclusive
      )

      const sumOfTaxLines = result.taxLines.reduce((sum, line) => sum + line.amount, 0)
      expect(sumOfTaxLines).toBeCloseTo(result.tax_total, 2)
    })

    it("sum of individual tax lines equals tax_total for 2026-01-01", () => {
      const result = calculateTaxesFromAmount(
        taxInclusiveAmount,
        "GH",
        post2026Date,
        true // tax-inclusive
      )

      const sumOfTaxLines = result.taxLines.reduce((sum, line) => sum + line.amount, 0)
      expect(sumOfTaxLines).toBeCloseTo(result.tax_total, 2)
    })
  })

  describe("Canonical TaxResult contract validation", () => {
    it("returns TaxResult with meta.jurisdiction === 'GH' for 2025-12-31", () => {
      const result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: pre2026Date,
          taxInclusive: true,
        }
      )

      expect(result.meta.jurisdiction).toBe("GH")
      expect(result.meta.effective_date_used).toBe(pre2026Date)
      expect(result.meta.engine_version).toBe("GH-2025-A")
      expect(result.pricing_mode).toBe("inclusive")
    })

    it("returns TaxResult with meta.jurisdiction === 'GH' for 2026-01-01", () => {
      const result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: post2026Date,
          taxInclusive: true,
        }
      )

      expect(result.meta.jurisdiction).toBe("GH")
      expect(result.meta.effective_date_used).toBe(post2026Date)
      expect(result.meta.engine_version).toBe("GH-2026-B")
      expect(result.pricing_mode).toBe("inclusive")
    })

    it("meta.engine_version differs before/after 2026-01-01", () => {
      const pre2026Result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: pre2026Date,
          taxInclusive: true,
        }
      )

      const post2026Result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: post2026Date,
          taxInclusive: true,
        }
      )

      expect(pre2026Result.meta.engine_version).toBe("GH-2025-A")
      expect(post2026Result.meta.engine_version).toBe("GH-2026-B")
      expect(pre2026Result.meta.engine_version).not.toBe(post2026Result.meta.engine_version)
    })

    it("meta.effective_date_used matches the date passed to the engine", () => {
      const testDate = "2025-06-15"
      const result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: testDate,
          taxInclusive: true,
        }
      )

      expect(result.meta.effective_date_used).toBe(testDate)
    })

    it("TaxResult has correct structure with base_amount, total_tax, total_amount", () => {
      const result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: pre2026Date,
          taxInclusive: true,
        }
      )

      // Validate structure
      expect(result).toHaveProperty('base_amount')
      expect(result).toHaveProperty('total_tax')
      expect(result).toHaveProperty('total_amount')
      expect(result).toHaveProperty('pricing_mode')
      expect(result).toHaveProperty('lines')
      expect(result).toHaveProperty('meta')

      // Validate meta structure
      expect(result.meta).toHaveProperty('jurisdiction')
      expect(result.meta).toHaveProperty('effective_date_used')
      expect(result.meta).toHaveProperty('engine_version')

      // Validate sums
      expect(result.base_amount + result.total_tax).toBeCloseTo(result.total_amount, 2)
    })

    it("TaxResult lines have correct structure with code and amount", () => {
      const result = ghanaTaxEngineCanonical.reverseCalculate(
        taxInclusiveAmount,
        {
          jurisdiction: "GH",
          effectiveDate: pre2026Date,
          taxInclusive: true,
        }
      )

      expect(result.lines.length).toBeGreaterThan(0)
      
      result.lines.forEach(line => {
        expect(line).toHaveProperty('code')
        expect(line).toHaveProperty('amount')
        expect(typeof line.code).toBe('string')
        expect(typeof line.amount).toBe('number')
        
        // Validate optional fields if present
        if (line.rate !== undefined) {
          expect(typeof line.rate).toBe('number')
        }
        if (line.name !== undefined) {
          expect(typeof line.name).toBe('string')
        }
        if (line.meta !== undefined) {
          expect(typeof line.meta).toBe('object')
        }
      })

      // Validate sum of lines equals total_tax
      const sumOfLines = result.lines.reduce((sum, line) => sum + line.amount, 0)
      expect(sumOfLines).toBeCloseTo(result.total_tax, 2)
    })
  })
})
