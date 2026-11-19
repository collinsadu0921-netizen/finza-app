import { PUT } from '../[id]/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabaseServer')
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/serviceWorkspace/enforceServiceIndustryFinancialWrite', () => ({
  enforceServiceIndustryFinancialWrite: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('@/lib/service/jobReversal', () => ({
  performServiceJobReversal: jest.fn(() => Promise.resolve({ error: null })),
}))
jest.mock('@/lib/server/fireAfterAccountingPost', () => ({
  fireAfterAccountingPost: jest.fn(),
}))
jest.mock('@/lib/accounting/reconciliation/engine-impl', () => ({
  createReconciliationEngine: jest.fn(() => ({
    reconcileInvoice: jest.fn(() => Promise.resolve({ status: 'ok' })),
  })),
}))
jest.mock('@/lib/accounting/reconciliation/mismatch-logger', () => ({
  logReconciliationMismatch: jest.fn(),
}))

const baseNote = {
  id: 'cn-1',
  invoice_id: 'inv-1',
  business_id: 'biz-1',
  status: 'applied',
  total: 240,
}

function buildSupabase(existing: Record<string, unknown>) {
  let current = { ...baseNote, ...existing }
  const update = jest.fn((data: Record<string, unknown>) => {
    current = { ...current, ...data }
    return {
      eq: jest.fn(() => ({
        select: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: current, error: null })),
        })),
      })),
    }
  })
  return {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: jest.fn((table: string) => {
      if (table === 'credit_notes') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() => ({
                maybeSingle: jest.fn(() => Promise.resolve({ data: existing, error: null })),
              })),
            })),
          })),
          update,
        }
      }
      if (table === 'businesses') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({ data: { owner_id: 'user-1' }, error: null })),
            })),
          })),
        }
      }
      if (table === 'service_jobs') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        }
      }
      return {}
    }),
  }
}

const request = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/credit-notes/cn-1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

async function callPut(existing: Record<string, unknown>, body: Record<string, unknown>) {
  const supabase = buildSupabase(existing)
  const { createSupabaseServerClient } = require('@/lib/supabaseServer')
  ;(createSupabaseServerClient as jest.Mock).mockReturnValue(supabase)
  const response = await PUT(request(body), { params: Promise.resolve({ id: 'cn-1' }) })
  return { response, body: await response.json(), supabase }
}

describe('PUT /api/credit-notes/[id] - applied notes are posted source documents', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['issued', 'draft'])('rejects applied -> %s with workflow guidance', async (target) => {
    const { response, body, supabase } = await callPut(baseNote, { status: target })
    expect(response.status).toBe(409)
    expect(body.code).toBe('CREDIT_NOTE_APPLIED_IMMUTABLE')
    expect(body.error).toMatch(/contact support/i)
    expect(supabase.from('credit_notes').update).not.toHaveBeenCalled()
  })

  it('allows non-accounting fields to change on an applied note', async () => {
    const { response, body, supabase } = await callPut(baseNote, { notes: 'Filed copy sent' })
    expect(response.status).toBe(200)
    expect(body.creditNote.notes).toBe('Filed copy sent')
    const update = supabase.from('credit_notes').update
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).not.toHaveProperty('status')
  })

  it('still allows a draft to move to issued', async () => {
    const draft = { ...baseNote, status: 'draft' }
    const { response, body, supabase } = await callPut(draft, { status: 'issued' })
    expect(response.status).toBe(200)
    expect(body.creditNote.status).toBe('issued')
    expect(supabase.from('credit_notes').update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'issued' })
    )
  })
})
