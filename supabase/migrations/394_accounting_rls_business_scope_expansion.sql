-- Phase 2: Expand accounting table RLS with explicit business scoping.
-- Uses app.current_business_id to avoid implicit workspace inference.

DO $$
BEGIN
  -- journal_entries: direct business_id ownership
  IF to_regclass('public.journal_entries') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_journal_entries ON public.journal_entries';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_journal_entries
      ON public.journal_entries
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
    $POLICY$;
  END IF;

  -- accounting_periods: direct business_id ownership
  IF to_regclass('public.accounting_periods') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_accounting_periods ON public.accounting_periods';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_accounting_periods
      ON public.accounting_periods
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
    $POLICY$;
  END IF;

  -- accounting_opening_balances: direct business_id ownership
  IF to_regclass('public.accounting_opening_balances') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.accounting_opening_balances ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_opening_balances ON public.accounting_opening_balances';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_opening_balances
      ON public.accounting_opening_balances
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
    $POLICY$;
  END IF;

  -- trial_balance_snapshots: direct business_id ownership
  IF to_regclass('public.trial_balance_snapshots') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.trial_balance_snapshots ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_trial_balance_snapshots ON public.trial_balance_snapshots';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_trial_balance_snapshots
      ON public.trial_balance_snapshots
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
    $POLICY$;
  END IF;

  -- afs_runs: direct business_id ownership
  IF to_regclass('public.afs_runs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.afs_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_afs_runs ON public.afs_runs';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_afs_runs
      ON public.afs_runs
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND business_id = current_setting('app.current_business_id', true)::uuid
      )
    $POLICY$;
  END IF;

  -- afs_documents: scope through parent afs_runs.business_id
  IF to_regclass('public.afs_documents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.afs_documents ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_afs_documents ON public.afs_documents';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_afs_documents
      ON public.afs_documents
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.afs_runs r
          WHERE r.id = afs_documents.afs_run_id
            AND r.business_id = current_setting('app.current_business_id', true)::uuid
        )
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.afs_runs r
          WHERE r.id = afs_documents.afs_run_id
            AND r.business_id = current_setting('app.current_business_id', true)::uuid
        )
      )
    $POLICY$;
  END IF;

  -- opening_balance_imports: scope through client_business_id
  IF to_regclass('public.opening_balance_imports') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.opening_balance_imports ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS accounting_business_scope_opening_balance_imports ON public.opening_balance_imports';
    EXECUTE $POLICY$
      CREATE POLICY accounting_business_scope_opening_balance_imports
      ON public.opening_balance_imports
      FOR ALL
      USING (
        auth.uid() IS NOT NULL
        AND client_business_id = current_setting('app.current_business_id', true)::uuid
      )
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND client_business_id = current_setting('app.current_business_id', true)::uuid
      )
    $POLICY$;
  END IF;
END $$;
