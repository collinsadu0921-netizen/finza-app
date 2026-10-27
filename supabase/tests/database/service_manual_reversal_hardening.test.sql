-- ============================================================================
-- Database tests for migration 599 — Service manual-journal reversal hardening
-- Runs inside one transaction and rolls back all data.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/service_manual_reversal_hardening.test.sql
--
-- Covers:
--   * 2150 WHT Payable is a non-postable control account for manual journals
--   * cross-business reversals are rejected on every path
--   * rejected attempts leave both businesses' journals and drafts unchanged
--   * repeated Service reversals return one ledger entry and one audit event
--   * General Ledger delegation uses the Service rules and trusted metadata
--   * owner/admin/accountant allowed; read-only, manager, non-member denied
--   * tier, period, date and reason gates
--   * exact reversal ledger links and balanced report totals
--   * non-manual duplicates use REVERSAL_ALREADY_EXISTS and action 'reversal'
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_admin UUID;
  v_acct UUID;
  v_ro UUID;
  v_mgr UUID;
  v_outsider UUID;

  v_biz1 UUID := gen_random_uuid();
  v_biz2 UUID := gen_random_uuid();
  v_pro UUID := gen_random_uuid();

  v_period1 UUID := gen_random_uuid();
  v_locked_period1 UUID := gen_random_uuid();
  v_period2 UUID := gen_random_uuid();
  v_pro_period UUID := gen_random_uuid();

  v_cash1 UUID := gen_random_uuid();
  v_exp1 UUID := gen_random_uuid();
  v_wht1 UUID := gen_random_uuid();
  v_cash2 UUID := gen_random_uuid();
  v_exp2 UUID := gen_random_uuid();
  v_pcash UUID := gen_random_uuid();
  v_pexp UUID := gen_random_uuid();

  v_draft1 UUID;
  v_je1 UUID;
  v_rev1 UUID;
  v_rev1_retry UUID;
  v_draft2 UUID;
  v_je2 UUID;
  v_rev2 UUID;
  v_draft3 UUID;
  v_je3 UUID;
  v_draft4 UUID;
  v_je4 UUID;
  v_draft5 UUID;
  v_je5 UUID;
  v_rev5 UUID;
  v_generic1 UUID;
  v_generic_rev UUID;

  v_status_before TEXT;
  v_rev_before UUID;
  v_n1 INT;
  v_n2 INT;
  v_audit INT;
  v_val NUMERIC;
  v_denied_role TEXT;
  v_denied_user UUID;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at OFFSET 1 LIMIT 1;
  SELECT id INTO v_acct FROM auth.users ORDER BY created_at OFFSET 2 LIMIT 1;
  SELECT id INTO v_ro FROM auth.users ORDER BY created_at OFFSET 3 LIMIT 1;
  SELECT id INTO v_mgr FROM auth.users ORDER BY created_at OFFSET 4 LIMIT 1;
  SELECT id INTO v_outsider FROM auth.users ORDER BY created_at OFFSET 5 LIMIT 1;

  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need at least 6 auth.users rows';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (
    id, name, address_country, default_currency, industry, owner_id,
    service_subscription_tier, service_subscription_status, billing_exempt,
    created_at, updated_at
  ) VALUES
    (v_biz1, '599 Hardening Business', 'Ghana', 'GHS', 'service', v_owner,
     'business', 'active', TRUE, NOW(), NOW()),
    (v_biz2, '599 Other Business', 'Ghana', 'GHS', 'service', v_owner,
     'business', 'active', TRUE, NOW(), NOW()),
    (v_pro, '599 Professional Tenant', 'Ghana', 'GHS', 'service', v_owner,
     'professional', 'active', TRUE, NOW(), NOW());

  INSERT INTO public.business_users (business_id, user_id, role, accountant_readonly, created_at)
  VALUES
    (v_biz1, v_admin, 'admin', FALSE, NOW()),
    (v_biz1, v_acct, 'accountant', FALSE, NOW()),
    (v_biz1, v_ro, 'accountant', TRUE, NOW()),
    (v_biz1, v_mgr, 'manager', FALSE, NOW());

  -- Custom permission grant must not turn the manager into a manual-journal writer.
  UPDATE public.business_users
  SET custom_permissions = '{"granted":["accounting.view","accounting.write"]}'::jsonb
  WHERE business_id = v_biz1 AND user_id = v_mgr;

  INSERT INTO public.accounts (id, business_id, name, code, type, sub_type, is_system)
  VALUES
    (v_cash1, v_biz1, 'Cash', '1000', 'asset', NULL, TRUE),
    (v_exp1, v_biz1, 'Operating Expenses', '5100', 'expense', NULL, TRUE),
    (v_wht1, v_biz1, 'WHT Payable', '2150', 'liability', 'tax_payable', TRUE),
    (v_cash2, v_biz2, 'Cash', '1000', 'asset', NULL, TRUE),
    (v_exp2, v_biz2, 'Operating Expenses', '5100', 'expense', NULL, TRUE),
    (v_pcash, v_pro, 'Cash', '1000', 'asset', NULL, TRUE),
    (v_pexp, v_pro, 'Operating Expenses', '5100', 'expense', NULL, TRUE);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES
    (v_period1, v_biz1, DATE '2026-10-01', DATE '2026-10-31', 'open'),
    (v_locked_period1, v_biz1, DATE '2026-11-01', DATE '2026-11-30', 'locked'),
    (v_period2, v_biz2, DATE '2026-10-01', DATE '2026-10-31', 'open'),
    (v_pro_period, v_pro, DATE '2026-10-01', DATE '2026-10-31', 'open');

  -- --------------------------------------------------------------------------
  -- 1) 2150 WHT Payable is a control account and cannot be a manual line
  -- --------------------------------------------------------------------------
  IF NOT public.is_service_manual_control_account('2150', TRUE) THEN
    RAISE EXCEPTION 'TEST_FAILED: 2150 is not classified as a control account';
  END IF;

  IF (SELECT is_postable FROM public.accounts WHERE id = v_wht1) THEN
    RAISE EXCEPTION 'TEST_FAILED: 2150 is still marked postable';
  END IF;

  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz1, DATE '2026-10-15', 'WHT manual line test', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_exp1, 'debit', 50, 'credit', 0),
        jsonb_build_object('account_id', v_wht1, 'debit', 0, 'credit', 50)
      ),
      'test-599-wht'
    );
    RAISE EXCEPTION 'TEST_FAILED: 2150 was accepted as a manual-journal line';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong 2150 rejection: %', SQLERRM;
    END IF;
  END;

  -- --------------------------------------------------------------------------
  -- Setup: one posted manual journal in business 1
  -- --------------------------------------------------------------------------
  v_draft1 := public.create_service_manual_journal_draft(
    v_biz1, DATE '2026-10-15', '599 cross-business original', 'CR-599',
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 100, 'credit', 0, 'memo', 'Debit'),
      jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 100, 'memo', 'Credit')
    ),
    'test-599-original'
  );
  v_je1 := public.post_service_manual_journal_draft(v_draft1);

  SELECT status, reversal_journal_entry_id INTO v_status_before, v_rev_before
  FROM public.service_manual_journal_drafts WHERE id = v_draft1;

  SELECT COUNT(*) INTO v_n1 FROM public.journal_entries WHERE business_id = v_biz1;
  SELECT COUNT(*) INTO v_n2 FROM public.journal_entries WHERE business_id = v_biz2;

  -- --------------------------------------------------------------------------
  -- 2) Cross-business direct reversal insert is rejected
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.journal_entries (
      business_id, date, description, reference, reference_type, reference_id,
      reverses_entry_id, source_type, source_id, period_id, currency, fx_rate,
      created_by, posted_by, posted_by_accountant_id, posting_source,
      is_adjustment, adjustment_reason
    ) VALUES (
      v_biz2, DATE '2026-10-16', 'Cross-business reversal attempt',
      'CR-599', 'reversal', v_je1, v_je1,
      'service_manual_reversal', v_je1, v_period2, 'GHS', 1,
      v_owner, v_owner, v_owner, 'service_manual',
      TRUE, 'cross-business reversal attempt'
    );
    RAISE EXCEPTION 'TEST_FAILED: cross-business direct reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%REVERSAL_BUSINESS_MISMATCH%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong cross-business direct error: %', SQLERRM;
    END IF;
  END;

  -- --------------------------------------------------------------------------
  -- 3) Cross-business General Ledger posting path is rejected
  -- --------------------------------------------------------------------------
  BEGIN
    PERFORM public.post_journal_entry(
      p_business_id => v_biz2,
      p_date => DATE '2026-10-16',
      p_description => 'Cross-business GL reversal attempt',
      p_reference_type => 'reversal',
      p_reference_id => v_je1,
      p_lines => jsonb_build_array(
        jsonb_build_object('account_id', v_exp2, 'debit', 0, 'credit', 100),
        jsonb_build_object('account_id', v_cash2, 'debit', 100, 'credit', 0)
      ),
      p_is_adjustment => TRUE,
      p_adjustment_reason => 'cross-business GL reversal attempt',
      p_adjustment_ref => NULL::text,
      p_created_by => v_owner,
      p_entry_type => NULL::text,
      p_backfill_reason => NULL::text,
      p_backfill_actor => NULL::text,
      p_posted_by_accountant_id => v_owner,
      p_posting_source => 'accountant',
      p_is_revenue_correction => FALSE,
      p_reverses_entry_id => v_je1
    );
    RAISE EXCEPTION 'TEST_FAILED: cross-business GL reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%REVERSAL_BUSINESS_MISMATCH%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong cross-business GL error: %', SQLERRM;
    END IF;
  END;

  -- Rejected attempts must not change either business or the draft.
  IF (SELECT COUNT(*) FROM public.journal_entries WHERE business_id = v_biz1) <> v_n1 THEN
    RAISE EXCEPTION 'TEST_FAILED: original business journal count changed after rejection';
  END IF;
  IF (SELECT COUNT(*) FROM public.journal_entries WHERE business_id = v_biz2) <> v_n2 THEN
    RAISE EXCEPTION 'TEST_FAILED: other business journal count changed after rejection';
  END IF;
  IF (SELECT status FROM public.service_manual_journal_drafts WHERE id = v_draft1)
       IS DISTINCT FROM v_status_before
     OR (SELECT reversal_journal_entry_id FROM public.service_manual_journal_drafts WHERE id = v_draft1)
       IS DISTINCT FROM v_rev_before THEN
    RAISE EXCEPTION 'TEST_FAILED: draft changed after rejected cross-business attempts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE business_id = v_biz2 AND reference_id = v_je1
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: rejected cross-business reversal left a row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_manual_journal_drafts WHERE business_id = v_biz2
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: rejected cross-business reversal touched the other business draft';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE entity_id = v_je1
      AND action_type IN ('reversal', 'manual_journal.reversed')
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: rejected cross-business reversal wrote an audit event';
  END IF;

  -- --------------------------------------------------------------------------
  -- 4) Repeated Service reversal: one entry, one audit event, stable links
  -- --------------------------------------------------------------------------
  v_rev1 := public.reverse_service_manual_journal(
    v_je1, DATE '2026-10-17', 'Correct duplicate accrual 599'
  );
  v_rev1_retry := public.reverse_service_manual_journal(
    v_je1, DATE '2026-10-17', 'Correct duplicate accrual 599'
  );

  IF v_rev1 IS NULL OR v_rev1 <> v_rev1_retry THEN
    RAISE EXCEPTION 'TEST_FAILED: repeated Service reversal was not idempotent';
  END IF;

  SELECT COUNT(*) INTO v_n1
  FROM public.journal_entries
  WHERE business_id = v_biz1
    AND (
      reverses_entry_id = v_je1
      OR (reference_type = 'reversal' AND reference_id = v_je1)
    );
  IF v_n1 <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: % reversal rows exist after retry', v_n1;
  END IF;

  SELECT COUNT(*) INTO v_audit
  FROM public.audit_logs
  WHERE business_id = v_biz1
    AND action_type = 'manual_journal.reversed'
    AND entity_type = 'journal_entry'
    AND entity_id = v_je1;
  IF v_audit <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: expected 1 manual_journal.reversed audit row, got %', v_audit;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE business_id = v_biz1
      AND action_type = 'manual_journal.reversed'
      AND entity_id = v_je1
      AND (new_values->>'reversal_journal_entry_id')::uuid = v_rev1
      AND (new_values->>'business_id')::uuid = v_biz1
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal audit row missing its ledger link/business';
  END IF;

  -- A direct second reversal is rejected with the Service-specific error.
  BEGIN
    INSERT INTO public.journal_entries (
      business_id, date, description, reference, reference_type, reference_id,
      reverses_entry_id, source_type, source_id, period_id, currency, fx_rate,
      created_by, posted_by, posted_by_accountant_id, posting_source,
      is_adjustment, adjustment_reason
    ) VALUES (
      v_biz1, DATE '2026-10-18', 'Second Service reversal attempt',
      'CR-599', 'reversal', v_je1, v_je1,
      'service_manual_reversal', v_je1, v_period1, 'GHS', 1,
      v_owner, v_owner, v_owner, 'service_manual',
      TRUE, 'second reversal attempt'
    );
    RAISE EXCEPTION 'TEST_FAILED: second Service reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_ALREADY_REVERSED%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong Service duplicate error: %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO v_audit
  FROM public.audit_logs
  WHERE business_id = v_biz1
    AND action_type = 'manual_journal.reversed'
    AND entity_id = v_je1;
  IF v_audit <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: duplicate audit event after rejected retry (%)', v_audit;
  END IF;

  -- --------------------------------------------------------------------------
  -- 5) Draft linkage, exact mirror lines, and report balance
  -- --------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.service_manual_journal_drafts
    WHERE id = v_draft1
      AND status = 'reversed'
      AND reversal_journal_entry_id = v_rev1
      AND business_id = v_biz1
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: draft was not linked to the reversal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE id = v_rev1
      AND business_id = v_biz1
      AND source_type = 'service_manual_reversal'
      AND reference_type = 'reversal'
      AND reference_id = v_je1
      AND reverses_entry_id = v_je1
      AND period_id = v_period1
      AND is_adjustment = TRUE
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal ledger metadata is incorrect';
  END IF;

  IF EXISTS (
    (SELECT account_id, credit AS debit, debit AS credit, description
     FROM public.journal_entry_lines WHERE journal_entry_id = v_je1
     EXCEPT
     SELECT account_id, debit, credit, description
     FROM public.journal_entry_lines WHERE journal_entry_id = v_rev1)
    UNION ALL
    (SELECT account_id, debit, credit, description
     FROM public.journal_entry_lines WHERE journal_entry_id = v_rev1
     EXCEPT
     SELECT account_id, credit AS debit, debit AS credit, description
     FROM public.journal_entry_lines WHERE journal_entry_id = v_je1)
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal lines do not mirror the original exactly';
  END IF;

  SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)
  INTO v_val
  FROM public.journal_entry_lines l
  JOIN public.journal_entries je ON je.id = l.journal_entry_id
  WHERE je.business_id = v_biz1;
  IF v_val <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: business ledger is not balanced after reversal (%)', v_val;
  END IF;

  SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
  INTO v_val
  FROM public.journal_entry_lines l
  WHERE l.journal_entry_id IN (v_je1, v_rev1);
  IF v_val <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: original+reversal do not net to zero (%)', v_val;
  END IF;

  -- The General Ledger report must show both sides and net to zero.
  SELECT COUNT(*) INTO v_n1
  FROM public.get_general_ledger(
    v_biz1, v_cash1, DATE '2026-10-01', DATE '2026-10-31'
  ) g
  WHERE g.journal_entry_id IN (v_je1, v_rev1);
  IF v_n1 <> 2 THEN
    RAISE EXCEPTION 'TEST_FAILED: general ledger report shows % of 2 reversal lines', v_n1;
  END IF;

  SELECT COALESCE(SUM(g.debit - g.credit), 0) INTO v_val
  FROM public.get_general_ledger(
    v_biz1, v_cash1, DATE '2026-10-01', DATE '2026-10-31'
  ) g
  WHERE g.journal_entry_id IN (v_je1, v_rev1);
  IF v_val <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: general ledger cash movement does not net to zero (%)', v_val;
  END IF;

  -- --------------------------------------------------------------------------
  -- 6) General Ledger delegation as an authorized Service admin
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_draft2 := public.create_service_manual_journal_draft(
    v_biz1, DATE '2026-10-15', '599 GL delegated original', 'GL-599',
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 75, 'credit', 0),
      jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 75)
    ),
    'test-599-gl'
  );
  v_je2 := public.post_service_manual_journal_draft(v_draft2);

  v_rev2 := public.reverse_service_manual_journal_with_request_metadata(
    v_je2, DATE '2026-10-18', 'Reverse from General Ledger 599',
    v_admin, '198.51.100.21', 'JestGeneralAgent/2.0'
  );

  IF v_rev2 IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: Service admin GL reversal returned no id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_manual_journal_drafts
    WHERE id = v_draft2 AND status = 'reversed'
      AND reversal_journal_entry_id = v_rev2
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: GL reversal did not link the Service draft';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE business_id = v_biz1
      AND action_type = 'manual_journal.reversed'
      AND entity_id = v_je2
      AND user_id = v_admin
      AND ip_address = '198.51.100.21'
      AND user_agent = 'JestGeneralAgent/2.0'
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: GL reversal audit metadata is missing';
  END IF;

  -- Retry through the ledger wrapper stays stable.
  IF public.reverse_service_manual_journal_with_request_metadata(
       v_je2, DATE '2026-10-18', 'Reverse from General Ledger 599',
       v_admin, '198.51.100.21', 'JestGeneralAgent/2.0'
     ) <> v_rev2 THEN
    RAISE EXCEPTION 'TEST_FAILED: GL retry returned a different reversal';
  END IF;

  SELECT COUNT(*) INTO v_audit
  FROM public.audit_logs
  WHERE business_id = v_biz1
    AND action_type = 'manual_journal.reversed'
    AND entity_id = v_je2;
  IF v_audit <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: GL retry wrote % audit rows', v_audit;
  END IF;

  -- --------------------------------------------------------------------------
  -- 7) Roles: admin/accountant allowed; read-only, manager, outsider denied
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_draft3 := public.create_service_manual_journal_draft(
    v_biz1, DATE '2026-10-15', '599 role gate original', 'ROLE-599',
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 40, 'credit', 0),
      jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 40)
    ),
    'test-599-roles'
  );
  v_je3 := public.post_service_manual_journal_draft(v_draft3);

  FOR v_denied_role, v_denied_user IN
    SELECT * FROM (VALUES
      ('readonly', v_ro),
      ('manager', v_mgr),
      ('outsider', v_outsider)
    ) t(r, u)
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_denied_user::text, true);
    BEGIN
      PERFORM public.reverse_service_manual_journal(
        v_je3, DATE '2026-10-17', 'Denied role reversal attempt'
      );
      RAISE EXCEPTION 'TEST_FAILED: denied role % reversed a manual journal', v_denied_role;
    EXCEPTION WHEN others THEN
      IF SQLERRM NOT LIKE '%SERVICE_MANUAL_FORBIDDEN%' THEN
        RAISE EXCEPTION 'TEST_FAILED: wrong % denial: %', v_denied_role, SQLERRM;
      END IF;
    END;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', v_acct::text, true);
  IF public.reverse_service_manual_journal(
       v_je3, DATE '2026-10-17', 'Accountant approved reversal'
     ) IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: accountant could not reverse';
  END IF;

  -- The denied roles left the journal untouched before the accountant reversal.
  SELECT COUNT(*) INTO v_n1
  FROM public.journal_entries
  WHERE business_id = v_biz1
    AND (reverses_entry_id = v_je3 OR (reference_type = 'reversal' AND reference_id = v_je3));
  IF v_n1 <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: denied roles left % reversal rows', v_n1;
  END IF;

  -- --------------------------------------------------------------------------
  -- 7b) Explicit accounting.view revocation blocks manual-journal writes
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_draft5 := public.create_service_manual_journal_draft(
    v_biz1, DATE '2026-10-15', '599 permission-revocation original', 'ROLE-599B',
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 30, 'credit', 0),
      jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 30)
    ),
    'test-599-revoked'
  );
  v_je5 := public.post_service_manual_journal_draft(v_draft5);

  UPDATE public.business_users
  SET custom_permissions = '{"revoked":["accounting.view"]}'::jsonb
  WHERE business_id = v_biz1 AND user_id IN (v_admin, v_acct);

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.reverse_service_manual_journal(
      v_je5, DATE '2026-10-17', 'Revoked admin reversal attempt'
    );
    RAISE EXCEPTION 'TEST_FAILED: revoked admin reversed a manual journal';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_FORBIDDEN%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong revoked-admin reversal error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_biz1, DATE '2026-10-15', 'Revoked admin create attempt', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_exp1, 'debit', 5, 'credit', 0),
        jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 5)
      ),
      'test-599-revoked-create'
    );
    RAISE EXCEPTION 'TEST_FAILED: revoked admin created a manual journal';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_FORBIDDEN%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong revoked-admin create error: %', SQLERRM;
    END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_acct::text, true);
  BEGIN
    PERFORM public.reverse_service_manual_journal(
      v_je5, DATE '2026-10-17', 'Revoked accountant reversal attempt'
    );
    RAISE EXCEPTION 'TEST_FAILED: revoked accountant reversed a manual journal';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_FORBIDDEN%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong revoked-accountant error: %', SQLERRM;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE business_id = v_biz1
      AND (reverses_entry_id = v_je5 OR (reference_type = 'reversal' AND reference_id = v_je5))
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: revoked permissions left a reversal row';
  END IF;

  UPDATE public.business_users
  SET custom_permissions = '{}'::jsonb
  WHERE business_id = v_biz1 AND user_id IN (v_admin, v_acct);

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_rev5 := public.reverse_service_manual_journal(
    v_je5, DATE '2026-10-17', 'Restored admin reversal'
  );
  IF v_rev5 IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: restored admin could not reverse';
  END IF;

  -- --------------------------------------------------------------------------
  -- 8) Tier gate on reversal (downgrade after posting)
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_draft4 := public.create_service_manual_journal_draft(
    v_biz1, DATE '2026-10-15', '599 tier gate original', 'TIER-599',
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 25, 'credit', 0),
      jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 25)
    ),
    'test-599-tier'
  );
  v_je4 := public.post_service_manual_journal_draft(v_draft4);

  UPDATE public.businesses SET service_subscription_tier = 'professional' WHERE id = v_biz1;
  BEGIN
    PERFORM public.reverse_service_manual_journal(
      v_je4, DATE '2026-10-17', 'Tier gate reversal attempt'
    );
    RAISE EXCEPTION 'TEST_FAILED: reversal succeeded below the Business tier';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_TIER_REQUIRED%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong tier-gate error: %', SQLERRM;
    END IF;
  END;

  -- Creation also requires the Business tier.
  BEGIN
    PERFORM public.create_service_manual_journal_draft(
      v_pro, DATE '2026-10-15', 'Professional manual attempt', NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_pexp, 'debit', 10, 'credit', 0),
        jsonb_build_object('account_id', v_pcash, 'debit', 0, 'credit', 10)
      ),
      'test-599-pro'
    );
    RAISE EXCEPTION 'TEST_FAILED: Professional-tier manual draft was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_TIER_REQUIRED%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong Professional-tier error: %', SQLERRM;
    END IF;
  END;
  UPDATE public.businesses SET service_subscription_tier = 'business' WHERE id = v_biz1;

  -- --------------------------------------------------------------------------
  -- 9) Period, date and reason gates
  -- --------------------------------------------------------------------------
  BEGIN
    PERFORM public.reverse_service_manual_journal(
      v_je4, DATE '2026-11-05', 'Locked period reversal'
    );
    RAISE EXCEPTION 'TEST_FAILED: locked-period reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_PERIOD_NOT_OPEN%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong locked-period error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.reverse_service_manual_journal(
      v_je4, DATE '2026-10-01', 'Date before the original entry'
    );
    RAISE EXCEPTION 'TEST_FAILED: reversal dated before original was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_REVERSAL_DATE_INVALID%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong reversal-date error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.reverse_service_manual_journal(v_je4, DATE '2026-10-17', 'short');
    RAISE EXCEPTION 'TEST_FAILED: short reason was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SERVICE_MANUAL_REASON_INVALID%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong reason error: %', SQLERRM;
    END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE business_id = v_biz1
      AND (reverses_entry_id = v_je4 OR (reference_type = 'reversal' AND reference_id = v_je4))
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: gate failures left a reversal row';
  END IF;

  -- --------------------------------------------------------------------------
  -- 10) Non-manual path keeps its own error and audit action
  -- --------------------------------------------------------------------------
  v_generic1 := public.post_journal_entry(
    p_business_id => v_biz1,
    p_date => DATE '2026-10-15',
    p_description => '599 generic journal',
    p_reference_type => 'manual',
    p_reference_id => NULL::uuid,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 60, 'credit', 0),
      jsonb_build_object('account_id', v_cash1, 'debit', 0, 'credit', 60)
    ),
    p_is_adjustment => FALSE,
    p_adjustment_reason => NULL::text,
    p_adjustment_ref => NULL::text,
    p_created_by => v_owner,
    p_entry_type => NULL::text,
    p_backfill_reason => NULL::text,
    p_backfill_actor => NULL::text,
    p_posted_by_accountant_id => v_owner,
    p_posting_source => 'accountant',
    p_is_revenue_correction => FALSE,
    p_reverses_entry_id => NULL::uuid
  );

  v_generic_rev := public.post_journal_entry(
    p_business_id => v_biz1,
    p_date => DATE '2026-10-16',
    p_description => '599 generic reversal',
    p_reference_type => 'reversal',
    p_reference_id => v_generic1,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_exp1, 'debit', 0, 'credit', 60),
      jsonb_build_object('account_id', v_cash1, 'debit', 60, 'credit', 0)
    ),
    p_is_adjustment => TRUE,
    p_adjustment_reason => 'generic reversal 599',
    p_adjustment_ref => NULL::text,
    p_created_by => v_owner,
    p_entry_type => NULL::text,
    p_backfill_reason => NULL::text,
    p_backfill_actor => NULL::text,
    p_posted_by_accountant_id => v_owner,
    p_posting_source => 'accountant',
    p_is_revenue_correction => FALSE,
    p_reverses_entry_id => v_generic1
  );

  BEGIN
    PERFORM public.post_journal_entry(
      p_business_id => v_biz1,
      p_date => DATE '2026-10-17',
      p_description => '599 generic duplicate reversal',
      p_reference_type => 'reversal',
      p_reference_id => v_generic1,
      p_lines => jsonb_build_array(
        jsonb_build_object('account_id', v_exp1, 'debit', 0, 'credit', 60),
        jsonb_build_object('account_id', v_cash1, 'debit', 60, 'credit', 0)
      ),
      p_is_adjustment => TRUE,
      p_adjustment_reason => 'generic duplicate reversal 599',
      p_adjustment_ref => NULL::text,
      p_created_by => v_owner,
      p_entry_type => NULL::text,
      p_backfill_reason => NULL::text,
      p_backfill_actor => NULL::text,
      p_posted_by_accountant_id => v_owner,
      p_posting_source => 'accountant',
      p_is_revenue_correction => FALSE,
      p_reverses_entry_id => v_generic1
    );
    RAISE EXCEPTION 'TEST_FAILED: duplicate generic reversal was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%REVERSAL_ALREADY_EXISTS%' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong generic duplicate error: %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO v_audit
  FROM public.audit_logs
  WHERE business_id = v_biz1
    AND action_type = 'reversal'
    AND entity_id = v_generic1;
  IF v_audit <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: generic reversal audit count is %', v_audit;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE business_id = v_biz1
      AND action_type = 'manual_journal.reversed'
      AND entity_id = v_generic1
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: generic reversal used the manual audit action';
  END IF;

  RAISE NOTICE 'PASS: 599 Service manual reversal hardening database tests';
END $$;

ROLLBACK;
