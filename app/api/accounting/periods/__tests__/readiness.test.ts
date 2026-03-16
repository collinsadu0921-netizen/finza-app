/**
 * Step 9.0 - Period Close UX Enhancements
 * Batch E: Test Coverage & Acceptance
 * 
 * Test: Readiness Resolver Determinism & Blockers/Warnings
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { createClient } from '@supabase/supabase-js'

// Test configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

describe('Step 9.0 - Readiness Resolver Tests', () => {
  let supabase: ReturnType<typeof createClient>
  let testBusinessId: string
  let testPeriodStart: string

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    // Setup test data
    // Note: In real tests, you'd create test business and period
  })

  afterAll(async () => {
    // Cleanup test data
  })

  describe('1. Readiness Resolver - Determinism', () => {
    it('should return identical output for same period state', async () => {
      const result1 = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 100))

      const result2 = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(result1.data).toEqual(result2.data)
      expect(result1.data?.snapshot_hash).toBe(result2.data?.snapshot_hash)
    })

    it('should have stable snapshot_hash for unchanged state', async () => {
      const result1 = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      const result2 = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      // Snapshot hash should be identical if state unchanged
      expect(result1.data?.snapshot_hash).toBe(result2.data?.snapshot_hash)
    })
  })

  describe('2. Readiness Blockers', () => {
    it('should block when period is already locked', async () => {
      // Setup: Create locked period
      const { data: period } = await supabase
        .from('accounting_periods')
        .insert({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          period_end: '2025-01-31',
          status: 'locked',
        })
        .select()
        .single()

      const { data: readiness } = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(readiness.status).toBe('BLOCKED')
      expect(readiness.blockers).toContainEqual(
        expect.objectContaining({
          code: 'PERIOD_LOCKED',
          title: 'Period is already locked',
        })
      )
    })

    it('should block when unposted approved drafts exist', async () => {
      // Setup: Create period with approved but unposted draft
      const { data: period } = await supabase
        .from('accounting_periods')
        .insert({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          period_end: '2025-01-31',
          status: 'open',
        })
        .select()
        .single()

      // Create approved draft without journal_entry_id
      await supabase.from('manual_journal_drafts').insert({
        accounting_firm_id: 'test-firm-id',
        client_business_id: testBusinessId,
        period_id: period.id,
        status: 'approved',
        entry_date: '2025-01-15',
        description: 'Test draft',
        lines: [],
        total_debit: 0,
        total_credit: 0,
        created_by: 'test-user-id',
        // journal_entry_id is NULL (unposted)
      })

      const { data: readiness } = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(readiness.status).toBe('BLOCKED')
      expect(readiness.blockers).toContainEqual(
        expect.objectContaining({
          code: 'UNPOSTED_APPROVED_DRAFTS',
        })
      )
    })

    it('should block duplicate active close request', async () => {
      // Setup: Period in 'closing' status
      const { data: period } = await supabase
        .from('accounting_periods')
        .update({ status: 'closing' })
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .select()
        .single()

      // Create active close request
      await supabase.from('accounting_period_actions').insert({
        business_id: testBusinessId,
        period_start: testPeriodStart,
        action: 'request_close',
        performed_by: 'test-user-id',
        performed_at: new Date().toISOString(),
      })

      const { data: readiness } = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(readiness.status).toBe('BLOCKED')
      expect(readiness.blockers).toContainEqual(
        expect.objectContaining({
          code: 'DUPLICATE_CLOSE_REQUEST',
        })
      )
    })
  })

  describe('3. Readiness Warnings', () => {
    it('should warn when drafts exist', async () => {
      // Setup: Period with drafts
      const { data: period } = await supabase
        .from('accounting_periods')
        .insert({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          period_end: '2025-01-31',
          status: 'open',
        })
        .select()
        .single()

      await supabase.from('manual_journal_drafts').insert({
        accounting_firm_id: 'test-firm-id',
        client_business_id: testBusinessId,
        period_id: period.id,
        status: 'draft',
        entry_date: '2025-01-15',
        description: 'Test draft',
        lines: [],
        total_debit: 0,
        total_credit: 0,
        created_by: 'test-user-id',
      })

      const { data: readiness } = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(readiness.status).toBe('READY_WITH_WARNINGS')
      expect(readiness.warnings).toContainEqual(
        expect.objectContaining({
          code: 'DRAFTS_EXIST',
        })
      )
    })

    it('should warn when submitted journals exist', async () => {
      // Setup: Period with submitted journals
      const { data: period } = await supabase
        .from('accounting_periods')
        .insert({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          period_end: '2025-01-31',
          status: 'open',
        })
        .select()
        .single()

      await supabase.from('manual_journal_drafts').insert({
        accounting_firm_id: 'test-firm-id',
        client_business_id: testBusinessId,
        period_id: period.id,
        status: 'submitted',
        entry_date: '2025-01-15',
        description: 'Test submitted',
        lines: [],
        total_debit: 0,
        total_credit: 0,
        created_by: 'test-user-id',
      })

      const { data: readiness } = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(readiness.status).toBe('READY_WITH_WARNINGS')
      expect(readiness.warnings).toContainEqual(
        expect.objectContaining({
          code: 'SUBMITTED_JOURNALS_EXIST',
        })
      )
    })

    it('should allow close request with warnings', async () => {
      // Setup: Period with warnings but no blockers
      const { data: period } = await supabase
        .from('accounting_periods')
        .insert({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          period_end: '2025-01-31',
          status: 'open',
        })
        .select()
        .single()

      await supabase.from('manual_journal_drafts').insert({
        accounting_firm_id: 'test-firm-id',
        client_business_id: testBusinessId,
        period_id: period.id,
        status: 'draft',
        entry_date: '2025-01-15',
        description: 'Test draft',
        lines: [],
        total_debit: 0,
        total_credit: 0,
        created_by: 'test-user-id',
      })

      const { data: readiness } = await supabase.rpc('check_period_close_readiness', {
        p_business_id: testBusinessId,
        p_period_start: testPeriodStart,
      })

      expect(readiness.status).toBe('READY_WITH_WARNINGS')
      // Close request should still be allowed (warnings don't block)
      expect(readiness.blockers.length).toBe(0)
    })
  })
})
