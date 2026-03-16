/**
 * Order to Invoice Conversion Route Tests
 * 
 * Tests verify that order-to-invoice conversion:
 * 1. Does NOT reuse order tax fields/legacy columns
 * 2. Recomputes taxes using canonical tax engine based on INVOICE date
 * 3. Persists canonical values (subtotal, total_tax, total, tax_lines)
 * 4. Derives legacy columns from tax_lines (no rate/cutoff/country logic)
 * 5. Order created pre-2026 converted on 2026-01-01: NO COVID in invoice
 * 6. Order converted on pre-2026 date: Includes COVID
 */

import { POST } from '../convert-to-invoice/route'
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

describe('POST /api/orders/[id]/convert-to-invoice - Canonical Tax Engine', () => {
  let mockSupabase: any
  let mockOrder: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock order (created pre-2026, but tax calculation will use invoice date)
    mockOrder = {
      id: 'test-order-id',
      business_id: 'test-business',
      customer_id: 'test-customer',
      total_amount: 121.90, // Pre-2026 order total (includes COVID)
      total_tax: 21.90, // Pre-2026 tax (includes COVID)
      apply_taxes: true,
      status: 'active',
    }

    // Setup Supabase mock
    mockSupabase = {
      auth: {
        getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null })),
      },
      from: jest.fn((table: string) => {
        if (table === 'orders') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: mockOrder, error: null })),
              })),
            })),
            update: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          }
        }
        if (table === 'order_items') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({
                data: [
                  { id: 'item1', quantity: 1, unit_price: 121.90, discount_amount: 0, description: 'Item 1' },
                ],
                error: null,
              })),
            })),
          }
        }
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
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({
                  data: {
                    id: 'new-invoice-id',
                    subtotal: 100.00,
                    total_tax: 20.00,
                    total: 120.00,
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
        if (table === 'invoice_items') {
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
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

  it('does not reuse order tax fields - recomputes based on invoice date', async () => {
    // Order created pre-2026 (includes COVID), but invoice created on 2026-01-01 (no COVID)
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2026-01-01', // Invoice date (post-2026)
      }),
    })

    await POST(request)

    // Verify invoice insert was called
    expect(mockSupabase.from).toHaveBeenCalledWith('invoices')
    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    expect(insertCall).toHaveBeenCalled()

    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify effective date is invoice date (2026-01-01), not order date
    expect(invoiceData.tax_engine_effective_from).toBe('2026-01-01')
    
    // Verify canonical tax engine was called with invoice date
    const { getCanonicalTaxResultFromLineItems } = require('@/lib/taxEngine/helpers')
    expect(getCanonicalTaxResultFromLineItems).toHaveBeenCalled()
    const configCall = getCanonicalTaxResultFromLineItems.mock.calls[0][1]
    expect(configCall.effectiveDate).toBe('2026-01-01') // Invoice date, not order date
  })

  it('order created pre-2026 converted on 2026-01-01: invoice has NO COVID', async () => {
    // Order created pre-2026 (would have COVID), but converted on post-2026 date
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2026-01-01', // Invoice date (post-2026)
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify COVID is zero (post-2026 conversion)
    expect(invoiceData.covid).toBe(0)
    
    // Verify COVID is NOT in tax_lines
    const covidLine = invoiceData.tax_lines.lines.find((l: any) => l.code === 'COVID')
    expect(covidLine).toBeUndefined()
    
    // Verify engine version is post-2026
    expect(invoiceData.tax_lines.meta.engine_version).toBe('GH-2026-B')
    
    // Verify totals match post-2026 TaxResult (no COVID)
    expect(invoiceData.total_tax).toBe(20.00) // 2.50 + 2.50 + 15.00 (no COVID)
    expect(invoiceData.total).toBe(120.00) // 100 + 20
  })

  it('order converted on pre-2026 date includes COVID', async () => {
    // Order converted on pre-2026 date (includes COVID)
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2025-12-31', // Invoice date (pre-2026)
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify COVID is included (pre-2026 conversion)
    expect(invoiceData.covid).toBe(1.00)
    
    // Verify COVID is in tax_lines
    const covidLine = invoiceData.tax_lines.lines.find((l: any) => l.code === 'COVID')
    expect(covidLine).toBeDefined()
    expect(covidLine.amount).toBe(1.00)
    
    // Verify engine version is pre-2026
    expect(invoiceData.tax_lines.meta.engine_version).toBe('GH-2025-A')
    
    // Verify totals match pre-2026 TaxResult (includes COVID)
    expect(invoiceData.total_tax).toBe(21.90) // 2.50 + 2.50 + 1.00 + 15.90
    expect(invoiceData.total).toBe(121.90) // 100 + 21.90
  })

  it('persists canonical tax values from TaxResult', async () => {
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2025-12-31',
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify canonical values match TaxResult exactly (rounded to 2dp)
    expect(invoiceData.subtotal).toBe(100.00) // result.base_amount
    expect(invoiceData.total_tax).toBe(21.90) // result.total_tax
    expect(invoiceData.total).toBe(121.90) // result.total_amount
  })

  it('stores tax_lines JSONB from TaxResult', async () => {
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2025-12-31',
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify tax_lines is stored
    expect(invoiceData.tax_lines).toBeDefined()
    expect(invoiceData.tax_lines.lines).toBeDefined()
    expect(invoiceData.tax_lines.meta.jurisdiction).toBe('GH')
    expect(invoiceData.tax_lines.meta.effective_date_used).toBe('2025-12-31') // Invoice date
    expect(invoiceData.tax_lines.pricing_mode).toBe('inclusive')
  })

  it('derives legacy columns from tax_lines (no order tax field reuse)', async () => {
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2025-12-31',
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify legacy columns match tax_lines (derived, not from order)
    expect(invoiceData.nhil).toBe(2.50) // From tax_lines.lines, not order
    expect(invoiceData.getfund).toBe(2.50) // From tax_lines.lines, not order
    expect(invoiceData.covid).toBe(1.00) // From tax_lines.lines, not order
    expect(invoiceData.vat).toBe(15.90) // From tax_lines.lines, not order
  })

  it('totals match TaxResult exactly', async () => {
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2025-12-31',
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

  it('uses invoice sent date when status is sent', async () => {
    const sentDate = new Date().toISOString().split('T')[0]
    
    const request = new NextRequest('http://localhost/api/orders/test-order-id/convert-to-invoice', {
      method: 'POST',
      body: JSON.stringify({
        issue_date: '2025-12-31',
        status: 'sent', // Sent invoice
      }),
    })

    await POST(request)

    const insertCall = mockSupabase.from('invoices').insert as jest.Mock
    const invoiceData = insertCall.mock.calls[0][0]
    
    // Verify effective date is sent_at date (current date), not issue_date
    expect(invoiceData.tax_engine_effective_from).toBe(sentDate)
    expect(invoiceData.sent_at).toBeDefined()
    expect(invoiceData.status).toBe('sent')
    
    // Verify tax_lines meta uses sent_at date
    expect(invoiceData.tax_lines.meta.effective_date_used).toBe(sentDate)
  })
})
