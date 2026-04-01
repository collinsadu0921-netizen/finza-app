-- Managers have reports.view in the app; dashboard/service metrics can trigger
-- generate_trial_balance as the authenticated user (invoker), which INSERT/UPDATEs
-- trial_balance_snapshots. Prior policies only allowed admin/accountant employees.

DROP POLICY IF EXISTS "read_trial_balance_snapshots" ON public.trial_balance_snapshots;
CREATE POLICY "read_trial_balance_snapshots"
  ON public.trial_balance_snapshots
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
        AND bu.role IN ('admin', 'accountant', 'manager')
    )
    OR EXISTS (
      SELECT 1 FROM accounting_firm_users afu
      INNER JOIN accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
    OR EXISTS (
      SELECT 1 FROM accounting_firm_users afu
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = trial_balance_snapshots.business_id
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "read_trial_balance_snapshots" ON public.trial_balance_snapshots IS
  'Owner, employee (admin/accountant/manager), or firm via accounting_firm_clients or effective firm_client_engagements.';

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
        AND bu.role IN ('admin', 'accountant', 'manager')
    )
    OR EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      INNER JOIN public.accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
  );

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
        AND bu.role IN ('admin', 'accountant', 'manager')
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
        AND bu.role IN ('admin', 'accountant', 'manager')
    )
    OR EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      INNER JOIN public.accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
  );

COMMENT ON POLICY "insert_trial_balance_snapshots" ON public.trial_balance_snapshots IS
  'Snapshot generation: owner, admin/accountant/manager employee, or firm client link.';
COMMENT ON POLICY "update_trial_balance_snapshots" ON public.trial_balance_snapshots IS
  'ON CONFLICT DO UPDATE in generate_trial_balance: same authority as insert.';
