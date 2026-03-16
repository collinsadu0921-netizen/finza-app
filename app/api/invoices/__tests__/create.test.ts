/**
 * Invoice Creation Route Tests
 * 
 * Tests verify that invoice creation:
 * 1. Uses canonical tax engine (TaxResult)
 * 2. Persists canonical values (subtotal, total_tax, total, tax_lines)
 * 3. Derives legacy columns from tax_lines (no rate/cutoff/country logic)
 * 4. Effective date logic: Draft uses issue_date, Sent uses sent_at
 */

import { POST } from '../create/route'
import { NextRequest } from 'next/server'
import type { TaxResult } from '@/lib/taxEngine/types'

// Mock modules
jest.mock('@/lib/supabaseServer')
jest.mock('@/lib/auditLog', () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock('@/lib/payments/eligibility', () => ({
  normalizeCountry: jest.fn((country: string) => 'GH'),
}))
jest.mock('@/lib/countryCurrency', () => ({
  assertCountryCurrency: jest.fn(() => {}),
}))

// Mock canonical tax engine
const mockTaxResult: TaxResult = {
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
    effective_date_used: '2025-12-31',
    engine_version: 'GH-2025-A',
  },
}

jest.mock('@/lib/taxEngine/helpers', () => ({
  getTaxEngineCode: jest.fn(() => 'ghana'),
  deriveLegacyTaxColumnsFromTaxLines: jest.fn((lines) => ({
    nhil: lines.find((l: any) => l.code === 'NHIL')?.amount || 0,
    getfund: lines.find((l: any) => l.code === 'GETFUND')?.amount || 0,
    covid: lines.find((l: any) => l.code === 'COVID')?.amount || 0,
    vat: lines.find((l: any) => l.code === 'VAT')?.amount || 0,
  })),
  getCanonicalTaxResultFromLineItems: jest.fn(() => mockTaxResult),
}))

jest.mock('@/lib/taxEngine/serialize', () => ({
  toTaxLinesJsonb: jest.fn((result: TaxResult) => ({
    lines: result.lines,
    meta: result.meta,
    pricing_mode: result.pricing_mode,
  })),
}))

describe('POST /api/invoices/create - Canonical Tax Engine', () => {
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
                  data: { id: 'test-business', address_country: 'GH', default_currency: 'GHS' },
                  error: null,
                })),
              })),
            })),
          }
        }
        if (table === 'invoice_settings') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
          }
        }
        if (table === 'invoices') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'new-invoice-id',
                    subtotal: 100.00,
                    total_tax: 21.90,
                    total: 121.90,
                    tax_lines: {
                      lines: mockTaxResult.lines,
                      meta: mockTaxResult.meta,
                      pricing_mode: mockTaxResult.pricing_mode,
                    },
                    nhil: 2.50,
                    getfund: 2.50,
                    covid: 1.00,
                    vat: 15.90,
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
        if (table === 'invoice_items') {
          return {
            insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
          }
        }
        return {} as any
      }),
      rpc: jest.fn((fn: string) => {
        if (fn === 'generate_invoice_number_with_settings') {
          return Promise.resolve({ data: 'INV-001', error: null })
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
    const request = new NextRequest('http://localhost/api/invoices/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    // Verify invoice insert was called
    expect(mockSupabase.from).toHaveBeenCalledWith('invoices')
    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    expect(insertCall).toHaveBeenCalled()

    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify canonical values match TaxResult exactly (rounded to 2dp)
    expect(invoiceData.subtotal).toBe(100.00) // result.base_amount
    expect(invoiceData.total_tax).toBe(21.90) // result.total_tax
    expect(invoiceData.total).toBe(121.90) // result.total_amount
  })

  it('stores tax_lines JSONB from TaxResult', async () => {
    const request = new NextRequest('http://localhost/api/invoices/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify tax_lines is stored
    expect(invoiceData.tax_lines).toBeDefined()
    expect(invoiceData.tax_lines.lines).toHaveLength(4)
    expect(invoiceData.tax_lines.meta.jurisdiction).toBe('GH')
    expect(invoiceData.tax_lines.meta.effective_date_used).toBe('2025-12-31')
    expect(invoiceData.tax_lines.pricing_mode).toBe('inclusive')
  })

  it('derives legacy columns from tax_lines (no Ghana-specific logic)', async () => {
    const request = new NextRequest('http://localhost/api/invoices/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify legacy columns match tax_lines (derived, not calculated)
    expect(invoiceData.nhil).toBe(2.50) // From tax_lines.lines
    expect(invoiceData.getfund).toBe(2.50) // From tax_lines.lines
    expect(invoiceData.covid).toBe(1.00) // From tax_lines.lines
    expect(invoiceData.vat).toBe(15.90) // From tax_lines.lines
  })

  it('uses issue_date as effective date for draft invoices', async () => {
    const request = new NextRequest('http://localhost/api/invoices/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        issue_date: '2025-12-31',
        status: 'draft',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify effective date is issue_date for draft
    expect(invoiceData.tax_engine_effective_from).toBe('2025-12-31')
    expect(invoiceData.sent_at).toBeUndefined()
  })

  it('uses sent_at (current date) as effective date for sent invoices', async () => {
    const currentDate = new Date().toISOString().split('T')[0]
    
    const request = new NextRequest('http://localhost/api/invoices/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        issue_date: '2025-12-31',
        status: 'sent',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify effective date is current date for sent
    expect(invoiceData.tax_engine_effective_from).toBe(currentDate)
    expect(invoiceData.sent_at).toBeDefined()
  })

  it('totals match TaxResult exactly', async () => {
    const request = new NextRequest('http://localhost/api/invoices/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        issue_date: '2025-12-31',
        items: [
          { qty: 1, unit_price: 121.90, discount_amount: 0 },
        ],
        apply_taxes: true,
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify: subtotal + total_tax = total (exact match from TaxResult)
    const calculatedTotal = invoiceData.subtotal + invoiceData.total_tax
    expect(calculatedTotal).toBeCloseTo(invoiceData.total, 2)
    
    // Verify legacy columns sum matches total_tax
    const legacyTaxSum = invoiceData.nhil + invoiceData.getfund + invoiceData.covid + invoiceData.vat
    expect(legacyTaxSum).toBeCloseTo(invoiceData.total_tax, 2)
  })
})
