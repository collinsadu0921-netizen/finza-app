/**
 * Step 9.0 - Period Close UX Enhancements
 * Batch E: Test Coverage & Acceptance
 * 
 * Test: Close Request Flow (Request → Approve → Reject → Lock)
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

describe('Step 9.0 - Close Request Flow Tests', () => {
  let supabase: ReturnType<typeof createClient>
  let testBusinessId: string
  let testPeriodStart: string
  let testUserId: string
  let testPartnerUserId: string

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    // Setup test data
  })

  afterAll(async () => {
    // Cleanup
  })

  describe('4. Close Request Flow', () => {
    it('should transition open → closing on request_close', async () => {
      // Setup: Open period
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

      // Request close via API
      const response = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'request_close',
        }),
      })

      expect(response.ok).toBe(true)
      const { period: updatedPeriod } = await response.json()

      // Assert state transition
      expect(updatedPeriod.status).toBe('closing')
      expect(updatedPeriod.close_requested_at).toBeTruthy()
      expect(updatedPeriod.close_requested_by).toBe(testUserId)

      // Assert audit log
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'request_close')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
      expect(actions[0].performed_by).toBe(testUserId)
    })

    it('should block request_close when readiness is BLOCKED', async () => {
      // Setup: Period with blockers (e.g., unposted approved drafts)
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

      // Create blocker: unposted approved draft
      await supabase.from('manual_journal_drafts').insert({
        accounting_firm_id: 'test-firm-id',
        client_business_id: testBusinessId,
        period_id: period.id,
        status: 'approved',
        entry_date: '2025-01-15',
        description: 'Test',
        lines: [],
        total_debit: 0,
        total_credit: 0,
        created_by: testUserId,
        // journal_entry_id is NULL (unposted)
      })

      // Attempt request close
      const response = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'request_close',
        }),
      })

      expect(response.status).toBe(400)
      const { error, readiness } = await response.json()
      expect(error).toContain('blockers')
      expect(readiness.status).toBe('BLOCKED')
    })
  })

  describe('5. Close Request Rejection', () => {
    it('should transition closing → open on reject_close', async () => {
      // Setup: Period in closing status
      const { data: period } = await supabase
        .from('accounting_periods')
        .update({
          status: 'closing',
          close_requested_at: new Date().toISOString(),
          close_requested_by: testUserId,
        })
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .select()
        .single()

      // Reject close
      const response = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'reject_close',
        }),
      })

      expect(response.ok).toBe(true)
      const { period: updatedPeriod } = await response.json()

      // Assert state transition
      expect(updatedPeriod.status).toBe('open')
      expect(updatedPeriod.close_requested_at).toBeNull()
      expect(updatedPeriod.close_requested_by).toBeNull()

      // Assert audit log
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'reject_close')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
    })
  })

  describe('6. Approve Close (Soft Close)', () => {
    it('should transition closing → soft_closed on approve_close', async () => {
      // Setup: Period in closing status
      const { data: period } = await supabase
        .from('accounting_periods')
        .update({
          status: 'closing',
          close_requested_at: new Date().toISOString(),
          close_requested_by: testUserId,
        })
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .select()
        .single()

      // Approve close (requires partner role)
      const response = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'approve_close',
        }),
        // Note: In real test, you'd set auth headers for partner user
      })

      expect(response.ok).toBe(true)
      const { period: updatedPeriod } = await response.json()

      // Assert state transition
      expect(updatedPeriod.status).toBe('soft_closed')
      expect(updatedPeriod.closed_at).toBeTruthy()
      expect(updatedPeriod.closed_by).toBe(testPartnerUserId)
      expect(updatedPeriod.close_requested_at).toBeNull() // Cleared on approve

      // Assert audit log
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'approve_close')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
      expect(actions[0].performed_by).toBe(testPartnerUserId)
    })

    it('should NOT lock period on approve_close', async () => {
      // Setup: Period in closing
      const { data: period } = await supabase
        .from('accounting_periods')
        .update({ status: 'closing' })
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .select()
        .single()

      // Approve close
      const response = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'approve_close',
        }),
      })

      const { period: updatedPeriod } = await response.json()

      // Assert: Should be soft_closed, NOT locked
      expect(updatedPeriod.status).toBe('soft_closed')
      expect(updatedPeriod.status).not.toBe('locked')
    })
  })

  describe('7. Lock Period', () => {
    it('should transition soft_closed → locked on lock action', async () => {
      // Setup: Period in soft_closed
      const { data: period } = await supabase
        .from('accounting_periods')
        .update({
          status: 'soft_closed',
          closed_at: new Date().toISOString(),
          closed_by: testPartnerUserId,
        })
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .select()
        .single()

      // Lock period
      const response = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'lock',
        }),
      })

      expect(response.ok).toBe(true)
      const { period: updatedPeriod } = await response.json()

      // Assert state transition
      expect(updatedPeriod.status).toBe('locked')
      expect(updatedPeriod.closed_at).toBeTruthy()

      // Assert audit log
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'lock')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
    })
  })
})
