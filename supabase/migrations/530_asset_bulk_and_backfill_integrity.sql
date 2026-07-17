-- Migration 530: Phase 1B — historical backfill, bulk depreciation, extended diagnostics

-- ============================================================================
-- Historical depreciation backfill (uses Phase 1A post_asset_depreciation)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.backfill_asset_historical_depreciation(
  p_asset_id UUID,
  p_through_date DATE DEFAULT NULL,
  p_posted_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_through DATE;
  v_cursor DATE;
  v_now DATE := CURRENT_DATE;
  v_default_through DATE := (date_trunc('month', v_now) - INTERVAL '1 month')::date;
  v_posted JSONB := '[]'::jsonb;
  v_skipped JSONB := '[]'::jsonb;
  v_failed JSONB := '[]'::jsonb;
  v_result JSONB;
  v_monthly NUMERIC;
  v_max_dep NUMERIC;
BEGIN
  SELECT
    a.id,
    a.business_id,
    a.purchase_date,
    a.purchase_amount,
    a.salvage_value,
    a.useful_life_years,
    a.status,
    a.deleted_at
  INTO v_asset
  FROM public.assets a
  WHERE a.id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND OR v_asset.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF NOT public.finza_user_can_access_business(v_asset.business_id) THEN
    RAISE EXCEPTION 'Not authorized to backfill depreciation for this business';
  END IF;

  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot backfill depreciation for asset with status %', v_asset.status;
  END IF;

  v_through := COALESCE(date_trunc('month', p_through_date)::date, v_default_through);
  v_cursor := date_trunc('month', v_asset.purchase_date)::date;
  v_monthly := public.calculate_monthly_depreciation(
    v_asset.purchase_amount,
    v_asset.salvage_value,
    v_asset.useful_life_years
  );
  v_max_dep := GREATEST(0, COALESCE(v_asset.purchase_amount, 0) - COALESCE(v_asset.salvage_value, 0));

  WHILE v_cursor <= v_through LOOP
    IF public.finza_asset_valid_posted_depreciation_total(p_asset_id) >= v_max_dep - 0.01 OR v_monthly <= 0 THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'period', v_cursor,
        'code', 'FULLY_DEPRECIATED',
        'message', 'Asset fully depreciated'
      ));
      EXIT;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.depreciation_entries de
      WHERE de.asset_id = p_asset_id
        AND de.date = v_cursor
        AND de.deleted_at IS NULL
        AND de.status IN ('posted', 'adjusted')
    ) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'period', v_cursor,
        'code', 'DUPLICATE_PERIOD',
        'message', 'Depreciation already posted for period'
      ));
    ELSE
      BEGIN
        v_result := public.post_asset_depreciation(
          p_asset_id,
          v_cursor,
          NULL,
          NULL,
          'backfill-' || p_asset_id::text || '-' || to_char(v_cursor, 'YYYY-MM'),
          p_posted_by
        );
        v_posted := v_posted || jsonb_build_array(jsonb_build_object(
          'period', v_cursor,
          'amount', v_result->>'amount',
          'depreciation_entry_id', v_result->>'depreciation_entry_id',
          'journal_entry_id', v_result->>'journal_entry_id',
          'idempotent', COALESCE((v_result->>'idempotent')::boolean, false)
        ));
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'period', v_cursor,
          'code', 'POST_FAILED',
          'message', SQLERRM
        ));
        EXIT;
      END;
    END IF;

    v_cursor := (v_cursor + INTERVAL '1 month')::date;
  END LOOP;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'through_date', v_through,
    'posted', v_posted,
    'skipped', v_skipped,
    'failed', v_failed,
    'posted_count', jsonb_array_length(v_posted),
    'skipped_count', jsonb_array_length(v_skipped),
    'failed_count', jsonb_array_length(v_failed),
    'success', jsonb_array_length(v_failed) = 0
  );
END;
$$;

-- ============================================================================
-- Bulk depreciation batch (per-asset atomic via post_asset_depreciation)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_asset_depreciation_batch(
  p_business_id UUID,
  p_posting_date DATE,
  p_posted_by UUID DEFAULT NULL,
  p_idempotency_prefix TEXT DEFAULT NULL,
  p_max_assets INT DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posting_date DATE;
  v_asset RECORD;
  v_result JSONB;
  v_posted JSONB := '[]'::jsonb;
  v_skipped JSONB := '[]'::jsonb;
  v_failed JSONB := '[]'::jsonb;
  v_count INT := 0;
  v_idem TEXT;
BEGIN
  IF p_posting_date IS NULL THEN
    RAISE EXCEPTION 'Posting date is required';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post batch depreciation for this business';
  END IF;

  v_posting_date := date_trunc('month', p_posting_date)::date;

  FOR v_asset IN
    SELECT a.id, a.name, a.asset_code, a.status
    FROM public.assets a
    WHERE a.business_id = p_business_id
      AND a.deleted_at IS NULL
      AND a.status = 'active'
    ORDER BY a.name
    LIMIT LEAST(GREATEST(COALESCE(p_max_assets, 200), 1), 500)
  LOOP
    v_count := v_count + 1;
    v_idem := CASE
      WHEN p_idempotency_prefix IS NOT NULL AND TRIM(p_idempotency_prefix) <> ''
      THEN TRIM(p_idempotency_prefix) || '-' || v_asset.id::text || '-' || to_char(v_posting_date, 'YYYY-MM')
      ELSE NULL
    END;

    BEGIN
      v_result := public.post_asset_depreciation(
        v_asset.id,
        v_posting_date,
        NULL,
        NULL,
        v_idem,
        p_posted_by
      );

      IF COALESCE((v_result->>'idempotent')::boolean, false) THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'asset_id', v_asset.id,
          'asset_name', v_asset.name,
          'period', v_posting_date,
          'code', 'IDEMPOTENT',
          'message', 'Already posted (idempotent retry)',
          'depreciation_entry_id', v_result->>'depreciation_entry_id',
          'journal_entry_id', v_result->>'journal_entry_id'
        ));
      ELSE
        v_posted := v_posted || jsonb_build_array(jsonb_build_object(
          'asset_id', v_asset.id,
          'asset_name', v_asset.name,
          'period', v_posting_date,
          'amount', v_result->>'amount',
          'depreciation_entry_id', v_result->>'depreciation_entry_id',
          'journal_entry_id', v_result->>'journal_entry_id',
          'code', 'POSTED'
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%already posted%' OR SQLERRM LIKE '%Duplicate%' THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'asset_id', v_asset.id,
          'asset_name', v_asset.name,
          'period', v_posting_date,
          'code', 'DUPLICATE_PERIOD',
          'message', SQLERRM
        ));
      ELSIF SQLERRM LIKE '%fully depreciated%' THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'asset_id', v_asset.id,
          'asset_name', v_asset.name,
          'period', v_posting_date,
          'code', 'FULLY_DEPRECIATED',
          'message', SQLERRM
        ));
      ELSIF SQLERRM LIKE '%Cannot depreciate asset with status disposed%' THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'asset_id', v_asset.id,
          'asset_name', v_asset.name,
          'period', v_posting_date,
          'code', 'ASSET_DISPOSED',
          'message', SQLERRM
        ));
      ELSE
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'asset_id', v_asset.id,
          'asset_name', v_asset.name,
          'period', v_posting_date,
          'code', 'POST_FAILED',
          'message', SQLERRM
        ));
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'posting_date', v_posting_date,
    'posted', v_posted,
    'skipped', v_skipped,
    'failed', v_failed,
    'posted_count', jsonb_array_length(v_posted),
    'skipped_count', jsonb_array_length(v_skipped),
    'failed_count', jsonb_array_length(v_failed),
    'assets_processed', v_count,
    'partial_success', jsonb_array_length(v_failed) > 0 AND jsonb_array_length(v_posted) > 0,
    'success', jsonb_array_length(v_failed) = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_asset_historical_depreciation(UUID, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_asset_historical_depreciation(UUID, DATE, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.post_asset_depreciation_batch(UUID, DATE, UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_asset_depreciation_batch(UUID, DATE, UUID, TEXT, INT) TO authenticated;

-- ============================================================================
-- Extended reconciliation diagnostics (Phase 1B)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_diagnose_asset_depreciation_reconciliation(
  p_business_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB := '[]'::jsonb;
  v_row JSONB;
BEGIN
  IF p_business_id IS NOT NULL
     AND NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to diagnose depreciation for this business';
  END IF;

  -- Phase 1A: incomplete entries
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'incomplete_entry',
      'asset_id', de.asset_id,
      'depreciation_entry_id', de.id,
      'business_id', de.business_id,
      'date', de.date,
      'amount', de.amount,
      'status', de.status
    )
    FROM public.depreciation_entries de
    WHERE de.deleted_at IS NULL
      AND de.journal_entry_id IS NULL
      AND de.status IN ('posted', 'adjusted')
      AND (p_business_id IS NULL OR de.business_id = p_business_id)
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Register vs entries
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'register_accum_mismatch',
      'asset_id', a.id,
      'business_id', a.business_id,
      'register_accumulated_depreciation', a.accumulated_depreciation,
      'entries_sum', COALESCE(SUM(de.amount), 0),
      'difference', ROUND(a.accumulated_depreciation - COALESCE(SUM(de.amount), 0), 2)
    )
    FROM public.assets a
    LEFT JOIN public.depreciation_entries de
      ON de.asset_id = a.id AND de.deleted_at IS NULL AND de.status IN ('posted', 'adjusted')
    WHERE a.deleted_at IS NULL AND a.status = 'active'
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
    GROUP BY a.id, a.business_id, a.accumulated_depreciation
    HAVING ABS(a.accumulated_depreciation - COALESCE(SUM(de.amount), 0)) > 0.01
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Carrying value mismatch (active assets only)
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'carrying_value_mismatch',
      'asset_id', a.id,
      'business_id', a.business_id,
      'register_current_value', a.current_value,
      'expected_current_value', GREATEST(
        COALESCE(a.salvage_value, 0),
        ROUND(a.purchase_amount - public.finza_asset_valid_posted_depreciation_total(a.id), 2)
      ),
      'difference', ROUND(
        a.current_value - GREATEST(
          COALESCE(a.salvage_value, 0),
          ROUND(a.purchase_amount - public.finza_asset_valid_posted_depreciation_total(a.id), 2)
        ), 2)
    )
    FROM public.assets a
    WHERE a.deleted_at IS NULL AND a.status = 'active'
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
      AND ABS(
        a.current_value - GREATEST(
          COALESCE(a.salvage_value, 0),
          ROUND(a.purchase_amount - public.finza_asset_valid_posted_depreciation_total(a.id), 2)
        )
      ) > 0.01
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Journal amount mismatch
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'journal_amount_mismatch',
      'asset_id', de.asset_id,
      'depreciation_entry_id', de.id,
      'business_id', de.business_id,
      'entry_amount', de.amount,
      'journal_debit', COALESCE(SUM(jel.debit), 0),
      'journal_credit', COALESCE(SUM(jel.credit), 0),
      'journal_entry_id', de.journal_entry_id
    )
    FROM public.depreciation_entries de
    JOIN public.journal_entry_lines jel ON jel.journal_entry_id = de.journal_entry_id
    WHERE de.deleted_at IS NULL AND de.journal_entry_id IS NOT NULL
      AND de.status IN ('posted', 'adjusted')
      AND (p_business_id IS NULL OR de.business_id = p_business_id)
    GROUP BY de.id, de.asset_id, de.business_id, de.amount, de.journal_entry_id
    HAVING ABS(de.amount - COALESCE(SUM(jel.debit), 0)) > 0.01
        OR ABS(de.amount - COALESCE(SUM(jel.credit), 0)) > 0.01
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Phase 1B: disposed without journal
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'disposed_without_journal',
      'asset_id', a.id,
      'business_id', a.business_id,
      'disposal_date', a.disposal_date
    )
    FROM public.assets a
    WHERE a.deleted_at IS NULL AND a.status = 'disposed'
      AND a.disposal_journal_entry_id IS NULL
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Disposal journal without disposed status
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'disposal_journal_without_disposed_status',
      'asset_id', a.id,
      'business_id', a.business_id,
      'disposal_journal_entry_id', a.disposal_journal_entry_id
    )
    FROM public.assets a
    WHERE a.deleted_at IS NULL AND a.status <> 'disposed'
      AND a.disposal_journal_entry_id IS NOT NULL
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Depreciation posted after disposal
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'depreciation_after_disposal',
      'asset_id', a.id,
      'depreciation_entry_id', de.id,
      'business_id', a.business_id,
      'disposal_date', a.disposal_date,
      'depreciation_date', de.date
    )
    FROM public.assets a
    JOIN public.depreciation_entries de ON de.asset_id = a.id
    WHERE a.deleted_at IS NULL AND a.status = 'disposed'
      AND de.deleted_at IS NULL AND de.status IN ('posted', 'adjusted')
      AND de.date > a.disposal_date
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Acquisition journal missing
  FOR v_row IN
    SELECT jsonb_build_object(
      'issue_type', 'acquisition_journal_missing',
      'asset_id', a.id,
      'business_id', a.business_id,
      'purchase_amount', a.purchase_amount
    )
    FROM public.assets a
    WHERE a.deleted_at IS NULL
      AND a.acquisition_journal_entry_id IS NULL
      AND a.purchase_amount > 0
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'issue_count', jsonb_array_length(v_result),
    'issues', v_result
  );
END;
$$;
