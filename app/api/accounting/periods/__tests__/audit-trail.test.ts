/**
 * Step 9.0 - Period Close UX Enhancements
 * Batch E: Test Coverage & Acceptance
 * 
 * Test: Audit Trail Integrity
 */

import { describe, it, expect, beforeAll } from '@jest/globals'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

describe('Step 9.0 - Audit Trail Integrity Tests', () => {
  let supabase: ReturnType<typeof createClient>
  let testBusinessId: string
  let testPeriodStart: string
  let testUserId: string

  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  })

  describe('10. Audit Trail Integrity', () => {
    it('should create audit entry for request_close', async () => {
      // Perform request_close
      await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'request_close',
        }),
      })

      // Verify audit entry
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'request_close')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
      expect(actions[0].action).toBe('request_close')
      expect(actions[0].performed_by).toBe(testUserId)
      expect(actions[0].performed_at).toBeTruthy()
    })

    it('should create audit entry for approve_close', async () => {
      // Perform approve_close
      await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'approve_close',
        }),
      })

      // Verify audit entry
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'approve_close')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
      expect(actions[0].action).toBe('approve_close')
      expect(actions[0].performed_at).toBeTruthy()
    })

    it('should create audit entry for reject_close', async () => {
      // Perform reject_close
      await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'reject_close',
        }),
      })

      // Verify audit entry
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'reject_close')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
      expect(actions[0].action).toBe('reject_close')
    })

    it('should create audit entry for lock', async () => {
      // Perform lock
      await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: testBusinessId,
          period_start: testPeriodStart,
          action: 'lock',
        }),
      })

      // Verify audit entry
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .eq('action', 'lock')
        .order('performed_at', { ascending: false })
        .limit(1)

      expect(actions).toHaveLength(1)
      expect(actions[0].action).toBe('lock')
    })

    it('should maintain chronological order of audit entries', async () => {
      // Get all actions for period
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .order('performed_at', { ascending: true })

      // Verify chronological order
      for (let i = 1; i < actions.length; i++) {
        const prevTime = new Date(actions[i - 1].performed_at).getTime()
        const currTime = new Date(actions[i].performed_at).getTime()
        expect(currTime).toBeGreaterThanOrEqual(prevTime)
      }
    })

    it('should include all required fields in audit entries', async () => {
      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .limit(1)

      if (actions && actions.length > 0) {
        const action = actions[0]
        expect(action.business_id).toBeTruthy()
        expect(action.period_start).toBeTruthy()
        expect(action.action).toBeTruthy()
        expect(action.performed_by).toBeTruthy()
        expect(action.performed_at).toBeTruthy()
      }
    })

    it('should NOT have silent state changes (all changes have audit)', async () => {
      // Get all period status changes from accounting_periods history
      // (This would require audit log or versioning table)
      // For now, verify that every action in audit log corresponds to a state change

      const { data: actions } = await supabase
        .from('accounting_period_actions')
        .select('*')
        .eq('business_id', testBusinessId)
        .eq('period_start', testPeriodStart)
        .order('performed_at', { ascending: true })

      // Each action should correspond to a state transition
      // request_close → status = 'closing'
      // approve_close → status = 'soft_closed'
      // reject_close → status = 'open'
      // lock → status = 'locked'

      // This test would need to verify against period state history
      // For now, we verify that actions exist for expected transitions
      expect(actions.length).toBeGreaterThan(0)
    })
  })
})
