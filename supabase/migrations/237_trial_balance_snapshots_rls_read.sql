-- ============================================================================
-- Phase 10: trial_balance_snapshots read permission (permission regression fix)
-- ============================================================================
-- trial_balance_snapshots is the canonical source for Balance Sheet, P&L, Trial Balance.
-- Reports are read-only for business owners/employees/firm; RLS was not aligned.
-- This migration: enable RLS, add read-only SELECT policy, grant SELECT to authenticated.
-- No schema change, no new tables, no write access.
-- ============================================================================

-- 1. Grant SELECT to authenticated (required for RLS to apply; table was created without it)
GRANT SELECT ON TABLE trial_balance_snapshots TO authenticated;

-- 2. Enable RLS (table was never under RLS; without this, policy would not apply)
ALTER TABLE trial_balance_snapshots ENABLE ROW LEVEL SECURITY;

-- 3. Read-only policy: allow SELECT when user has accounting read authority for the business
--    Matches checkAccountingAuthority: owner OR employee (admin/accountant) OR firm delegation.
--    Firm check inlined (accounting_firm_users + accounting_firm_clients) to avoid depending on can_accountant_access_business.
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
  'Phase 10: Read-only. Owner, employee (admin/accountant), or firm with delegation can SELECT. No INSERT/UPDATE/DELETE.';
