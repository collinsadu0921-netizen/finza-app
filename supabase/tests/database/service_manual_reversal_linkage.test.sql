-- ============================================================================
-- Database tests for migration 585 — Service manual journal reversal linkage
-- Runs inside one transaction and rolls back all data.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/service_manual_reversal_linkage.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_period UUID := gen_random_uuid();
  v_expense UUID := gen_random_uuid();
  v_cash UUID := gen_random_uuid();
  v_draft UUID;
  v_je UUID;
  v_legacy_rev UUID := gen_random_uuid();
  v_returned UUID;
  v_count INT;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need an auth.users row';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (
    id, name, address_country, default_currency, industry, owner_id,
    service_subscription_tier, service_subscription_status, billing_exempt,
    created_at, updated_at
  ) VALUES (
    v_biz, '585 Reversal Linkage Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  INSERT INTO public.accounts (id, business_id, name, code, type, sub_type, is_system)
  VALUES
    (v_expense, v_biz, 'Operating Expenses', '5100', 'expense', NULL, TRUE),
    (v_cash, v_biz, 'Cash', '1000', 'asset', NULL, TRUE);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES (v_period, v_biz, DATE '2026-10-01', DATE '2026-10-31', 'open');

  -- Create and post a Service manual journal.
  v_draft := public.create_service_manual_journal_draft(
    v_biz, DATE '2026-10-24', 'Legacy generic reversal test', 'LGR-585',
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense, 'debit', 1, 'credit', 0),
      jsonb_build_object('account_id', v_cash, 'debit', 0, 'credit', 1)
    ),
    'test-585-legacy'
  );
  v_je := public.post_service_manual_journal_draft(v_draft);

  -- Simulate the historical generic GL reversal form: reference_type
  -- 'reversal' + reference_id = original, but reverses_entry_id NULL.
  INSERT INTO public.journal_entries (
    id, business_id, date, description, reference, reference_type, reference_id,
    reverses_entry_id, source_type, source_id, period_id, currency, fx_rate,
    created_by, posted_by, posted_by_accountant_id, posting_source,
    is_adjustment, adjustment_reason
  ) VALUES (
    v_legacy_rev, v_biz, DATE '2026-10-24',
    'Reversal of JE ' || left(v_je::text, 8) || ': legacy generic reversal',
    'LGR-585', 'reversal', v_je,
    NULL, NULL, NULL, v_period, 'GHS', 1,
    v_owner, v_owner, v_owner, 'service_manual',
    TRUE, 'legacy generic reversal'
  );

  -- 1) The insert trigger links the Service draft to the generic reversal.
  IF NOT EXISTS (
    SELECT 1
    FROM public.service_manual_journal_drafts
    WHERE id = v_draft
      AND status = 'reversed'
      AND reversal_journal_entry_id = v_legacy_rev
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: generic reversal did not link the Service draft';
  END IF;

  -- 2) The Service RPC recognises the legacy reversal by reference_id and
  --    returns it without creating another ledger entry.
  v_returned := public.reverse_service_manual_journal(
    v_je, DATE '2026-10-25', 'Recognise existing generic reversal'
  );

  IF v_returned <> v_legacy_rev THEN
    RAISE EXCEPTION 'TEST_FAILED: legacy generic reversal was not recognised';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE reverses_entry_id = v_je
     OR (reference_type = 'reversal' AND reference_id = v_je);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: reconciliation created % reversal rows', v_count;
  END IF;

  -- 3) A second reversal of the same Service manual entry is rejected at the
  --    database boundary.
  BEGIN
    INSERT INTO public.journal_entries (
      id, business_id, date, description, reference, reference_type, reference_id,
      reverses_entry_id, source_type, source_id, period_id, currency, fx_rate,
      created_by, posted_by, posted_by_accountant_id, posting_source,
      is_adjustment, adjustment_reason
    ) VALUES (
      gen_random_uuid(), v_biz, DATE '2026-10-25',
      'Second reversal attempt', 'LGR-585', 'reversal', v_je,
      v_je, 'service_manual_reversal', v_je, v_period, 'GHS', 1,
      v_owner, v_owner, v_owner, 'service_manual',
      TRUE, 'second reversal attempt'
    );
    RAISE EXCEPTION 'TEST_FAILED: second reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ALREADY_REVERSED%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong duplicate-guard error: %', SQLERRM;
    END IF;
  END;

  -- 4) The guard also rejects a second reversal that only sets
  --    reverses_entry_id (no reference_id), so both linkage forms are covered.
  BEGIN
    INSERT INTO public.journal_entries (
      id, business_id, date, description, reference, reference_type, reference_id,
      reverses_entry_id, source_type, source_id, period_id, currency, fx_rate,
      created_by, posted_by, posted_by_accountant_id, posting_source,
      is_adjustment, adjustment_reason
    ) VALUES (
      gen_random_uuid(), v_biz, DATE '2026-10-25',
      'Second reversal attempt via linkage', 'LGR-585', 'manual', NULL,
      v_je, NULL, NULL, v_period, 'GHS', 1,
      v_owner, v_owner, v_owner, 'service_manual',
      FALSE, NULL
    );
    RAISE EXCEPTION 'TEST_FAILED: second linkage-only reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ALREADY_REVERSED%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong linkage-only duplicate-guard error: %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'PASS: 585 Service manual reversal linkage database tests';
END $$;

ROLLBACK;
