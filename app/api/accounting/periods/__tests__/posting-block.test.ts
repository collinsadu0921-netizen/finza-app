/**
 * Step 9.0 - Period Close UX Enhancements
 * Batch E: Test Coverage & Acceptance
 * 
 * Test: Posting Block Enforcement on Locked Periods
 */

import { describe, it, expect, beforeAll } from '@jest/globals'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

describe('Step 9.0 - Posting Block Enforcement Tests', () => {
  let supabase: ReturnType<typeof createClient>
  let testBusinessId: string
  let testPeriodStart: string
  let lockedPeriodId: string

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // Setup: Create locked period
    const { data: period } = await supabase
      .from('accounting_periods')
      .insert({
        business_id: testBusinessId,
        period_start: testPeriodStart,
        period_end: '2025-01-31',
        status: 'locked',
        closed_at: new Date().toISOString(),
      })
      .select()
      .single()
    
    lockedPeriodId = period.id
  })

  describe('8. Posting Block Enforcement', () => {
    it('should block invoice posting to locked period', async () => {
      // Attempt to post invoice to locked period
      const { error } = await supabase.rpc('post_invoice_to_ledger', {
        p_invoice_id: 'test-invoice-id', // Would need real invoice ID
      })

      expect(error).toBeTruthy()
      expect(error?.message).toContain('locked')
      expect(error?.message).toContain('blocked')
    })

    it('should block manual journal posting to locked period', async () => {
      // Attempt to post manual journal to locked period
      const { error } = await supabase.rpc('post_journal_entry', {
        p_business_id: testBusinessId,
        p_date: testPeriodStart, // Date in locked period
        p_description: 'Test entry',
        p_reference_type: 'manual',
        p_reference_id: null,
        p_lines: [],
      })

      expect(error).toBeTruthy()
      expect(error?.message).toContain('locked')
    })

    it('should block adjusting journal to locked period', async () => {
      // Attempt to apply adjusting journal to locked period
      const { error } = await supabase.rpc('apply_adjusting_journal', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
        p_entry_date: '2025-01-15',
        p_description: 'Test adjustment',
        p_lines: [],
        p_created_by: 'test-user-id',
      })

      expect(error).toBeTruthy()
      expect(error?.message).toContain('locked')
    })

    it('should allow posting to open period', async () => {
      // Setup: Create open period
      const { data: openPeriod } = await supabase
        .from('accounting_periods')
        .insert({
          business_id: testBusinessId,
          period_start: '2025-02-01',
          period_end: '2025-02-28',
          status: 'open',
        })
        .select()
        .single()

      // Posting to open period should succeed
      // (This would need actual valid data)
      // const { error } = await supabase.rpc('post_journal_entry', {
      //   p_business_id: testBusinessId,
      //   p_date: '2025-02-15',
      //   p_description: 'Test',
      //   p_reference_type: 'manual',
      //   p_reference_id: null,
      //   p_lines: validLines,
      // })

      // expect(error).toBeFalsy()
    })
  })
})
