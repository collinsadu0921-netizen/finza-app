-- ============================================================================
-- Database tests for migration 583 — Service manual journals
-- Runs inside one transaction and rolls back all data.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/service_manual_journals.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_other UUID := gen_random_uuid();
  v_biz UUID := gen_random_uuid();
  v_biz2 UUID := gen_random_uuid();
  v_open_period UUID := gen_random_uuid();
  v_locked_period UUID := gen_random_uuid();
  v_expense UUID := gen_random_uuid();
  v_liability UUID := gen_random_uuid();
  v_control UUID := gen_random_uuid();
  v_inactive UUID := gen_random_uuid();
  v_foreign UUID := gen_random_uuid();
  v_draft UUID;
  v_je UUID;
  v_je_retry UUID;
  v_rev UUID;
  v_rev_retry UUID;
  v_count INT;
  v_dr NUMERIC;
  v_cr NUMERIC;
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
  ) VALUES
    (v_biz, '583 Service Manual Test', 'Ghana', 'GHS', 'service', v_owner,
     'business', 'active', TRUE, NOW(), NOW()),
    (v_biz2, '583 Other Business', 'Ghana', 'GHS', 'service', v_owner,
     'business', 'active', TRUE, NOW(), NOW());

  INSERT INTO public.accounts (id, business_id, name, code, type, sub_type, is_system)
  VALUES
    (v_expense, v_biz, 'Operating Expenses', '5100', 'expense', NULL, TRUE),
    (v_liability, v_biz, 'Long-term Bank Loan', '2310', 'liability', 'loan', TRUE),
    (v_control, v_biz, 'VAT Payable', '2100', 'liability', NULL, TRUE),
    (v_inactive, v_biz, 'Inactive Expense', '5101', 'expense', NULL, TRUE),
    (v_foreign, v_biz2, 'Foreign Expense', '5100', 'expense', NULL, TRUE);

  UPDATE public.accounts SET deleted_at = NOW() WHERE id = v_inactive;

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES
    (v_open_period, v_biz, DATE '2026-08-01', DATE '2026-08-31', 'open'),
    (v_locked_period, v_biz, DATE '2026-09-01', DATE '2026-09-30', 'locked');

  -- 1) Unbalanced entry is rejected
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz, DATE '2026-08-20', 'Unbalanced test', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_expense, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 90)
      ),
      'test-unbalanced'
    );
    RAISE EXCEPTION 'TEST_FAILED: unbalanced entry was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_UNBALANCED%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong unbalanced error: %', SQLERRM;
    END IF;
  END;

  -- 2) Foreign-business account is rejected
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz, DATE '2026-08-20', 'Foreign account test', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_foreign, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100)
      ),
      'test-foreign'
    );
    RAISE EXCEPTION 'TEST_FAILED: foreign account was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ACCOUNT_INVALID%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong foreign-account error: %', SQLERRM;
    END IF;
  END;

  -- 3) Inactive account is rejected
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz, DATE '2026-08-20', 'Inactive account test', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_inactive, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100)
      ),
      'test-inactive'
    );
    RAISE EXCEPTION 'TEST_FAILED: inactive account was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ACCOUNT_INACTIVE%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong inactive-account error: %', SQLERRM;
    END IF;
  END;

  -- 4) Control account is rejected
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz, DATE '2026-08-20', 'Control account test', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_control, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100)
      ),
      'test-control'
    );
    RAISE EXCEPTION 'TEST_FAILED: control account was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong control-account error: %', SQLERRM;
    END IF;
  END;

  -- 5) Locked period is rejected
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz, DATE '2026-09-15', 'Locked period test', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_expense, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100)
      ),
      'test-locked'
    );
    RAISE EXCEPTION 'TEST_FAILED: locked period was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_PERIOD_NOT_OPEN%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong locked-period error: %', SQLERRM;
    END IF;
  END;

  -- 6) Unauthorized direct RPC call is rejected
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz, DATE '2026-08-20', 'Unauthorized direct RPC', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_expense, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100)
      ),
      'test-unauthorized'
    );
    RAISE EXCEPTION 'TEST_FAILED: unauthorized direct RPC was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong unauthorized error: %', SQLERRM;
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- 7) Valid draft, idempotent post, ledger visibility, and reversal
  v_draft := public.create_service_manual_journal_draft(
    v_biz, DATE '2026-08-20', 'Accrue unbilled service revenue', 'ACC-583',
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense, 'debit', 100, 'credit', 0, 'memo', 'Debit'),
      jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100, 'memo', 'Credit')
    ),
    'test-valid'
  );

  -- Same idempotency key returns the same draft.
  IF public.create_service_manual_journal_draft(
    v_biz, DATE '2026-08-20', 'Accrue unbilled service revenue', 'ACC-583',
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense, 'debit', 100, 'credit', 0, 'memo', 'Debit'),
      jsonb_build_object('account_id', v_liability, 'debit', 0, 'credit', 100, 'memo', 'Credit')
    ),
    'test-valid'
  ) <> v_draft THEN
    RAISE EXCEPTION 'TEST_FAILED: idempotent draft create returned a different id';
  END IF;

  v_je := public.post_service_manual_journal_draft(v_draft);
  v_je_retry := public.post_service_manual_journal_draft(v_draft);
  IF v_je <> v_je_retry THEN
    RAISE EXCEPTION 'TEST_FAILED: duplicate post created a second journal entry';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_count, v_dr, v_cr
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_je;

  IF v_count <> 2 OR v_dr <> v_cr THEN
    RAISE EXCEPTION 'TEST_FAILED: posted journal is not a balanced two-line entry';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE id = v_je
      AND source_type = 'service_manual'
      AND reference = 'ACC-583'
      AND period_id = v_open_period
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: journal metadata/source is missing';
  END IF;

  v_rev := public.reverse_service_manual_journal(
    v_je, DATE '2026-08-21', 'Correct duplicate accrual'
  );
  v_rev_retry := public.reverse_service_manual_journal(
    v_je, DATE '2026-08-21', 'Correct duplicate accrual'
  );
  IF v_rev <> v_rev_retry THEN
    RAISE EXCEPTION 'TEST_FAILED: duplicate reversal created a second journal entry';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE id = v_rev
      AND source_type = 'service_manual_reversal'
      AND reverses_entry_id = v_je
      AND reference_type = 'reversal'
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal link is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE id = v_je) THEN
    RAISE EXCEPTION 'TEST_FAILED: original journal was not preserved';
  END IF;

  IF (SELECT status FROM public.service_manual_journal_drafts WHERE id = v_draft) <> 'reversed' THEN
    RAISE EXCEPTION 'TEST_FAILED: draft was not marked reversed';
  END IF;

  -- 8) Ledger/report visibility: both entries are in the business ledger and
  --    the reversal mirrors the original.
  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE business_id = v_biz
    AND id IN (v_je, v_rev)
    AND source_type IN ('service_manual', 'service_manual_reversal');

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST_FAILED: ledger/report source rows are missing';
  END IF;

  -- 9) Live grant boundary: anon cannot execute the RPCs or read drafts.
  IF has_function_privilege('anon', 'public.create_service_manual_journal_draft(uuid,date,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAILED: anon can execute create_service_manual_journal_draft';
  END IF;
  IF has_function_privilege('anon', 'public.post_service_manual_journal_draft(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAILED: anon can execute post_service_manual_journal_draft';
  END IF;
  IF has_function_privilege('anon', 'public.reverse_service_manual_journal(uuid,date,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAILED: anon can execute reverse_service_manual_journal';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_service_manual_journal_draft(uuid,date,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAILED: authenticated cannot execute create_service_manual_journal_draft';
  END IF;
  IF has_table_privilege('anon', 'public.service_manual_journal_drafts', 'SELECT') THEN
    RAISE EXCEPTION 'TEST_FAILED: anon can read service manual journal drafts';
  END IF;

  RAISE NOTICE 'PASS: 583 Service manual journal database tests';
END $$;

ROLLBACK;
