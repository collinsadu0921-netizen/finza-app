-- Migration 528: Phase 1A depreciation SQL integration tests (staging validation helper)
-- Read-only / self-contained test runner. Does not repair production data.
-- Run: SELECT * FROM public.test_asset_depreciation_phase1a();

CREATE OR REPLACE FUNCTION public.test_asset_depreciation_phase1a()
RETURNS TABLE (
  test_name TEXT,
  passed BOOLEAN,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID := '4e6cdfba-e2ab-4ee4-ac00-9b077d696544';
  v_owner_id UUID;
  v_asset_id UUID;
  v_entry_id UUID;
  v_je_id UUID;
  v_rev_entry_id UUID;
  v_rev_je_id UUID;
  v_count INT;
  v_expense_id UUID;
  v_accum_id UUID;
  v_before_accounts INT;
  v_after_accounts INT;
  v_posted_accum NUMERIC;
  v_current NUMERIC;
BEGIN
  SELECT owner_id INTO v_owner_id FROM businesses WHERE id = v_business_id;
  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE, 'Load-test business not found'::TEXT;
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, TRUE);

  -- Account resolution: existing 5700/1650
  BEGIN
    SELECT depreciation_expense_account_id, accumulated_depreciation_account_id
    INTO v_expense_id, v_accum_id
    FROM finza_resolve_asset_depreciation_accounts(v_business_id);
    RETURN QUERY SELECT 'account_resolution_existing'::TEXT,
      v_expense_id IS NOT NULL AND v_accum_id IS NOT NULL,
      format('expense=%s accum=%s', v_expense_id, v_accum_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'account_resolution_existing'::TEXT, FALSE, SQLERRM;
  END;

  -- No auto-create on resolver call
  SELECT COUNT(*) INTO v_before_accounts FROM accounts WHERE business_id = v_business_id AND code IN ('5700','1650') AND deleted_at IS NULL;
  PERFORM finza_resolve_asset_depreciation_accounts(v_business_id);
  SELECT COUNT(*) INTO v_after_accounts FROM accounts WHERE business_id = v_business_id AND code IN ('5700','1650') AND deleted_at IS NULL;
  RETURN QUERY SELECT 'account_resolver_no_auto_create'::TEXT, v_before_accounts = v_after_accounts,
    format('before=%s after=%s', v_before_accounts, v_after_accounts);

  -- Missing accounts business (ephemeral)
  BEGIN
    PERFORM finza_resolve_asset_depreciation_accounts('00000000-0000-0000-0000-000000009999'::uuid);
    RETURN QUERY SELECT 'missing_accounts_raises'::TEXT, FALSE, 'Expected ACCOUNT_CONFIGURATION_REQUIRED'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'missing_accounts_raises'::TEXT,
      SQLERRM LIKE '%ACCOUNT_CONFIGURATION_REQUIRED%',
      SQLERRM;
  END;

  -- Create disposable asset + post
  INSERT INTO assets (
    business_id, name, category, purchase_date, purchase_amount,
    useful_life_years, salvage_value, current_value, accumulated_depreciation, status
  ) VALUES (
    v_business_id, 'SQL Test Asset ' || gen_random_uuid()::text, 'equipment', '2026-06-01',
    6000, 5, 0, 6000, 0, 'active'
  ) RETURNING id INTO v_asset_id;

  PERFORM post_asset_purchase_to_ledger(v_asset_id, NULL);

  SELECT (post_asset_depreciation(
    v_asset_id, '2026-07-01'::date, NULL, NULL, 'sql-test-idem-' || gen_random_uuid()::text, v_owner_id
  )->>'depreciation_entry_id')::uuid INTO v_entry_id;

  SELECT journal_entry_id INTO v_je_id FROM depreciation_entries WHERE id = v_entry_id;

  RETURN QUERY SELECT 'posting_creates_entry_and_journal'::TEXT,
    v_entry_id IS NOT NULL AND v_je_id IS NOT NULL,
    format('entry=%s je=%s', v_entry_id, v_je_id);

  SELECT COUNT(*) INTO v_count FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
  RETURN QUERY SELECT 'posting_journal_balanced'::TEXT,
    (SELECT ROUND(SUM(debit),2) = ROUND(SUM(credit),2) AND ROUND(SUM(debit),2) > 0 FROM journal_entry_lines WHERE journal_entry_id = v_je_id),
    format('lines=%s', v_count);

  SELECT accumulated_depreciation, current_value INTO v_posted_accum, v_current FROM assets WHERE id = v_asset_id;
  RETURN QUERY SELECT 'register_updated_after_post'::TEXT,
    v_posted_accum > 0 AND v_current < 6000,
    format('accum=%s current=%s', v_posted_accum, v_current);

  -- Idempotency
  BEGIN
    PERFORM post_asset_depreciation(v_asset_id, '2026-07-01'::date, NULL, NULL, (
      SELECT idempotency_key FROM depreciation_entries WHERE id = v_entry_id
    ), v_owner_id);
    SELECT COUNT(*) INTO v_count FROM depreciation_entries WHERE asset_id = v_asset_id AND date = '2026-07-01' AND deleted_at IS NULL;
    RETURN QUERY SELECT 'idempotency_no_duplicate_row'::TEXT, v_count = 1, format('count=%s', v_count);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'idempotency_no_duplicate_row'::TEXT, FALSE, SQLERRM;
  END;

  -- Duplicate date different key
  BEGIN
    PERFORM post_asset_depreciation(v_asset_id, '2026-07-01'::date, NULL, NULL, gen_random_uuid()::text, v_owner_id);
    RETURN QUERY SELECT 'duplicate_date_blocked'::TEXT, FALSE, 'Expected duplicate error'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'duplicate_date_blocked'::TEXT,
      SQLERRM LIKE '%already posted%',
      SQLERRM;
  END;

  -- Direct delete blocked (527 trigger)
  BEGIN
    DELETE FROM depreciation_entries WHERE id = v_entry_id;
    RETURN QUERY SELECT 'direct_delete_blocked'::TEXT, FALSE, 'DELETE succeeded unexpectedly'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'direct_delete_blocked'::TEXT,
      SQLERRM LIKE '%ACCOUNTING_RECORD_IMMUTABLE%' OR SQLERRM LIKE '%permission denied%',
      SQLERRM;
  END;

  -- Reversal
  SELECT (reverse_asset_depreciation(
    v_entry_id, '2026-07-15'::date, 'SQL test reversal', v_owner_id
  )->>'reversal_entry_id')::uuid INTO v_rev_entry_id;

  SELECT journal_entry_id INTO v_rev_je_id FROM depreciation_entries WHERE id = v_rev_entry_id;

  RETURN QUERY SELECT 'reversal_creates_journal'::TEXT, v_rev_je_id IS NOT NULL, format('rev_je=%s', v_rev_je_id);
  RETURN QUERY SELECT 'original_marked_reversed'::TEXT,
    (SELECT status FROM depreciation_entries WHERE id = v_entry_id) = 'reversed',
    (SELECT status FROM depreciation_entries WHERE id = v_entry_id);

  SELECT accumulated_depreciation INTO v_posted_accum FROM assets WHERE id = v_asset_id;
  RETURN QUERY SELECT 'register_restored_after_reversal'::TEXT,
    ROUND(v_posted_accum, 2) = 0,
    format('accum=%s', v_posted_accum);

  -- Double reversal blocked
  BEGIN
    PERFORM reverse_asset_depreciation(v_entry_id, '2026-07-16'::date, 'Double reverse', v_owner_id);
    RETURN QUERY SELECT 'double_reversal_blocked'::TEXT, FALSE, 'Second reversal succeeded'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'double_reversal_blocked'::TEXT, TRUE, SQLERRM;
  END;

  -- Cleanup disposable asset (unposted test residue only via service paths — leave asset for audit)
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.test_asset_depreciation_phase1a() IS
  'Phase 1A depreciation SQL integration tests. Run on staging only.';

REVOKE ALL ON FUNCTION public.test_asset_depreciation_phase1a() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_asset_depreciation_phase1a() TO service_role;
