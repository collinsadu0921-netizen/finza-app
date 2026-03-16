/**
 * Payment Creation Route Tests
 * 
 * Tests verify that payment creation:
 * 1. Does NOT auto-correct invoice.total based on legacy tax columns
 * 2. Treats invoice.total as authoritative
 * 3. Uses invoice.total for overpayment prevention
 * 4. Does NOT query legacy tax columns from database
 */

import { POST } from '../create/route'
import { NextRequest } from 'next/server'

// Mock modules
jest.mock('@/lib/supabaseServer')
jest.mock('@/lib/auditLog', () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))
jest.mock('@/lib/payments/eligibility', () => ({
  normalizeCountry: jest.fn((country: string) => 'GH'),
  assertMethodAllowed: jest.fn(() => {}),
}))

// Mock invoice with mismatching tax data
// Invoice total is 120.00, but legacy columns would sum to 125.00
// This simulates a scenario where legacy columns exist but don't match the authoritative total
const mockInvoiceWithMismatch = {
  id: 'test-invoice-id',
  total: 120.00, // Authoritative total (should be used)
  status: 'sent', // Non-draft so payment is allowed
  // Note: These legacy columns exist in DB but are NOT queried in new code
  subtotal: 100.00,
  nhil: 10.00,
  getfund: 5.00,
  covid: 5.00,
  vat: 5.00,
  // If reconstructed: 100 + 10 + 5 + 5 + 5 = 125 (but total is 120)
  // Legacy columns should be IGNORED - total is authoritative
}

describe('POST /api/payments/create - Total Reconstruction Fix', () => {
  let mockSupabase: any
  let mockUpdateCall: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdateCall = jest.fn(() => Promise.resolve({ data: null, error: null }))

    // Setup Supabase mock
    mockSupabase = {
      auth: {
        getUser: jest.fn(() =>
          Promise.resolve({
            data: { user: { id: 'test-user' } },
            error: null,
          })
        ),
      },
      from: jest.fn((table: string) => {
        if (table === 'businesses') {
          const businessData = { id: 'test-business', address_country: 'GH' }
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    maybeSingle: jest.fn(() => Promise.resolve({ data: businessData, error: null })),
                  })),
                })),
                single: jest.fn(() => Promise.resolve({ data: businessData, error: null })),
              })),
            })),
          }
        }
        if (table === 'business_users') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'invoices') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  single: jest.fn(() =>
                    Promise.resolve({
                      data: mockInvoiceWithMismatch,
                      error: null,
                    })
                  ),
                  maybeSingle: jest.fn(() =>
                    Promise.resolve({
                      data: mockInvoiceWithMismatch,
                      error: null,
                    })
                  ),
                })),
              })),
            })),
            update: jest.fn((updateData: any) => {
              // Capture update data to verify invoice.total is NOT being corrected
              mockUpdateCall(updateData)
              return {
                eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
              }
            }),
          }
        }
        if (table === 'payments') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() =>
                  Promise.resolve({
                    data: [], // No existing payments
                    error: null,
                  })
                ),
              })),
            })),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: {
                      id: 'test-payment-id',
                      amount: 50.00,
                      invoice_id: 'test-invoice-id',
                      date: '2025-01-01',
                      method: 'cash',
                    },
                    error: null,
                  })
                ),
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
          }
        }
        return {}
      }),
      rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
    }

    const { createSupabaseServerClient } = require('@/lib/supabaseServer')
    ;(createSupabaseServerClient as jest.Mock).mockReturnValue(mockSupabase)
  })

  it('does not mutate invoice.total when legacy columns would mismatch', async () => {
    const requestBody = {
      business_id: 'test-business',
      invoice_id: 'test-invoice-id',
      amount: 50.00,
      date: '2025-01-01',
      method: 'cash',
    }

    const request = new NextRequest('http://localhost/api/payments/create', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const responseData = await response.json()

    // Verify payment was created successfully
    expect(response.status).toBe(201)
    expect(responseData.success).toBe(true)

    // CRITICAL: Verify invoice.total was NOT updated
    // The old code would have updated invoice.total to 125.00 (reconstructed)
    // The new code should NOT update invoice.total at all
    const updateCalls = mockUpdateCall.mock.calls
    
    // If update was called (for status update), verify it does NOT contain total
    updateCalls.forEach((call: any[]) => {
      const updateData = call[0]
      // Status update is OK, but total update is NOT
      expect(updateData).not.toHaveProperty('total')
      // Should only update status and paid_at
      if (updateData.status !== undefined) {
        expect(Object.keys(updateData).sort()).toEqual(['paid_at', 'status'].sort())
      }
    })
  })

  it('uses invoice.total (120.00) for overpayment prevention, not reconstructed total (125.00)', async () => {
    // Setup: Invoice with total = 120.00
    // Legacy columns would sum to 125.00, but we should use 120.00
    const invoiceQuery = mockSupabase.from('invoices')

    // Test 1: Payment amount < invoice.total (120.00) should succeed
    const validRequest = new NextRequest('http://localhost/api/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        amount: 50.00, // Less than 120.00
        date: '2025-01-01',
        method: 'cash',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const validResponse = await POST(validRequest)
    expect(validResponse.status).toBe(201)

    // Reset mocks for next test
    jest.clearAllMocks()
    const businessData = { id: 'test-business', address_country: 'GH' }
    mockSupabase.from = jest.fn((table: string) => {
      if (table === 'businesses') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: businessData, error: null })),
                })),
              })),
              single: jest.fn(() => Promise.resolve({ data: businessData, error: null })),
            })),
          })),
        }
      }
      if (table === 'business_users') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'invoices') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() =>
                  Promise.resolve({
                    data: mockInvoiceWithMismatch,
                    error: null,
                  })
                ),
                maybeSingle: jest.fn(() =>
                  Promise.resolve({
                    data: mockInvoiceWithMismatch,
                    error: null,
                  })
                ),
              })),
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        }
      }
      if (table === 'payments') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() =>
                Promise.resolve({
                  data: [],
                  error: null,
                })
              ),
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
        }
      }
      if (table === 'chart_of_accounts_control_map' || table === 'accounts') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
          })),
        }
      }
      return {}
    })
    ;(require('@/lib/supabaseServer').createSupabaseServerClient as jest.Mock).mockReturnValue(mockSupabase)

    // Test 2: Payment amount > invoice.total (120.00) should fail
    // Even though legacy columns would allow 125.00, we should reject > 120.00
    const invalidRequest = new NextRequest('http://localhost/api/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        amount: 150.00, // Greater than 120.00
        date: '2025-01-01',
        method: 'cash',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const invalidResponse = await POST(invalidRequest)
    expect(invalidResponse.status).toBe(400)
    const invalidData = await invalidResponse.json()
    expect(invalidData.error).toContain('exceeds remaining balance')
    
    // Verify error message uses invoice.total (120.00), not reconstructed total (125.00)
    expect(invalidData.error).toContain('150.00') // Payment amount
    expect(invalidData.error).toContain('120.00') // Should be invoice.total
    expect(invalidData.error).not.toContain('125.00') // Should NOT be reconstructed total
  })

  it('does not query legacy tax columns (nhil, getfund, covid, vat, subtotal) from database', async () => {
    let capturedSelectColumns = ''
    const businessData = { id: 'test-business', address_country: 'GH' }

    // Override invoices query to capture SELECT columns
    mockSupabase.from = jest.fn((table: string) => {
      if (table === 'businesses') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: businessData, error: null })),
                })),
              })),
              single: jest.fn(() => Promise.resolve({ data: businessData, error: null })),
            })),
          })),
        }
      }
      if (table === 'business_users') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'invoices') {
        const invoiceData = { id: 'test-invoice-id', business_id: 'test-business', total: 120.00, issue_date: '2025-01-01', status: 'sent' }
        return {
          select: jest.fn((columns: string) => {
            if (columns.includes('id') && columns.includes('total') && !columns.includes('business_id')) {
              capturedSelectColumns = columns
            }
            return {
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  single: jest.fn(() => Promise.resolve({ data: invoiceData, error: null })),
                  maybeSingle: jest.fn(() => Promise.resolve({ data: invoiceData, error: null })),
                })),
              })),
            }
          }),
        }
      }
      if (table === 'payments') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() =>
                Promise.resolve({
                  data: [],
                  error: null,
                })
              ),
            })),
          })),
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({
                  data: { id: 'test-payment-id', amount: 50.00 },
                  error: null,
                })
              ),
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
        }
      }
      return {}
    })
    ;(require('@/lib/supabaseServer').createSupabaseServerClient as jest.Mock).mockReturnValue(mockSupabase)

    const request = new NextRequest('http://localhost/api/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        amount: 50.00,
        date: '2025-01-01',
        method: 'cash',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(request)

    // Verify SELECT query does NOT include legacy tax columns
    expect(capturedSelectColumns).not.toContain('nhil')
    expect(capturedSelectColumns).not.toContain('getfund')
    expect(capturedSelectColumns).not.toContain('covid')
    expect(capturedSelectColumns).not.toContain('subtotal')
    expect(capturedSelectColumns).not.toContain('apply_taxes')
    
    // Should select id, total, and status (status required for draft-invoice guard)
    expect(capturedSelectColumns).toContain('id')
    expect(capturedSelectColumns).toContain('total')
    expect(capturedSelectColumns).toContain('status')
    const columns = capturedSelectColumns.split(',').map((c: string) => c.trim())
    expect(columns.sort()).toEqual(['id', 'status', 'total'].sort())
  })

  it('rejects payment when invoice is draft (400, explicit message)', async () => {
    const originalStatus = mockInvoiceWithMismatch.status
    mockInvoiceWithMismatch.status = 'draft'

    const request = new NextRequest('http://localhost/api/payments/create', {
      method: 'POST',
      body: JSON.stringify({
        business_id: 'test-business',
        invoice_id: 'test-invoice-id',
        amount: 50.00,
        date: '2025-01-01',
        method: 'cash',
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request)
    const body = await response.json()

    mockInvoiceWithMismatch.status = originalStatus

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Cannot record payment for a draft invoice. Issue the invoice first.')
    expect(body.message).toBe('Cannot record payment for a draft invoice. Issue the invoice first.')
  })
})
