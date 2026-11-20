-- ============================================================================
-- 717 permissive-policy correction test
-- Verifies allow_all_* policies are gone, anon access is closed, audit/inventory
-- tables are append-only, and intentional public reference data stays read-only.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/rls_717_permissive_policies.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  t text;
  v boolean;
  n int;
  r record;
  private_tables text[] := ARRAY[
    'accounts','assets','audit_logs','bank_transactions','bill_items','bill_payments','bills',
    'credit_note_items','credit_notes','depreciation_entries','expense_categories',
    'reconciliation_periods','recurring_invoices','vat_returns','firm_business_claim_tokens',
    'product_modifiers','products_variants','receipt_settings','stock_history','stock_movements'
  ];
  public_tables text[] := ARRAY['lounge_packages','wht_rates'];
BEGIN
  -- No unconditional allow_all_* policy may remain in the reviewed scope.
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename = ANY(private_tables || public_tables)
    AND policyname LIKE 'allow_all_%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'allow_all_* policies remain: %', n;
  END IF;

  -- RLS enabled everywhere.
  FOREACH t IN ARRAY private_tables || public_tables LOOP
    SELECT c.relrowsecurity INTO v
    FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relname=t;
    IF v IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS not enabled on public.%', t;
    END IF;
  END LOOP;

  -- Private tables: anon has no SELECT/INSERT/UPDATE/DELETE.
  FOREACH t IN ARRAY private_tables LOOP
    IF has_table_privilege('anon', format('public.%I',t),'SELECT')
       OR has_table_privilege('anon', format('public.%I',t),'INSERT')
       OR has_table_privilege('anon', format('public.%I',t),'UPDATE')
       OR has_table_privilege('anon', format('public.%I',t),'DELETE') THEN
      RAISE EXCEPTION 'anon retains a privilege on private table public.%', t;
    END IF;
  END LOOP;

  -- Public reference tables: anon SELECT only, no DML.
  FOREACH t IN ARRAY public_tables LOOP
    IF NOT has_table_privilege('anon', format('public.%I',t),'SELECT') THEN
      RAISE EXCEPTION 'anon cannot read public reference table public.%', t;
    END IF;
    IF has_table_privilege('anon', format('public.%I',t),'INSERT')
       OR has_table_privilege('anon', format('public.%I',t),'UPDATE')
       OR has_table_privilege('anon', format('public.%I',t),'DELETE') THEN
      RAISE EXCEPTION 'anon has DML on public reference table public.%', t;
    END IF;
  END LOOP;

  -- Append-only audit log: authenticated SELECT only.
  IF NOT has_table_privilege('authenticated','public.audit_logs','SELECT') THEN
    RAISE EXCEPTION 'authenticated cannot read audit_logs';
  END IF;
  IF has_table_privilege('authenticated','public.audit_logs','INSERT')
     OR has_table_privilege('authenticated','public.audit_logs','UPDATE')
     OR has_table_privilege('authenticated','public.audit_logs','DELETE') THEN
    RAISE EXCEPTION 'authenticated has DML on audit_logs';
  END IF;

  -- Stock history read-only; stock movements insert-only.
  IF has_table_privilege('authenticated','public.stock_history','INSERT')
     OR has_table_privilege('authenticated','public.stock_history','UPDATE')
     OR has_table_privilege('authenticated','public.stock_history','DELETE') THEN
    RAISE EXCEPTION 'authenticated has DML on stock_history';
  END IF;
  IF has_table_privilege('authenticated','public.stock_movements','UPDATE')
     OR has_table_privilege('authenticated','public.stock_movements','DELETE') THEN
    RAISE EXCEPTION 'authenticated can modify/delete stock_movements';
  END IF;

  -- Claim tokens are service-only.
  IF has_table_privilege('authenticated','public.firm_business_claim_tokens','SELECT')
     OR has_table_privilege('authenticated','public.firm_business_claim_tokens','INSERT')
     OR has_table_privilege('authenticated','public.firm_business_claim_tokens','UPDATE')
     OR has_table_privilege('authenticated','public.firm_business_claim_tokens','DELETE') THEN
    RAISE EXCEPTION 'authenticated retains access to firm_business_claim_tokens';
  END IF;

  -- Public reference tables: authenticated SELECT only.
  FOREACH t IN ARRAY public_tables LOOP
    IF has_table_privilege('authenticated', format('public.%I',t),'INSERT')
       OR has_table_privilege('authenticated', format('public.%I',t),'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I',t),'DELETE') THEN
      RAISE EXCEPTION 'authenticated has DML on public reference table public.%', t;
    END IF;
  END LOOP;

  -- No policy on the reviewed tables may be attached to anon/PUBLIC, except the
  -- intentionally public lounge_packages/wht_rates SELECT policies.
  FOR r IN
    SELECT tablename, policyname, roles
    FROM pg_policies
    WHERE schemaname='public' AND tablename = ANY(private_tables || public_tables)
  LOOP
    IF r.tablename !~ '^(lounge_packages|wht_rates)$'
       AND 'anon' = ANY(r.roles) THEN
      RAISE EXCEPTION 'private policy %.% targets anon', r.tablename, r.policyname;
    END IF;
  END LOOP;

  -- No unconditional true policy may remain on private tables.
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename = ANY(private_tables)
    AND (qual = 'true' OR with_check = 'true');
  IF n <> 0 THEN
    RAISE EXCEPTION 'unconditional true policy remains on a private table: %', n;
  END IF;

  -- Real anon SELECT checks.
  FOREACH t IN ARRAY private_tables LOOP
    BEGIN
      EXECUTE 'SET LOCAL ROLE anon';
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
      RAISE EXCEPTION 'anon SELECT succeeded on public.%', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

ROLLBACK;
