-- ============================================================================
-- 716 RLS coverage test
-- Verifies RLS is enabled, anon has no privileges, policies never target
-- anon/public, service_role retains access, and protected users fields are
-- not readable by authenticated.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/rls_716_all_public_tables.test.sql
--
-- Read-only for application data. Runs in a transaction and rolls back.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  t text;
  v boolean;
  n int;
  r record;
  tables text[] := ARRAY[
    'accountant_client_access','accountant_firm_users','accountant_firms',
    'accounting_adjustment_audit','accounting_adjustments','accounting_exceptions',
    'accounting_invariant_runs','accounting_period_actions','adjusting_journal_drafts',
    'backfill_audit_log','business_users','cash_drops','cashier_sessions','categories',
    'chart_of_accounts','chart_of_accounts_control_map','clients','coa_mapping_lines',
    'customer_notes','diagnostic_journal_lines_log','internal_alerts','items',
    'opening_balance_batches','opening_balance_lines','overrides','parked_sales',
    'period_close_attempts','quick_keys','reconciliation_resolutions','register_variances',
    'retail_cost_updates','retail_posting_debug_log','rider_deliveries','riders',
    'salon_services','users'
  ];
  deny_tables text[] := ARRAY[
    'accountant_client_access','accountant_firm_users','accountant_firms',
    'accounting_adjustments','accounting_invariant_runs','adjusting_journal_drafts',
    'backfill_audit_log','clients','diagnostic_journal_lines_log','retail_cost_updates',
    'retail_posting_debug_log','salon_services'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    SELECT c.relrowsecurity INTO v
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = t;

    IF v IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS not enabled on public.%', t;
    END IF;

    IF has_table_privilege('anon', format('public.%I', t), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', t), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', t), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', t), 'DELETE') THEN
      RAISE EXCEPTION 'anon retains a table privilege on public.%', t;
    END IF;

    IF NOT has_table_privilege('service_role', format('public.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'service_role cannot read public.%', t;
    END IF;
  END LOOP;

  -- Policies must not be attached to anon or PUBLIC.
  FOR r IN
    SELECT tablename, policyname, roles
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(tables)
  LOOP
    IF 'anon' = ANY(r.roles) OR 'public' = ANY(r.roles) THEN
      RAISE EXCEPTION 'policy %.% targets anon/public', r.tablename, r.policyname;
    END IF;
  END LOOP;

  -- Legacy/internal tables must have no policies at all.
  FOREACH t IN ARRAY deny_tables LOOP
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename=t;
    IF n <> 0 THEN
      RAISE EXCEPTION 'internal table public.% unexpectedly has % policies', t, n;
    END IF;
  END LOOP;

  -- No client write policies on read-only tables.
  FOREACH t IN ARRAY ARRAY['items','overrides','coa_mapping_lines','accounting_adjustment_audit','accounting_period_actions','opening_balance_batches','opening_balance_lines','period_close_attempts'] LOOP
    IF has_table_privilege('authenticated', format('public.%I', t), 'DELETE') THEN
      RAISE EXCEPTION 'authenticated unexpectedly has DELETE on public.%', t;
    END IF;
  END LOOP;

  -- business_users must retain the 580 shape.
  SELECT relforcerowsecurity INTO v
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname='public' AND c.relname='business_users';
  IF v IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'business_users must use FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='business_users';
  IF n <> 4 THEN
    RAISE EXCEPTION 'business_users expected 4 policies, found %', n;
  END IF;

  -- pin_code must not be readable by authenticated.
  IF has_column_privilege('authenticated', 'public.users', 'pin_code', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can read users.pin_code';
  END IF;
  IF has_column_privilege('authenticated', 'public.users', 'email', 'SELECT') = false THEN
    RAISE EXCEPTION 'authenticated cannot read users.email';
  END IF;

  -- Real anon SELECT must be denied on every table.
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE 'SET LOCAL ROLE anon';
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
      RAISE EXCEPTION 'anon SELECT succeeded on public.%', t;
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END LOOP;
END $$;

ROLLBACK;
