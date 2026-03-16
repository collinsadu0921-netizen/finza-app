/**
 * Estimate Creation Route Tests
 * 
 * Tests verify that estimate creation:
 * 1. Pre-2026 estimate includes COVID in tax_lines
 * 2. Post-2026 estimate excludes COVID
 * 3. tax_lines persisted correctly
 * 4. legacy columns derived from tax_lines (no rate/cutoff/country logic)
 * 5. totals match TaxResult exactly
 * 
 * No ledger tests required.
 */

import { POST } from '../create/route'
import { NextRequest } from 'next/server'
import type { TaxResult } from '@/lib/taxEngine/types'

// Mock modules
jest.mock('@/lib/supabaseServer')
jest.mock('@/lib/payments/eligibility', () => ({
  normalizeCountry: jest.fn((country: string) => 'GH'),
}))

// Mock canonical tax engine with date-aware logic
jest.mock('@/lib/taxEngine/helpers', () => ({
  getTaxEngineCode: jest.fn(() => 'ghana'),
  deriveLegacyTaxColumnsFromTaxLines: jest.fn((lines) => ({
    nhil: lines.find((l: any) => l.code === 'NHIL')?.amount || 0,
    getfund: lines.find((l: any) => l.code === 'GETFUND')?.amount || 0,
    covid: lines.find((l: any) => l.code === 'COVID')?.amount || 0,
    vat: lines.find((l: any) => l.code === 'VAT')?.amount || 0,
  })),
  getCanonicalTaxResultFromLineItems: jest.fn((lineItems, config) => {
    // Mock pre-2026 result (includes COVID)
    if (config.effectiveDate < '2026-01-01') {
      return {
        base_amount: 100.00,
        total_tax: 21.90,
        total_amount: 121.90,
        pricing_mode: 'inclusive',
        lines: [
          { code: 'NHIL', amount: 2.50, rate: 0.025, name: 'NHIL' },
          { code: 'GETFUND', amount: 2.50, rate: 0.025, name: 'GETFund' },
          { code: 'COVID', amount: 1.00, rate: 0.01, name: 'COVID Levy' },
          { code: 'VAT', amount: 15.90, rate: 0.15, name: 'VAT' },
        ],
        meta: {
          jurisdiction: 'GH',
          effective_date_used: config.effectiveDate,
          engine_version: 'GH-2025-A',
        },
      }
    }
    // Mock post-2026 result (no COVID)
    return {
      base_amount: 100.00,
      total_tax: 20.00,
      total_amount: 120.00,
      pricing_mode: 'inclusive',
      lines: [
        { code: 'NHIL', amount: 2.50, rate: 0.025, name: 'NHIL' },
        { code: 'GETFUND', amount: 2.50, rate: 0.025, name: 'GETFund' },
        { code: 'VAT', amount: 15.00, rate: 0.15, name: 'VAT' },
      ],
      meta: {
        jurisdiction: 'GH',
        effective_date_used: config.effectiveDate,
        engine_version: 'GH-2026-B',
      },
    }
  }),
}))

jest.mock('@/lib/taxEngine/serialize', () => ({
  toTaxLinesJsonb: jest.fn((result: TaxResult) => ({
    lines: result.lines,
    meta: result.meta,
    pricing_mode: result.pricing_mode,
  })),
}))

describe('POST /api/estimates/create - Canonical Tax Engine', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup Supabase mock
    mockSupabase = {
      auth: {
        getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null })),
      },
      from: jest.fn((table: string) => {
        if (table === 'businesses') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: { id: 'test-business', address_country: 'GH' },
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'estimates') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'new-estimate-id',
                    subtotal: 100.00,
                    total_tax_amount: 21.90,
                    total_amount: 121.90,
                    tax_lines: {
                      lines: [],
                      meta: {},
                      pricing_mode: 'inclusive',
                    },
                  },
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'estimate_items') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          }
        }
        return {} as any
      }),
      rpc: jest.fn((fn: string) => {
        if (fn === 'generate_estimate_number') {
          return Promise.resolve({ data: 'EST-001', error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }

    // Mock createSupabaseServerClient
    require('@/lib/supabaseServer').createSupabaseServerClient = jest.fn(() => Promise.resolve(mockSupabase))
  })

  it('pre-2026 estimate includes COVID in tax_lines', async () => {
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: '2025-12-31', // Pre-2026 date
        items: [
          { qty: 1, unit_price: 121.90, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    expect(insertCall).toHaveBeenCalled()
    const estimateData = insertCall.mock.calls[0][0]

    // Verify COVID is included in tax_lines
    const covidLine = estimateData.tax_lines.lines.find((l: any) => l.code === 'COVID')
    expect(covidLine).toBeDefined()
    expect(covidLine.amount).toBe(1.00)

    // Verify engine version is pre-2026
    expect(estimateData.tax_lines.meta.engine_version).toBe('GH-2025-A')

    // Verify effective date is issue_date
    expect(estimateData.tax_engine_effective_from).toBe('2025-12-31')
    expect(estimateData.tax_lines.meta.effective_date_used).toBe('2025-12-31')
  })

  it('post-2026 estimate excludes COVID', async () => {
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: '2026-01-01', // Post-2026 date
        items: [
          { qty: 1, unit_price: 120.00, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    expect(insertCall).toHaveBeenCalled()
    const estimateData = insertCall.mock.calls[0][0]

    // Verify COVID is NOT in tax_lines
    const covidLine = estimateData.tax_lines.lines.find((l: any) => l.code === 'COVID')
    expect(covidLine).toBeUndefined()

    // Verify COVID legacy column is zero
    expect(estimateData.covid_amount).toBe(0)

    // Verify engine version is post-2026
    expect(estimateData.tax_lines.meta.engine_version).toBe('GH-2026-B')

    // Verify effective date is issue_date
    expect(estimateData.tax_engine_effective_from).toBe('2026-01-01')
    expect(estimateData.tax_lines.meta.effective_date_used).toBe('2026-01-01')
  })

  it('tax_lines persisted correctly', async () => {
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    const estimateData = insertCall.mock.calls[0][0]

    // Verify tax_lines is stored
    expect(estimateData.tax_lines).toBeDefined()
    expect(estimateData.tax_lines.lines).toBeDefined()
    expect(Array.isArray(estimateData.tax_lines.lines)).toBe(true)
    expect(estimateData.tax_lines.lines.length).toBe(4) // NHIL, GETFUND, COVID, VAT

    // Verify tax_lines structure
    expect(estimateData.tax_lines.meta.jurisdiction).toBe('GH')
    expect(estimateData.tax_lines.meta.effective_date_used).toBe('2025-12-31')
    expect(estimateData.tax_lines.meta.engine_version).toBe('GH-2025-A')
    expect(estimateData.tax_lines.pricing_mode).toBe('inclusive')

    // Verify tax_lines contains all tax codes
    const codes = estimateData.tax_lines.lines.map((l: any) => l.code)
    expect(codes).toContain('NHIL')
    expect(codes).toContain('GETFUND')
    expect(codes).toContain('COVID')
    expect(codes).toContain('VAT')
  })

  it('legacy columns derived from tax_lines', async () => {
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    const estimateData = insertCall.mock.calls[0][0]

    // Verify legacy columns match tax_lines (derived, not hardcoded)
    expect(estimateData.nhil_amount).toBe(2.50) // From tax_lines.lines
    expect(estimateData.getfund_amount).toBe(2.50) // From tax_lines.lines
    expect(estimateData.covid_amount).toBe(1.00) // From tax_lines.lines
    expect(estimateData.vat_amount).toBe(15.90) // From tax_lines.lines

    // Verify legacy columns are rounded to 2dp
    expect(estimateData.nhil_amount).toBeCloseTo(2.50, 2)
    expect(estimateData.getfund_amount).toBeCloseTo(2.50, 2)
    expect(estimateData.covid_amount).toBeCloseTo(1.00, 2)
    expect(estimateData.vat_amount).toBeCloseTo(15.90, 2)

    // Verify total_tax_amount matches sum of legacy columns
    const legacyTaxSum = estimateData.nhil_amount + estimateData.getfund_amount + 
                         estimateData.covid_amount + estimateData.vat_amount
    expect(legacyTaxSum).toBeCloseTo(estimateData.total_tax_amount, 2)
  })

  it('totals match TaxResult exactly', async () => {
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    const estimateData = insertCall.mock.calls[0][0]

    // Verify canonical values match TaxResult exactly (rounded to 2dp)
    expect(estimateData.subtotal).toBe(100.00) // result.base_amount
    expect(estimateData.total_tax_amount).toBe(21.90) // result.total_tax
    expect(estimateData.total_amount).toBe(121.90) // result.total_amount

    // Verify: subtotal + total_tax = total (exact match from TaxResult)
    const calculatedTotal = estimateData.subtotal + estimateData.total_tax_amount
    expect(calculatedTotal).toBeCloseTo(estimateData.total_amount, 2)

    // Verify tax_lines totals match persisted totals
    const taxLinesTotal = estimateData.tax_lines.lines.reduce(
      (sum: number, line: any) => sum + line.amount,
      0
    )
    expect(taxLinesTotal).toBeCloseTo(estimateData.total_tax_amount, 2)
  })

  it('post-2026 estimate: totals match TaxResult exactly (no COVID)', async () => {
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: '2026-01-01', // Post-2026 date
        items: [
          { qty: 1, unit_price: 120.00, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    const estimateData = insertCall.mock.calls[0][0]

    // Verify canonical values match TaxResult exactly (no COVID)
    expect(estimateData.subtotal).toBe(100.00) // result.base_amount
    expect(estimateData.total_tax_amount).toBe(20.00) // result.total_tax (no COVID)
    expect(estimateData.total_amount).toBe(120.00) // result.total_amount (no COVID)

    // Verify: subtotal + total_tax = total (exact match from TaxResult)
    const calculatedTotal = estimateData.subtotal + estimateData.total_tax_amount
    expect(calculatedTotal).toBeCloseTo(estimateData.total_amount, 2)

    // Verify legacy columns sum matches total_tax (no COVID)
    const legacyTaxSum = estimateData.nhil_amount + estimateData.getfund_amount + 
                         estimateData.covid_amount + estimateData.vat_amount
    expect(legacyTaxSum).toBeCloseTo(estimateData.total_tax_amount, 2)
    expect(estimateData.covid_amount).toBe(0) // COVID excluded for post-2026
  })

  it('uses issue_date as effective date for tax calculation', async () => {
    const issueDate = '2025-06-15'
    const request = new NextRequest('http://localhost/api/estimates/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        client_id: 'test-client',
        issue_date: issueDate,
        items: [
          { qty: 1, unit_price: 121.90, description: 'Item 1' },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('estimates').insert as jest.Mock
    const estimateData = insertCall.mock.calls[0][0]

    // Verify effective date is issue_date
    expect(estimateData.tax_engine_effective_from).toBe(issueDate)
    expect(estimateData.tax_lines.meta.effective_date_used).toBe(issueDate)

    // Verify canonical tax engine was called with issue_date
    const { getCanonicalTaxResultFromLineItems } = require('@/lib/taxEngine/helpers')
    expect(getCanonicalTaxResultFromLineItems).toHaveBeenCalled()
    const configCall = getCanonicalTaxResultFromLineItems.mock.calls[0][1]
    expect(configCall.effectiveDate).toBe(issueDate)
    expect(configCall.jurisdiction).toBe('GH')
    expect(configCall.taxInclusive).toBe(true)
  })
})
