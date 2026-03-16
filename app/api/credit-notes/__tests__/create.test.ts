/**
 * Credit Note Creation Route Tests
 * 
 * Tests verify that credit note creation:
 * 1. Uses canonical tax engine (TaxResult)
 * 2. Persists canonical values (subtotal, total_tax, total, tax_lines)
 * 3. Derives legacy columns from tax_lines (no rate/cutoff/country logic)
 * 4. Effective date uses credit note date
 * 5. Pre-2026 credit notes include COVID
 * 6. Post-2026 credit notes exclude COVID
 */

import { POST } from '../create/route'
import { NextRequest } from 'next/server'
import type { TaxResult } from '@/lib/taxEngine/types'

// Mock modules
jest.mock('@/lib/supabaseServer')
jest.mock('@/lib/payments/eligibility', () => ({
  normalizeCountry: jest.fn((country: string) => 'GH'),
}))
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

describe('POST /api/credit-notes/create - Canonical Tax Engine', () => {
  let mockSupabase: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup Supabase mock
    mockSupabase = {
      auth: {
        getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null })),
      },
      from: jest.fn((table: string) => {
        if (table === 'invoices') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: { id: 'test-invoice-id', total: 200.00, customer_id: 'test-customer' },
                  error: null,
                })),
                is: jest.fn(() => ({
                  single: jest.fn(() => Promise.resolve({
                    data: { id: 'test-invoice-id', total: 200.00, customer_id: 'test-customer' },
                    error: null,
                  })),
                })),
              })),
            })),
          }
        }
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
        if (table === 'payments') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          }
        }
        if (table === 'credit_notes') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  is: jest.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            })),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'new-credit-note-id',
                    subtotal: 100.00,
                    total_tax: 21.90,
                    total: 121.90,
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
            delete: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          }
        }
        if (table === 'credit_note_items') {
          return {
            insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
          }
        }
        return {} as any
      }),
      rpc: jest.fn((fn: string) => {
        if (fn === 'generate_credit_note_number') {
          return Promise.resolve({ data: 'CN-001', error: null })
        }
        if (fn === 'generate_public_token') {
          return Promise.resolve({ data: 'mock-token', error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }

    // Mock createSupabaseServerClient
    require('@/lib/supabaseServer').createSupabaseServerClient = jest.fn(() => Promise.resolve(mockSupabase))
  })

  it('persists canonical tax values from TaxResult', async () => {
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    // Verify credit note insert was called
    expect(mockSupabase.from).toHaveBeenCalledWith('credit_notes')
    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    expect(insertCall).toHaveBeenCalled()

    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify canonical values match TaxResult exactly (rounded to 2dp)
    expect(creditNoteData.subtotal).toBe(100.00) // result.base_amount
    expect(creditNoteData.total_tax).toBe(21.90) // result.total_tax
    expect(creditNoteData.total).toBe(121.90) // result.total_amount
  })

  it('stores tax_lines JSONB from TaxResult', async () => {
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify tax_lines is stored
    expect(creditNoteData.tax_lines).toBeDefined()
    expect(creditNoteData.tax_lines.lines).toBeDefined()
    expect(creditNoteData.tax_lines.meta.jurisdiction).toBe('GH')
    expect(creditNoteData.tax_lines.meta.effective_date_used).toBe('2025-12-31')
    expect(creditNoteData.tax_lines.pricing_mode).toBe('inclusive')
  })

  it('derives legacy columns from tax_lines (no Ghana-specific logic)', async () => {
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify legacy columns match tax_lines (derived, not calculated)
    expect(creditNoteData.nhil).toBe(2.50) // From tax_lines.lines
    expect(creditNoteData.getfund).toBe(2.50) // From tax_lines.lines
    expect(creditNoteData.covid).toBe(1.00) // From tax_lines.lines
    expect(creditNoteData.vat).toBe(15.90) // From tax_lines.lines
  })

  it('uses credit note date as effective date', async () => {
    const creditNoteDate = '2025-12-31'
    
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: creditNoteDate,
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify effective date is credit note date
    expect(creditNoteData.tax_engine_effective_from).toBe(creditNoteDate)
    
    // Verify tax_lines meta also uses credit note date
    expect(creditNoteData.tax_lines.meta.effective_date_used).toBe(creditNoteDate)
  })

  it('pre-2026 credit note includes COVID tax', async () => {
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: '2025-12-31', // Pre-2026 date
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify COVID is included in legacy columns
    expect(creditNoteData.covid).toBe(1.00)
    
    // Verify COVID is in tax_lines
    const covidLine = creditNoteData.tax_lines.lines.find((l: any) => l.code === 'COVID')
    expect(covidLine).toBeDefined()
    expect(covidLine.amount).toBe(1.00)
    
    // Verify engine version is pre-2026
    expect(creditNoteData.tax_lines.meta.engine_version).toBe('GH-2025-A')
  })

  it('post-2026 credit note excludes COVID tax', async () => {
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: '2026-01-01', // Post-2026 date
        items: [
          { qty: 1, unit_price: 120.00, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify COVID is zero in legacy columns
    expect(creditNoteData.covid).toBe(0)
    
    // Verify COVID is NOT in tax_lines
    const covidLine = creditNoteData.tax_lines.lines.find((l: any) => l.code === 'COVID')
    expect(covidLine).toBeUndefined()
    
    // Verify engine version is post-2026
    expect(creditNoteData.tax_lines.meta.engine_version).toBe('GH-2026-B')
    
    // Verify total tax is lower (no COVID)
    expect(creditNoteData.total_tax).toBe(20.00) // 2.50 + 2.50 + 15.00 (no COVID)
    expect(creditNoteData.total).toBe(120.00) // 100 + 20
  })

  it('totals match TaxResult exactly', async () => {
    const request = new NextRequest('http://localhost/api/credit-notes/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('credit_notes').insert as jest.Mock
    const creditNoteData = insertCall.mock.calls[0][0]
    
    // Verify: subtotal + total_tax = total (exact match from TaxResult)
    const calculatedTotal = creditNoteData.subtotal + creditNoteData.total_tax
    expect(calculatedTotal).toBeCloseTo(creditNoteData.total, 2)
    
    // Verify legacy columns sum matches total_tax
    const legacyTaxSum = creditNoteData.nhil + creditNoteData.getfund + creditNoteData.covid + creditNoteData.vat
    expect(legacyTaxSum).toBeCloseTo(creditNoteData.total_tax, 2)
  })
})
