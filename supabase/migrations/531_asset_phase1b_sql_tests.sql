-- Migration 531: Phase 1B SQL integration tests

CREATE OR REPLACE FUNCTION public.test_asset_phase1b()
RETURNS TABLE (test_name TEXT, passed BOOLEAN, detail TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID := '4e6cdfba-e2ab-4ee4-ac00-9b077d696544';
  v_owner_id UUID;
  v_asset_id UUID;
  v_payment UUID;
  v_result JSONB;
  v_je UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM businesses WHERE id = v_business_id;
  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE, 'Load business missing'::TEXT;
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, TRUE);

  SELECT id INTO v_payment FROM accounts
  WHERE business_id = v_business_id AND code = '1010' AND deleted_at IS NULL LIMIT 1;

  -- Cash disposal with gain (after depreciation)
  INSERT INTO assets (
    business_id, name, category, purchase_date, purchase_amount,
    useful_life_years, salvage_value, current_value, accumulated_depreciation, status
  ) VALUES (
    v_business_id, 'Phase1B Disposal Test ' || gen_random_uuid()::text, 'equipment',
    '2026-01-01', 1000, 5, 0, 1000, 0, 'active'
  ) RETURNING id INTO v_asset_id;

  PERFORM post_asset_purchase_to_ledger(v_asset_id, NULL);
  PERFORM post_asset_depreciation(v_asset_id, '2026-01-01'::date, NULL, NULL, 'p1b-dep-' || v_asset_id::text, v_owner_id);

  v_result := post_asset_disposal(
    v_asset_id, '2026-02-15'::date, 950, 'cash', v_payment, NULL,
    'p1b-dispose-' || v_asset_id::text, v_owner_id, NULL, NULL
  );

  RETURN QUERY SELECT 'cash_disposal_with_journal'::TEXT,
    (v_result->>'journal_entry_id') IS NOT NULL,
    v_result->>'journal_entry_id';

  RETURN QUERY SELECT 'asset_marked_disposed'::TEXT,
    (SELECT status FROM assets WHERE id = v_asset_id) = 'disposed',
    (SELECT status FROM assets WHERE id = v_asset_id);

  -- Duplicate disposal blocked
  BEGIN
    PERFORM post_asset_disposal(v_asset_id, '2026-02-16'::date, 900, 'cash', v_payment, NULL, gen_random_uuid()::text, v_owner_id, NULL, NULL);
    RETURN QUERY SELECT 'duplicate_disposal_blocked'::TEXT, FALSE, 'Expected ASSET_ALREADY_DISPOSED'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'duplicate_disposal_blocked'::TEXT, SQLERRM LIKE '%ASSET_ALREADY_DISPOSED%', SQLERRM;
  END;

  -- Missing depreciation blocks disposal
  INSERT INTO assets (
    business_id, name, category, purchase_date, purchase_amount,
    useful_life_years, salvage_value, current_value, accumulated_depreciation, status
  ) VALUES (
    v_business_id, 'Phase1B Incomplete Dep ' || gen_random_uuid()::text, 'equipment',
    '2026-01-01', 2000, 5, 0, 2000, 0, 'active'
  ) RETURNING id INTO v_asset_id;

  PERFORM post_asset_purchase_to_ledger(v_asset_id, NULL);

  BEGIN
    PERFORM post_asset_disposal(v_asset_id, '2026-03-01'::date, 1000, 'cash', v_payment, NULL, gen_random_uuid()::text, v_owner_id, NULL, NULL);
    RETURN QUERY SELECT 'missing_depreciation_blocks'::TEXT, FALSE, 'Expected DEPRECIATION_REQUIRED'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'missing_depreciation_blocks'::TEXT, SQLERRM LIKE '%DEPRECIATION_REQUIRED_BEFORE_DISPOSAL%', SQLERRM;
  END;

  -- Backfill posts journals
  INSERT INTO assets (
    business_id, name, category, purchase_date, purchase_amount,
    useful_life_years, salvage_value, current_value, accumulated_depreciation, status
  ) VALUES (
    v_business_id, 'Phase1B Backfill ' || gen_random_uuid()::text, 'equipment',
    '2025-06-01', 1200, 5, 0, 1200, 0, 'active'
  ) RETURNING id INTO v_asset_id;

  PERFORM post_asset_purchase_to_ledger(v_asset_id, NULL);
  v_result := backfill_asset_historical_depreciation(v_asset_id, '2025-12-01'::date, v_owner_id);

  RETURN QUERY SELECT 'backfill_posts_periods'::TEXT,
    (v_result->>'posted_count')::INT > 0,
    'posted=' || (v_result->>'posted_count');

  RETURN QUERY SELECT 'backfill_register_consistent'::TEXT,
    ABS(
      (SELECT accumulated_depreciation FROM assets WHERE id = v_asset_id)
      - public.finza_asset_valid_posted_depreciation_total(v_asset_id)
    ) < 0.02,
    'register vs entries';

  -- Batch partial semantics
  v_result := post_asset_depreciation_batch(v_business_id, '2026-03-01'::date, v_owner_id, 'p1b-batch-test', 50);

  RETURN QUERY SELECT 'batch_returns_counts'::TEXT,
    v_result ? 'posted' AND v_result ? 'skipped' AND v_result ? 'failed',
    'posted=' || (v_result->>'posted_count') || ' failed=' || (v_result->>'failed_count');

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.test_asset_phase1b() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_asset_phase1b() TO service_role;
