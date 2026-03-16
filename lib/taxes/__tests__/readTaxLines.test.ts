/**
 * Unit Tests for readTaxLines Helper
 * 
 * Tests verify that the canonical helper correctly reads tax information
 * from tax_lines JSONB format.
 */

import {
  getTaxBreakdown,
  getTaxAmount,
  sumTaxLines,
  getGhanaLegacyView,
} from '../readTaxLines'

describe('readTaxLines - Canonical Helper', () => {
  describe('getTaxBreakdown', () => {
    it('returns empty object for null/undefined tax_lines', () => {
      expect(getTaxBreakdown(null)).toEqual({})
      expect(getTaxBreakdown(undefined)).toEqual({})
    })

    it('extracts tax breakdown from canonical format', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
          { code: 'COVID', amount: 1.00 },
        ],
        meta: {
          jurisdiction: 'GH',
          effective_date_used: '2025-12-31',
          engine_version: 'GH-2025-A',
        },
        pricing_mode: 'inclusive',
      }

      const breakdown = getTaxBreakdown(tax_lines)

      expect(breakdown).toEqual({
        VAT: 15.90,
        NHIL: 2.50,
        GETFUND: 2.50,
        COVID: 1.00,
      })
    })

    it('handles empty lines array', () => {
      const tax_lines = {
        lines: [],
        meta: {},
        pricing_mode: 'inclusive',
      }

      const breakdown = getTaxBreakdown(tax_lines)

      expect(breakdown).toEqual({})
    })

    it('handles legacy direct array format (backward compatibility)', () => {
      const tax_lines = [
        { code: 'VAT', amount: 15.90 },
        { code: 'NHIL', amount: 2.50 },
      ]

      const breakdown = getTaxBreakdown(tax_lines)

      expect(breakdown).toEqual({
        VAT: 15.90,
        NHIL: 2.50,
      })
    })

    it('handles legacy nested tax_lines key format (backward compatibility)', () => {
      const tax_lines = {
        tax_lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
        ],
      }

      const breakdown = getTaxBreakdown(tax_lines)

      expect(breakdown).toEqual({
        VAT: 15.90,
        NHIL: 2.50,
      })
    })

    it('skips invalid lines (missing code or amount)', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { amount: 2.50 }, // missing code
          { code: 'NHIL' }, // missing amount
          { code: 'GETFUND', amount: 'invalid' }, // invalid amount
          null,
          undefined,
        ],
      }

      const breakdown = getTaxBreakdown(tax_lines)

      expect(breakdown).toEqual({
        VAT: 15.90,
      })
    })
  })

  describe('getTaxAmount', () => {
    it('returns 0 for null/undefined tax_lines', () => {
      expect(getTaxAmount(null, 'VAT')).toBe(0)
      expect(getTaxAmount(undefined, 'VAT')).toBe(0)
    })

    it('returns 0 for empty code', () => {
      const tax_lines = {
        lines: [{ code: 'VAT', amount: 15.90 }],
      }

      expect(getTaxAmount(tax_lines, '')).toBe(0)
    })

    it('returns correct amount for existing tax code', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
        ],
      }

      expect(getTaxAmount(tax_lines, 'VAT')).toBe(15.90)
      expect(getTaxAmount(tax_lines, 'NHIL')).toBe(2.50)
    })

    it('returns 0 for non-existent tax code', () => {
      const tax_lines = {
        lines: [{ code: 'VAT', amount: 15.90 }],
      }

      expect(getTaxAmount(tax_lines, 'NONEXISTENT')).toBe(0)
    })
  })

  describe('sumTaxLines', () => {
    it('returns 0 for null/undefined tax_lines', () => {
      expect(sumTaxLines(null)).toBe(0)
      expect(sumTaxLines(undefined)).toBe(0)
    })

    it('sums all tax amounts correctly', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
          { code: 'COVID', amount: 1.00 },
        ],
      }

      const sum = sumTaxLines(tax_lines)

      expect(sum).toBe(21.90) // 15.90 + 2.50 + 2.50 + 1.00
    })

    it('returns 0 for empty lines', () => {
      const tax_lines = {
        lines: [],
      }

      expect(sumTaxLines(tax_lines)).toBe(0)
    })

    it('handles decimal precision correctly', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.999 },
          { code: 'NHIL', amount: 2.501 },
        ],
      }

      const sum = sumTaxLines(tax_lines)

      expect(sum).toBeCloseTo(18.50, 2)
    })
  })

  describe('getGhanaLegacyView', () => {
    it('returns zeros for null/undefined tax_lines', () => {
      expect(getGhanaLegacyView(null)).toEqual({
        vat: 0,
        nhil: 0,
        getfund: 0,
        covid: 0,
      })
      expect(getGhanaLegacyView(undefined)).toEqual({
        vat: 0,
        nhil: 0,
        getfund: 0,
        covid: 0,
      })
    })

    it('extracts legacy columns from canonical format', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
          { code: 'COVID', amount: 1.00 },
        ],
      }

      const legacy = getGhanaLegacyView(tax_lines)

      expect(legacy).toEqual({
        vat: 15.90,
        nhil: 2.50,
        getfund: 2.50,
        covid: 1.00,
      })
    })

    it('handles case variations in tax codes', () => {
      const tax_lines = {
        lines: [
          { code: 'vat', amount: 15.90 },
          { code: 'nhil', amount: 2.50 },
          { code: 'GETFund', amount: 2.50 },
          { code: 'Covid', amount: 1.00 },
        ],
      }

      const legacy = getGhanaLegacyView(tax_lines)

      expect(legacy).toEqual({
        vat: 15.90,
        nhil: 2.50,
        getfund: 2.50,
        covid: 1.00,
      })
    })

    it('pre-2026 tax_lines returns covid > 0', () => {
      // Pre-2026 invoice includes COVID tax
      const pre2026TaxLines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
          { code: 'COVID', amount: 1.00 },
        ],
        meta: {
          jurisdiction: 'GH',
          effective_date_used: '2025-12-31', // Pre-2026 date
          engine_version: 'GH-2025-A',
        },
        pricing_mode: 'inclusive',
      }

      const legacy = getGhanaLegacyView(pre2026TaxLines)

      expect(legacy.covid).toBeGreaterThan(0)
      expect(legacy.covid).toBe(1.00)
    })

    it('post-2026 tax_lines returns covid = 0', () => {
      // Post-2026 invoice excludes COVID tax
      const post2026TaxLines = {
        lines: [
          { code: 'VAT', amount: 15.00 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
          // No COVID line
        ],
        meta: {
          jurisdiction: 'GH',
          effective_date_used: '2026-01-01', // Post-2026 date
          engine_version: 'GH-2026-B',
        },
        pricing_mode: 'inclusive',
      }

      const legacy = getGhanaLegacyView(post2026TaxLines)

      expect(legacy.covid).toBe(0)
    })

    it('sumTaxLines equals total_tax for pre-2026 invoice', () => {
      const pre2026TaxLines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
          { code: 'COVID', amount: 1.00 },
        ],
        meta: {
          effective_date_used: '2025-12-31',
        },
      }

      const sum = sumTaxLines(pre2026TaxLines)
      const totalTax = 21.90 // 15.90 + 2.50 + 2.50 + 1.00

      expect(sum).toBe(totalTax)
    })

    it('sumTaxLines equals total_tax for post-2026 invoice', () => {
      const post2026TaxLines = {
        lines: [
          { code: 'VAT', amount: 15.00 },
          { code: 'NHIL', amount: 2.50 },
          { code: 'GETFUND', amount: 2.50 },
        ],
        meta: {
          effective_date_used: '2026-01-01',
        },
      }

      const sum = sumTaxLines(post2026TaxLines)
      const totalTax = 20.00 // 15.00 + 2.50 + 2.50 (no COVID)

      expect(sum).toBe(totalTax)
    })

    it('handles missing tax codes gracefully', () => {
      const tax_lines = {
        lines: [
          { code: 'VAT', amount: 15.90 },
          // Missing NHIL, GETFUND, COVID
        ],
      }

      const legacy = getGhanaLegacyView(tax_lines)

      expect(legacy).toEqual({
        vat: 15.90,
        nhil: 0,
        getfund: 0,
        covid: 0,
      })
    })
  })

  describe('Integration: sumTaxLines equals total_tax', () => {
    it('sumTaxLines matches total_tax for realistic pre-2026 invoice', () => {
      const pre2026TaxLines = {
        lines: [
          { code: 'NHIL', amount: 2.50, rate: 0.025, name: 'NHIL' },
          { code: 'GETFUND', amount: 2.50, rate: 0.025, name: 'GETFund' },
          { code: 'COVID', amount: 1.00, rate: 0.01, name: 'COVID Levy' },
          { code: 'VAT', amount: 15.90, rate: 0.15, name: 'VAT' },
        ],
        meta: {
          jurisdiction: 'GH',
          effective_date_used: '2025-12-31',
          engine_version: 'GH-2025-A',
        },
        pricing_mode: 'inclusive',
      }

      const sum = sumTaxLines(pre2026TaxLines)
      const totalTax = 21.90 // Should match invoices.total_tax

      expect(sum).toBeCloseTo(totalTax, 2)
    })

    it('sumTaxLines matches total_tax for realistic post-2026 invoice', () => {
      const post2026TaxLines = {
        lines: [
          { code: 'NHIL', amount: 2.50, rate: 0.025, name: 'NHIL' },
          { code: 'GETFUND', amount: 2.50, rate: 0.025, name: 'GETFund' },
          { code: 'VAT', amount: 15.00, rate: 0.15, name: 'VAT' },
          // No COVID line
        ],
        meta: {
          jurisdiction: 'GH',
          effective_date_used: '2026-01-01',
          engine_version: 'GH-2026-B',
        },
        pricing_mode: 'inclusive',
      }

      const sum = sumTaxLines(post2026TaxLines)
      const totalTax = 20.00 // Should match invoices.total_tax

      expect(sum).toBeCloseTo(totalTax, 2)
    })
  })
})
