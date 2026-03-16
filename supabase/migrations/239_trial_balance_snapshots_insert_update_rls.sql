-- ============================================================================
-- Fix: permission denied for table trial_balance_snapshots (P&L / Balance Sheet)
-- ============================================================================
-- Failure: generate_trial_balance (invoker = authenticated) runs INSERT ...
-- ON CONFLICT (period_id) DO UPDATE. Role authenticated had SELECT (237) but
-- INSERT was never granted; UPDATE was explicitly revoked (222). This
-- migration grants INSERT and UPDATE to authenticated and adds RLS policies
-- so snapshot generation runs safely under invoker rules (same authority as read).
-- ============================================================================

-- 1. Grant INSERT and UPDATE to authenticated (required for generate_trial_balance as invoker)
GRANT INSERT ON TABLE public.trial_balance_snapshots TO authenticated;
GRANT UPDATE ON TABLE public.trial_balance_snapshots TO authenticated;

-- 2. RLS policy: allow INSERT when user has accounting authority for the business being inserted
--    Same authority model as read_trial_balance_snapshots: owner OR employee (admin/accountant) OR firm.
DROP POLICY IF EXISTS "insert_trial_balance_snapshots" ON public.trial_balance_snapshots;
CREATE POLICY "insert_trial_balance_snapshots"
  ON public.trial_balance_snapshots
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = trial_balance_snapshots.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = trial_balance_snapshots.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('admin', 'accountant')
    )
    OR EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      INNER JOIN public.accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
  );

-- 3. RLS policy: allow UPDATE when user has accounting authority for the row's business
DROP POLICY IF EXISTS "update_trial_balance_snapshots" ON public.trial_balance_snapshots;
CREATE POLICY "update_trial_balance_snapshots"
  ON public.trial_balance_snapshots
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = trial_balance_snapshots.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = trial_balance_snapshots.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('admin', 'accountant')
    )
    OR EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      INNER JOIN public.accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = trial_balance_snapshots.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = trial_balance_snapshots.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('admin', 'accountant')
    )
    OR EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      INNER JOIN public.accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
  );

COMMENT ON POLICY "insert_trial_balance_snapshots" ON public.trial_balance_snapshots IS
  'Phase 10: Allow snapshot generation by owner/employee/firm. Same authority as read.';
COMMENT ON POLICY "update_trial_balance_snapshots" ON public.trial_balance_snapshots IS
  'Phase 10: Allow ON CONFLICT DO UPDATE in generate_trial_balance. Same authority as read.';
