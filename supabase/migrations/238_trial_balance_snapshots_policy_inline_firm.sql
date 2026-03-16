-- ============================================================================
-- Phase 10 follow-up: replace trial_balance_snapshots policy with inline firm check
-- ============================================================================
-- If 237 was applied with can_accountant_access_business(), the policy still
-- references the missing function. This migration drops and recreates the
-- policy using only inline SQL (accounting_firm_users + accounting_firm_clients).
-- ============================================================================

DROP POLICY IF EXISTS "read_trial_balance_snapshots" ON trial_balance_snapshots;

CREATE POLICY "read_trial_balance_snapshots"
  ON trial_balance_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = trial_balance_snapshots.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = trial_balance_snapshots.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('admin', 'accountant')
    )
    OR EXISTS (
      SELECT 1 FROM accounting_firm_users afu
      INNER JOIN accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
  );

COMMENT ON POLICY "read_trial_balance_snapshots" ON trial_balance_snapshots IS
  'Phase 10: Read-only. Owner, employee (admin/accountant), or firm with delegation can SELECT.';
