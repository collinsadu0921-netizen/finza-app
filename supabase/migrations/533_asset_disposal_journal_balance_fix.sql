-- Migration 533: Fix post_asset_disposal journal balance — single INSERT for all lines
-- Statement-level balance trigger (migration 185/291) rejects sequential line inserts.

CREATE OR REPLACE FUNCTION public.post_asset_disposal(
  p_asset_id UUID,
  p_disposal_date DATE,
  p_proceeds NUMERIC,
  p_disposal_type TEXT,
  p_payment_account_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_disposed_by UUID DEFAULT NULL,
  p_buyer TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_disposal_date DATE;
  v_accounts RECORD;
  v_accum NUMERIC;
  v_cost NUMERIC;
  v_carrying NUMERIC;
  v_gain_loss NUMERIC;
  v_journal_id UUID;
  v_completeness JSONB;
  v_other_asset_id UUID;
BEGIN
  IF p_disposal_date IS NULL THEN
    RAISE EXCEPTION 'Disposal date is required';
  END IF;

  IF p_disposal_type IS NULL OR p_disposal_type NOT IN ('cash', 'credit', 'scrap') THEN
    RAISE EXCEPTION 'Invalid disposal type';
  END IF;

  IF p_proceeds IS NULL OR p_proceeds < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_PROCEEDS: Disposal proceeds cannot be negative';
  END IF;

  IF p_disposal_type = 'scrap' AND p_proceeds > 0 THEN
    RAISE EXCEPTION 'Scrap disposal requires zero proceeds';
  END IF;

  v_disposal_date := p_disposal_date;

  SELECT
    a.id,
    a.business_id,
    a.name,
    a.purchase_date,
    a.purchase_amount,
    a.salvage_value,
    a.status,
    a.deleted_at,
    a.disposal_journal_entry_id,
    a.disposal_idempotency_key,
    a.disposal_date AS existing_disposal_date,
    a.disposal_amount AS existing_disposal_amount
  INTO v_asset
  FROM public.assets a
  WHERE a.id = p_asset_id
  FOR UPDATE;

  IF NOT FOUND OR v_asset.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF NOT public.finza_user_can_access_business(v_asset.business_id) THEN
    RAISE EXCEPTION 'Not authorized to dispose asset for this business';
  END IF;

  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
    IF v_asset.disposal_idempotency_key = TRIM(p_idempotency_key)
       AND v_asset.disposal_journal_entry_id IS NOT NULL
       AND v_asset.status = 'disposed' THEN
      RETURN jsonb_build_object(
        'asset_id', v_asset.id,
        'journal_entry_id', v_asset.disposal_journal_entry_id,
        'disposal_date', v_asset.existing_disposal_date,
        'proceeds', v_asset.existing_disposal_amount,
        'idempotent', TRUE
      );
    END IF;

    SELECT a.id INTO v_other_asset_id
    FROM public.assets a
    WHERE a.business_id = v_asset.business_id
      AND a.disposal_idempotency_key = TRIM(p_idempotency_key)
      AND a.deleted_at IS NULL
      AND a.id <> p_asset_id
    LIMIT 1;

    IF v_other_asset_id IS NOT NULL THEN
      RAISE EXCEPTION 'Idempotency key already used for another asset disposal';
    END IF;
  END IF;

  IF v_asset.status = 'disposed' THEN
    IF v_asset.disposal_journal_entry_id IS NOT NULL THEN
      IF p_idempotency_key IS NOT NULL
         AND v_asset.disposal_idempotency_key = TRIM(p_idempotency_key) THEN
        RETURN jsonb_build_object(
          'asset_id', p_asset_id,
          'journal_entry_id', v_asset.disposal_journal_entry_id,
          'disposal_date', v_asset.existing_disposal_date,
          'proceeds', v_asset.existing_disposal_amount,
          'idempotent', TRUE
        );
      END IF;
      RAISE EXCEPTION 'ASSET_ALREADY_DISPOSED: Asset is already disposed';
    END IF;
    RAISE EXCEPTION 'INCOMPLETE_DISPOSAL: Asset marked disposed without linked disposal journal';
  END IF;

  IF v_disposal_date < v_asset.purchase_date THEN
    RAISE EXCEPTION 'Disposal date cannot be before acquisition date';
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_asset.business_id, v_disposal_date);

  v_completeness := public.finza_asset_depreciation_completeness(p_asset_id, v_disposal_date);
  IF (v_completeness->>'missing_period_count')::INT > 0 THEN
    RAISE EXCEPTION 'DEPRECIATION_REQUIRED_BEFORE_DISPOSAL: % missing depreciation period(s) through %. Last posted: %. Details: %',
      v_completeness->>'missing_period_count',
      v_completeness->>'required_through_date',
      COALESCE(v_completeness->>'last_posted_depreciation_date', 'none'),
      v_completeness::text;
  END IF;

  SELECT * INTO v_accounts
  FROM public.finza_resolve_asset_disposal_accounts(v_asset.business_id, p_disposal_type, p_payment_account_id);

  v_cost := ROUND(COALESCE(v_asset.purchase_amount, 0), 2);
  v_accum := ROUND(public.finza_asset_valid_posted_depreciation_total(p_asset_id), 2);
  v_carrying := ROUND(GREATEST(COALESCE(v_asset.salvage_value, 0), v_cost - v_accum), 2);
  v_gain_loss := ROUND(COALESCE(p_proceeds, 0) - v_carrying, 2);

  INSERT INTO public.journal_entries (
    business_id, date, description, reference_type, reference_id, posting_source
  )
  VALUES (
    v_asset.business_id,
    v_disposal_date,
    'Asset Disposal: ' || v_asset.name,
    'asset_disposal',
    p_asset_id,
    'system'
  )
  RETURNING id INTO v_journal_id;

  -- Single INSERT so statement-level balance trigger sees all lines together (migration 291 pattern)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_journal_id, t.account_id, t.debit, t.credit, t.description
  FROM (
    SELECT v_accounts.proceeds_account_id AS account_id,
           p_proceeds AS debit, 0::NUMERIC AS credit,
           'Proceeds from Asset Disposal'::TEXT AS description
    WHERE COALESCE(p_proceeds, 0) > 0 AND v_accounts.proceeds_account_id IS NOT NULL
    UNION ALL
    SELECT v_accounts.accumulated_depreciation_account_id, v_accum, 0, 'Remove Accumulated Depreciation'
    WHERE v_accum > 0
    UNION ALL
    SELECT v_accounts.fixed_asset_account_id, 0, v_cost, 'Remove Asset Cost'
    UNION ALL
    SELECT v_accounts.gain_on_disposal_account_id, 0, v_gain_loss, 'Gain on Asset Disposal'
    WHERE v_gain_loss > 0.01
    UNION ALL
    SELECT v_accounts.loss_on_disposal_account_id, ABS(v_gain_loss), 0, 'Loss on Asset Disposal'
    WHERE v_gain_loss < -0.01
  ) t;

  UPDATE public.assets
  SET
    status = 'disposed',
    disposal_date = v_disposal_date,
    disposal_amount = COALESCE(p_proceeds, 0),
    disposal_type = p_disposal_type,
    disposal_gain_loss = v_gain_loss,
    disposal_journal_entry_id = v_journal_id,
    disposal_idempotency_key = NULLIF(TRIM(p_idempotency_key), ''),
    disposal_buyer = NULLIF(TRIM(p_buyer), ''),
    disposal_notes = COALESCE(NULLIF(TRIM(p_notes), ''), NULLIF(TRIM(p_reason), '')),
    current_value = COALESCE(v_asset.salvage_value, 0),
    accumulated_depreciation = v_accum,
    updated_at = NOW()
  WHERE id = p_asset_id;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'journal_entry_id', v_journal_id,
    'disposal_date', v_disposal_date,
    'proceeds', COALESCE(p_proceeds, 0),
    'disposal_type', p_disposal_type,
    'carrying_value', v_carrying,
    'accumulated_depreciation', v_accum,
    'gain_loss', v_gain_loss,
    'idempotent', FALSE
  );
END;
$$;

COMMENT ON FUNCTION public.post_asset_disposal IS
  'Phase 1B: Atomic asset disposal. Journal lines inserted in one statement for balance trigger compatibility.';

REVOKE ALL ON FUNCTION public.post_asset_disposal(UUID, DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_asset_disposal(UUID, DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;
