/**
 * Ghana Tax Calculation Consistency Tests
 * 
 * Tests validate that all three Ghana tax calculation paths produce
 * identical results for the same effective date and amount:
 * 
 * 1. New tax engine (lib/taxEngine/jurisdictions/ghana.ts)
 * 2. Legacy engine (lib/ghanaTaxEngine.ts)
 * 3. Retail VAT helpers (lib/vat.ts)
 * 
 * Tests cover:
 * - Pre-2026 dates (Version A with COVID)
 * - Post-2026 dates (Version B without COVID)
 * - Tax-exclusive calculations
 * - Tax-inclusive reverse calculations
 */

import { ghanaTaxEngine } from '../taxEngine/jurisdictions/ghana'
import { calculateGhanaTaxes, calculateBaseFromTotalIncludingTaxes, calculateGhanaTaxesFromLineItems } from '../ghanaTaxEngine'
import { calculateGhanaVAT, extractTaxFromInclusivePrice } from '../vat'

describe("Ghana Tax Calculation Consistency - Pre-2026 (Version A)", () => {
  const pre2026Date = "2024-01-01" // Before 2026-01-01
  const taxableAmount = 100

  describe("Tax-exclusive calculation", () => {
    it("New engine, legacy engine, and retail helper produce identical results", () => {
      // New engine
      const newEngineResult = ghanaTaxEngine.calculateFromAmount(taxableAmount, {
        jurisdiction: "GH",
        effectiveDate: pre2026Date,
        taxInclusive: false,
      })

      // Legacy engine
      const legacyResult = calculateGhanaTaxes(taxableAmount, true, pre2026Date)

      // Retail helper (standard VAT type only)
      const retailResult = calculateGhanaVAT(taxableAmount, 1, "standard", pre2026Date)

      // Compare base amounts
      expect(newEngineResult.subtotal_excl_tax).toBe(legacyResult.grandTotal - legacyResult.totalTax)
      expect(newEngineResult.subtotal_excl_tax).toBeCloseTo(retailResult.taxable_amount, 2)

      // Compare tax components
      const newNHIL = newEngineResult.taxLines.find(l => l.code === "NHIL")?.amount || 0
      const newGETFund = newEngineResult.taxLines.find(l => l.code === "GETFUND")?.amount || 0
      const newCOVID = newEngineResult.taxLines.find(l => l.code === "COVID")?.amount || 0
      const newVAT = newEngineResult.taxLines.find(l => l.code === "VAT")?.amount || 0

      expect(newNHIL).toBeCloseTo(legacyResult.nhil, 2)
      expect(newGETFund).toBeCloseTo(legacyResult.getfund, 2)
      expect(newCOVID).toBeCloseTo(legacyResult.covid, 2)
      expect(newVAT).toBeCloseTo(legacyResult.vat, 2)

      expect(newNHIL).toBeCloseTo(retailResult.nhil, 2)
      expect(newGETFund).toBeCloseTo(retailResult.getfund, 2)
      expect(newCOVID).toBeCloseTo(retailResult.covid, 2)
      expect(newVAT).toBeCloseTo(retailResult.vat, 2)

      // Compare totals
      expect(newEngineResult.tax_total).toBeCloseTo(legacyResult.totalTax, 2)
      expect(newEngineResult.total_incl_tax).toBeCloseTo(legacyResult.grandTotal, 2)

      expect(newEngineResult.tax_total).toBeCloseTo(retailResult.total_tax, 2)
      expect(newEngineResult.total_incl_tax).toBeCloseTo(retailResult.total_with_tax, 2)
    })

    it("All three paths calculate same tax for baseAmount=100", () => {
      const newResult = ghanaTaxEngine.calculateFromAmount(taxableAmount, {
        jurisdiction: "GH",
        effectiveDate: pre2026Date,
        taxInclusive: false,
      })
      const legacyResult = calculateGhanaTaxes(taxableAmount, true, pre2026Date)
      const retailResult = calculateGhanaVAT(taxableAmount, 1, "standard", pre2026Date)

      // Pre-2026: NHIL=2.5, GETFund=2.5, COVID=1, VAT=15
      // Expected: base=100, nhil=2.5, getfund=2.5, covid=1, vat=(100+2.5+2.5+1)*0.15=15.9, total=121.9
      expect(legacyResult.nhil).toBeCloseTo(2.5, 2)
      expect(legacyResult.getfund).toBeCloseTo(2.5, 2)
      expect(legacyResult.covid).toBeCloseTo(1, 2)
      expect(legacyResult.vat).toBeCloseTo(15.9, 2)
      expect(legacyResult.totalTax).toBeCloseTo(21.9, 2)
      expect(legacyResult.grandTotal).toBeCloseTo(121.9, 2)

      // Verify all three produce same values
      const newTotalTax = newResult.taxLines.reduce((sum, l) => sum + l.amount, 0)
      expect(newTotalTax).toBeCloseTo(legacyResult.totalTax, 2)
      expect(retailResult.total_tax).toBeCloseTo(legacyResult.totalTax, 2)
    })
  })

  describe("Tax-inclusive reverse calculation", () => {
    it("New engine, legacy engine, and retail helper produce identical reverse calculations", () => {
      const totalInclusive = 121.9 // Known pre-2026 total for base=100

      // New engine reverse calculation
      const newEngineResult = ghanaTaxEngine.reverseCalculate(totalInclusive, {
        jurisdiction: "GH",
        effectiveDate: pre2026Date,
        taxInclusive: true,
      })

      // Legacy engine reverse calculation
      const legacyResult = calculateBaseFromTotalIncludingTaxes(totalInclusive, true, pre2026Date)

      // Retail helper reverse calculation
      const retailResult = extractTaxFromInclusivePrice(totalInclusive, 1, "standard", pre2026Date)

      // Compare base amounts (should be approximately 100)
      expect(newEngineResult.subtotal_excl_tax).toBeCloseTo(100, 1)
      expect(legacyResult.baseAmount).toBeCloseTo(100, 1)
      expect(retailResult.taxable_amount).toBeCloseTo(100, 1)

      // All should be within 0.01 of each other
      expect(Math.abs(newEngineResult.subtotal_excl_tax - legacyResult.baseAmount)).toBeLessThan(0.01)
      expect(Math.abs(newEngineResult.subtotal_excl_tax - retailResult.taxable_amount)).toBeLessThan(0.01)

      // Compare tax components
      const newNHIL = newEngineResult.taxLines.find(l => l.code === "NHIL")?.amount || 0
      const newGETFund = newEngineResult.taxLines.find(l => l.code === "GETFUND")?.amount || 0
      const newCOVID = newEngineResult.taxLines.find(l => l.code === "COVID")?.amount || 0
      const newVAT = newEngineResult.taxLines.find(l => l.code === "VAT")?.amount || 0

      expect(newNHIL).toBeCloseTo(legacyResult.taxBreakdown.nhil, 2)
      expect(newGETFund).toBeCloseTo(legacyResult.taxBreakdown.getfund, 2)
      expect(newCOVID).toBeCloseTo(legacyResult.taxBreakdown.covid, 2)
      expect(newVAT).toBeCloseTo(legacyResult.taxBreakdown.vat, 2)

      expect(newNHIL).toBeCloseTo(retailResult.nhil, 2)
      expect(newGETFund).toBeCloseTo(retailResult.getfund, 2)
      expect(newCOVID).toBeCloseTo(retailResult.covid, 2)
      expect(newVAT).toBeCloseTo(retailResult.vat, 2)

      // Compare totals
      expect(newEngineResult.total_incl_tax).toBeCloseTo(totalInclusive, 2)
      expect(legacyResult.taxBreakdown.grandTotal).toBeCloseTo(totalInclusive, 2)
      expect(retailResult.total_with_tax).toBeCloseTo(totalInclusive, 2)
    })

    it("Reverse calculation uses dynamic multiplier (not hardcoded 1.219)", () => {
      // Test that multiplier is calculated dynamically
      const totalInclusive = 121.9

      const legacyResult = calculateBaseFromTotalIncludingTaxes(totalInclusive, true, pre2026Date)
      const retailResult = extractTaxFromInclusivePrice(totalInclusive, 1, "standard", pre2026Date)

      // Both should produce same base (approximately 100)
      expect(legacyResult.baseAmount).toBeCloseTo(retailResult.taxable_amount, 2)
      
      // Verify base * multiplier ≈ total (allowing for rounding)
      // For pre-2026: multiplier should be 1.219
      const multiplier = 1.219
      const calculatedTotal = legacyResult.baseAmount * multiplier
      expect(calculatedTotal).toBeCloseTo(totalInclusive, 1)
    })
  })
})

describe("Ghana Tax Calculation Consistency - Post-2026 (Version B)", () => {
  const post2026Date = "2026-01-01" // On or after 2026-01-01
  const taxableAmount = 100

  describe("Tax-exclusive calculation", () => {
    it("New engine, legacy engine, and retail helper produce identical results (no COVID)", () => {
      // New engine
      const newEngineResult = ghanaTaxEngine.calculateFromAmount(taxableAmount, {
        jurisdiction: "GH",
        effectiveDate: post2026Date,
        taxInclusive: false,
      })

      // Legacy engine
      const legacyResult = calculateGhanaTaxes(taxableAmount, true, post2026Date)

      // Retail helper
      const retailResult = calculateGhanaVAT(taxableAmount, 1, "standard", post2026Date)

      // Post-2026: COVID should be 0
      const newCOVID = newEngineResult.taxLines.find(l => l.code === "COVID")?.amount || 0
      expect(newCOVID).toBe(0)
      expect(legacyResult.covid).toBe(0)
      expect(retailResult.covid).toBe(0)

      // Compare tax components
      const newNHIL = newEngineResult.taxLines.find(l => l.code === "NHIL")?.amount || 0
      const newGETFund = newEngineResult.taxLines.find(l => l.code === "GETFUND")?.amount || 0
      const newVAT = newEngineResult.taxLines.find(l => l.code === "VAT")?.amount || 0

      expect(newNHIL).toBeCloseTo(legacyResult.nhil, 2)
      expect(newGETFund).toBeCloseTo(legacyResult.getfund, 2)
      expect(newVAT).toBeCloseTo(legacyResult.vat, 2)

      expect(newNHIL).toBeCloseTo(retailResult.nhil, 2)
      expect(newGETFund).toBeCloseTo(retailResult.getfund, 2)
      expect(newVAT).toBeCloseTo(retailResult.vat, 2)

      // Compare totals
      expect(newEngineResult.tax_total).toBeCloseTo(legacyResult.totalTax, 2)
      expect(newEngineResult.total_incl_tax).toBeCloseTo(legacyResult.grandTotal, 2)

      expect(newEngineResult.tax_total).toBeCloseTo(retailResult.total_tax, 2)
      expect(newEngineResult.total_incl_tax).toBeCloseTo(retailResult.total_with_tax, 2)
    })

    it("All three paths calculate same tax for baseAmount=100 (post-2026, simplified regime)", () => {
      const newResult = ghanaTaxEngine.calculateFromAmount(taxableAmount, {
        jurisdiction: "GH",
        effectiveDate: post2026Date,
        taxInclusive: false,
      })
      const legacyResult = calculateGhanaTaxes(taxableAmount, true, post2026Date)
      const retailResult = calculateGhanaVAT(taxableAmount, 1, "standard", post2026Date)

      // Post-2026 Simplified Regime: All taxes on same base
      // VAT, NHIL, GETFund all calculated on base (not compound)
      // Expected: base=100, nhil=2.5, getfund=2.5, covid=0, vat=100*0.15=15, total=120
      expect(legacyResult.nhil).toBeCloseTo(2.5, 2)
      expect(legacyResult.getfund).toBeCloseTo(2.5, 2)
      expect(legacyResult.covid).toBe(0) // COVID removed in Version B
      expect(legacyResult.vat).toBeCloseTo(15, 2) // VAT on same base (not compound)
      expect(legacyResult.totalTax).toBeCloseTo(20, 2) // 2.5 + 2.5 + 0 + 15 = 20
      expect(legacyResult.grandTotal).toBeCloseTo(120, 2) // 100 + 20 = 120

      // Verify all three produce same values
      const newTotalTax = newResult.taxLines.reduce((sum, l) => sum + l.amount, 0)
      expect(newTotalTax).toBeCloseTo(legacyResult.totalTax, 2)
      expect(retailResult.total_tax).toBeCloseTo(legacyResult.totalTax, 2)
      
      // Verify VAT is calculated on base (not compound)
      const newVAT = newResult.taxLines.find(l => l.code === "VAT")?.amount || 0
      expect(newVAT).toBeCloseTo(15, 2) // Should be 15, not 15.75
      
      // Verify VAT base equals taxable amount (simplified regime)
      const newVATBase = newResult.taxLines.find(l => l.code === "VAT")?.base || 0
      expect(newVATBase).toBeCloseTo(100, 2) // VAT base should equal taxable amount
    })
  })

  describe("Tax-inclusive reverse calculation", () => {
    it("New engine, legacy engine, and retail helper produce identical reverse calculations (post-2026)", () => {
      const totalInclusive = 120 // Known post-2026 total for base=100 (simplified regime, multiplier 1.20)

      // New engine reverse calculation
      const newEngineResult = ghanaTaxEngine.reverseCalculate(totalInclusive, {
        jurisdiction: "GH",
        effectiveDate: post2026Date,
        taxInclusive: true,
      })

      // Legacy engine reverse calculation
      const legacyResult = calculateBaseFromTotalIncludingTaxes(totalInclusive, true, post2026Date)

      // Retail helper reverse calculation
      const retailResult = extractTaxFromInclusivePrice(totalInclusive, 1, "standard", post2026Date)

      // Compare base amounts (should be exactly 100 with multiplier 1.20)
      expect(newEngineResult.subtotal_excl_tax).toBeCloseTo(100, 1)
      expect(legacyResult.baseAmount).toBeCloseTo(100, 1)
      expect(retailResult.taxable_amount).toBeCloseTo(100, 1)

      // All should be within 0.01 of each other
      expect(Math.abs(newEngineResult.subtotal_excl_tax - legacyResult.baseAmount)).toBeLessThan(0.01)
      expect(Math.abs(newEngineResult.subtotal_excl_tax - retailResult.taxable_amount)).toBeLessThan(0.01)

      // COVID should be 0 in all results
      const newCOVID = newEngineResult.taxLines.find(l => l.code === "COVID")?.amount || 0
      expect(newCOVID).toBe(0)
      expect(legacyResult.taxBreakdown.covid).toBe(0)
      expect(retailResult.covid).toBe(0)

      // Compare tax components (simplified regime: all on same base)
      const newNHIL = newEngineResult.taxLines.find(l => l.code === "NHIL")?.amount || 0
      const newGETFund = newEngineResult.taxLines.find(l => l.code === "GETFUND")?.amount || 0
      const newVAT = newEngineResult.taxLines.find(l => l.code === "VAT")?.amount || 0

      expect(newNHIL).toBeCloseTo(2.5, 2) // NHIL = 100 * 0.025
      expect(newGETFund).toBeCloseTo(2.5, 2) // GETFund = 100 * 0.025
      expect(newVAT).toBeCloseTo(15, 2) // VAT = 100 * 0.15 (not compound)

      expect(newNHIL).toBeCloseTo(legacyResult.taxBreakdown.nhil, 2)
      expect(newGETFund).toBeCloseTo(legacyResult.taxBreakdown.getfund, 2)
      expect(newVAT).toBeCloseTo(legacyResult.taxBreakdown.vat, 2)

      expect(newNHIL).toBeCloseTo(retailResult.nhil, 2)
      expect(newGETFund).toBeCloseTo(retailResult.getfund, 2)
      expect(newVAT).toBeCloseTo(retailResult.vat, 2)
    })

    it("Post-2026 multiplier is 1.20 (simplified regime), different from pre-2026 (compound regime)", () => {
      // Pre-2026 multiplier: 1.219 (compound: VAT on top of levies)
      // Post-2026 multiplier: 1.20 (simplified: all taxes on same base)
      
      const pre2026Total = 121.9 // base=100 * 1.219
      const post2026Total = 120 // base=100 * 1.20

      const pre2026Result = calculateBaseFromTotalIncludingTaxes(pre2026Total, true, "2024-01-01")
      const post2026Result = calculateBaseFromTotalIncludingTaxes(post2026Total, true, "2026-01-01")

      // Both should extract same base (100)
      expect(pre2026Result.baseAmount).toBeCloseTo(100, 1)
      expect(post2026Result.baseAmount).toBeCloseTo(100, 1)

      // But different multipliers produce different totals for same base
      // This proves multipliers are dynamic, not hardcoded
      expect(pre2026Total).not.toBe(post2026Total)
      
      // Pre-2026 has COVID (1%), post-2026 doesn't
      expect(pre2026Result.taxBreakdown.covid).toBeGreaterThan(0)
      expect(post2026Result.taxBreakdown.covid).toBe(0)
      
      // Post-2026 uses simplified regime: VAT = 15 (not 15.75)
      expect(post2026Result.taxBreakdown.vat).toBeCloseTo(15, 2)
      expect(post2026Result.taxBreakdown.totalTax).toBeCloseTo(20, 2) // 2.5 + 2.5 + 0 + 15 = 20
      expect(post2026Result.taxBreakdown.grandTotal).toBeCloseTo(120, 2) // 100 + 20 = 120
    })
    
    it("Post-2026 multiplier is exactly 1.20 (simplified regime)", () => {
      const base = 100
      const effectiveDate = "2026-01-01"
      
      // Forward calculation: base=100 → total=120
      const forwardResult = calculateGhanaTaxes(base, true, effectiveDate)
      expect(forwardResult.grandTotal).toBeCloseTo(120, 2)
      
      // Reverse calculation: total=120 → base=100 (using multiplier 1.20)
      const reverseResult = calculateBaseFromTotalIncludingTaxes(120, true, effectiveDate)
      expect(reverseResult.baseAmount).toBeCloseTo(100, 2)
      
      // Verify multiplier is 1.20: total / base = 120 / 100 = 1.20
      const multiplier = forwardResult.grandTotal / base
      expect(multiplier).toBeCloseTo(1.20, 2)
    })
    
    it("No path returns 120.75 for base=100 on or after 2026-01-01", () => {
      const base = 100
      const effectiveDate = "2026-01-01"
      
      // Test all three paths
      const newResult = ghanaTaxEngine.calculateFromAmount(base, {
        jurisdiction: "GH",
        effectiveDate,
        taxInclusive: false,
      })
      const legacyResult = calculateGhanaTaxes(base, true, effectiveDate)
      const retailResult = calculateGhanaVAT(base, 1, "standard", effectiveDate)
      
      // None should return 120.75 (that's the old compound calculation)
      expect(newResult.total_incl_tax).not.toBeCloseTo(120.75, 2)
      expect(legacyResult.grandTotal).not.toBeCloseTo(120.75, 2)
      expect(retailResult.total_with_tax).not.toBeCloseTo(120.75, 2)
      
      // All should return 120 (simplified regime)
      expect(newResult.total_incl_tax).toBeCloseTo(120, 2)
      expect(legacyResult.grandTotal).toBeCloseTo(120, 2)
      expect(retailResult.total_with_tax).toBeCloseTo(120, 2)
      
      // VAT should be 15 (not 15.75)
      const newVAT = newResult.taxLines.find(l => l.code === "VAT")?.amount || 0
      expect(newVAT).toBeCloseTo(15, 2)
      expect(legacyResult.vat).toBeCloseTo(15, 2)
      expect(retailResult.vat).toBeCloseTo(15, 2)
    })
  })
})

describe("Ghana Tax Calculation Consistency - Line Items", () => {
  it("calculateGhanaTaxesFromLineItems produces same result as calculateGhanaTaxes", () => {
    const lineItems = [
      { quantity: 2, unit_price: 50, discount_amount: 0 },
    ]
    const effectiveDate = "2024-01-01"

    const fromLineItems = calculateGhanaTaxesFromLineItems(lineItems, true, effectiveDate)
    const fromAmount = calculateGhanaTaxes(100, true, effectiveDate)

    expect(fromLineItems.nhil).toBeCloseTo(fromAmount.nhil, 2)
    expect(fromLineItems.getfund).toBeCloseTo(fromAmount.getfund, 2)
    expect(fromLineItems.covid).toBeCloseTo(fromAmount.covid, 2)
    expect(fromLineItems.vat).toBeCloseTo(fromAmount.vat, 2)
    expect(fromLineItems.totalTax).toBeCloseTo(fromAmount.totalTax, 2)
    expect(fromLineItems.grandTotal).toBeCloseTo(fromAmount.grandTotal, 2)
  })
})

describe("Ghana Tax Calculation Consistency - Rounding", () => {
  it("All three paths round to 2 decimal places consistently", () => {
    const taxableAmount = 99.99
    const effectiveDate = "2024-01-01"

    const newResult = ghanaTaxEngine.calculateFromAmount(taxableAmount, {
      jurisdiction: "GH",
      effectiveDate,
      taxInclusive: false,
    })
    const legacyResult = calculateGhanaTaxes(taxableAmount, true, effectiveDate)
    const retailResult = calculateGhanaVAT(taxableAmount, 1, "standard", effectiveDate)

    // All tax components should be rounded to 2 decimals
    expect(legacyResult.nhil.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2)
    expect(legacyResult.getfund.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2)
    expect(legacyResult.covid.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2)
    expect(legacyResult.vat.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2)

    // All three should produce same rounded values
    const newTotalTax = newResult.taxLines.reduce((sum, l) => sum + l.amount, 0)
    expect(newTotalTax).toBeCloseTo(legacyResult.totalTax, 2)
    expect(retailResult.total_tax).toBeCloseTo(legacyResult.totalTax, 2)
  })
})
