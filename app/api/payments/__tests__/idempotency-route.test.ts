import { POST } from '../create/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabaseServer')
jest.mock('@/lib/business', () => ({
  getCurrentBusiness: jest.fn(() => Promise.resolve({ id: 'test-business', address_country: 'GH' })),
}))
jest.mock('@/lib/auditLog', () => ({ createAuditLog: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/accountingBootstrap', () => ({
  ensureAccountingInitialized: jest.fn(() => Promise.resolve({ error: null })),
}))
jest.mock('@/lib/archivedBusiness', () => ({
  assertBusinessNotArchived: jest.fn(() => Promise.resolve()),
}))
jest.mock('@/lib/accounting/reconciliation/engine-impl', () => ({
  createReconciliationEngine: jest.fn(() => ({
    reconcileInvoice: jest.fn(() => Promise.resolve({ status: 'ok' })),
  })),
}))
jest.mock('@/lib/accounting/reconciliation/mismatch-logger', () => ({
  logReconciliationMismatch: jest.fn(),
}))
jest.mock('@/lib/payments/eligibility', () => ({
  normalizeCountry: jest.fn(() => 'GH'),
  assertMethodAllowed: jest.fn(() => {}),
}))
jest.mock('@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite', () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('@/lib/payments/assertPaymentJournalPosted', () => ({
  assertPaymentJournalPosted: jest.fn(() => Promise.resolve({ ok: true })),
}))

const invoice = {
  id: 'test-invoice-id',
  business_id: 'test-business',
  total: 120,
  status: 'sent',
  fx_rate: null,
  currency_code: 'GHS',
}

const request = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/payments/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

const baseBody = {
  invoice_id: 'test-invoice-id',
  amount: 50,
  date: '2025-01-01',
  method: 'cash',
  idempotency_key: 'retry-key-1',
}

function buildSupabase(existingPayment: Record<string, unknown> | null) {
  const insert = jest.fn()
  const maybeSingle = jest.fn(() => Promise.resolve({ data: existingPayment, error: null }))
  const supabase = {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null })),
    },
    from: jest.fn((table: string) => {
      if (table === 'businesses') {
        const data = { id: 'test-business', address_country: 'GH' }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })) })),
              })),
              single: jest.fn(() => Promise.resolve({ data, error: null })),
            })),
          })),
        }
      }
      if (table === 'business_users') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
              })),
            })),
          })),
        }
      }
      if (table === 'invoices') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: invoice, error: null })) })),
            })),
          })),
          update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
        }
      }
      if (table === 'credit_notes') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({ is: jest.fn(() => Promise.resolve({ data: [], error: null })) })),
            })),
          })),
        }
      }
      if (table === 'payments') {
        return {
          select: jest.fn((columns: string) => {
            if (columns === '*') {
              return {
                eq: jest.fn(() => ({
                  eq: jest.fn(() => ({ is: jest.fn(() => ({ maybeSingle })) })),
                })),
              }
            }
            return {
              eq: jest.fn(() => ({ is: jest.fn(() => Promise.resolve({ data: [], error: null })) })),
            }
          }),
          insert,
        }
      }
      return {}
    }),
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
  }
  return { supabase, insert, maybeSingle }
}

describe('POST /api/payments/create - idempotency', () => {
  beforeEach(() => jest.clearAllMocks())

  it('replays the original payment for an identical retry', async () => {
    const existing = {
      id: 'payment-1',
      invoice_id: 'test-invoice-id',
      amount: 50,
      date: '2025-01-01T00:00:00.000Z',
      method: 'cash',
      wht_amount: 0,
      settlement_fx_rate: null,
      reference: null,
    }
    const { supabase, insert, maybeSingle } = buildSupabase(existing)
    const { createSupabaseServerClient } = require('@/lib/supabaseServer')
    ;(createSupabaseServerClient as jest.Mock).mockReturnValue(supabase)

    const response = await POST(request(baseBody))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, idempotent: true, payment: { id: 'payment-1' } })
    expect(maybeSingle).toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects a different payload that reuses the key', async () => {
    const existing = {
      id: 'payment-1',
      invoice_id: 'test-invoice-id',
      amount: 49,
      date: '2025-01-01T00:00:00.000Z',
      method: 'cash',
      wht_amount: 0,
      settlement_fx_rate: null,
      reference: null,
    }
    const { supabase, insert } = buildSupabase(existing)
    const { createSupabaseServerClient } = require('@/lib/supabaseServer')
    ;(createSupabaseServerClient as jest.Mock).mockReturnValue(supabase)

    const response = await POST(request(baseBody))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('IDEMPOTENCY_KEY_CONFLICT')
    expect(insert).not.toHaveBeenCalled()
  })
})
