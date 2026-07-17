-- Migration 529: Phase 1B — authoritative atomic asset disposal

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS disposal_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposal_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS disposal_type TEXT,
  ADD COLUMN IF NOT EXISTS disposal_gain_loss NUMERIC;

ALTER TABLE public.assets
  DROP CONSTRAINT IF EXISTS assets_disposal_type_check;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_disposal_type_check
  CHECK (disposal_type IS NULL OR disposal_type IN ('cash', 'credit', 'scrap'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_disposal_idempotency_key
  ON public.assets (business_id, disposal_idempotency_key)
  WHERE disposal_idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assets_disposal_journal_entry_id
  ON public.assets (disposal_journal_entry_id)
  WHERE disposal_journal_entry_id IS NOT NULL;

-- ============================================================================
-- Depreciation completeness through disposal month (first-of-month periods)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_asset_depreciation_completeness(
  p_asset_id UUID,
  p_through_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_through DATE;
  v_cursor DATE;
  v_monthly NUMERIC;
  v_max_dep NUMERIC;
  v_posted_accum NUMERIC;
  v_missing_dates DATE[] := ARRAY[]::DATE[];
  v_last_posted DATE;
BEGIN
  SELECT
    a.id,
    a.purchase_date,
    a.purchase_amount,
    a.salvage_value,
    a.useful_life_years,
    a.status
  INTO v_asset
  FROM public.assets a
  WHERE a.id = p_asset_id AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  v_through := date_trunc('month', p_through_date)::date;
  v_cursor := date_trunc('month', v_asset.purchase_date)::date;
  v_monthly := public.calculate_monthly_depreciation(
    v_asset.purchase_amount,
    v_asset.salvage_value,
    v_asset.useful_life_years
  );
  v_max_dep := GREATEST(0, COALESCE(v_asset.purchase_amount, 0) - COALESCE(v_asset.salvage_value, 0));

  SELECT MAX(de.date) INTO v_last_posted
  FROM public.depreciation_entries de
  WHERE de.asset_id = p_asset_id
    AND de.deleted_at IS NULL
    AND de.status IN ('posted', 'adjusted');

  WHILE v_cursor <= v_through LOOP
    v_posted_accum := public.finza_asset_valid_posted_depreciation_total(p_asset_id);
    IF v_posted_accum >= v_max_dep - 0.01 OR v_monthly <= 0 THEN
      EXIT;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.depreciation_entries de
      WHERE de.asset_id = p_asset_id
        AND de.date = v_cursor
        AND de.deleted_at IS NULL
        AND de.status IN ('posted', 'adjusted')
    ) THEN
      v_missing_dates := array_append(v_missing_dates, v_cursor);
    END IF;

    v_cursor := (v_cursor + INTERVAL '1 month')::date;
  END LOOP;

  RETURN jsonb_build_object(
    'asset_id', p_asset_id,
    'required_through_date', v_through,
    'last_posted_depreciation_date', v_last_posted,
    'missing_period_count', COALESCE(array_length(v_missing_dates, 1), 0),
    'missing_period_dates', to_jsonb(v_missing_dates)
  );
END;
$$;

-- ============================================================================
-- Account resolution (lookup only — never INSERT)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_resolve_asset_disposal_accounts(
  p_business_id UUID,
  p_disposal_type TEXT,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS TABLE (
  fixed_asset_account_id UUID,
  accumulated_depreciation_account_id UUID,
  gain_on_disposal_account_id UUID,
  loss_on_disposal_account_id UUID,
  proceeds_account_id UUID
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_fixed UUID;
  v_accum UUID;
  v_gain UUID;
  v_loss UUID;
  v_proceeds UUID;
BEGIN
  SELECT a.id INTO v_fixed
  FROM public.accounts a
  WHERE a.business_id = p_business_id AND a.code = '1600' AND a.type = 'asset' AND a.deleted_at IS NULL
  ORDER BY a.is_system DESC, a.created_at ASC LIMIT 1;

  IF v_fixed IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Fixed asset account (1600) not found for business %', p_business_id;
  END IF;

  SELECT a.id INTO v_accum
  FROM public.accounts a
  WHERE a.business_id = p_business_id AND a.code = '1650' AND a.type IN ('contra_asset', 'asset') AND a.deleted_at IS NULL
  ORDER BY CASE WHEN a.type = 'contra_asset' THEN 0 ELSE 1 END, a.is_system DESC, a.created_at ASC LIMIT 1;

  IF v_accum IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Accumulated depreciation account (1650) not found for business %', p_business_id;
  END IF;

  SELECT a.id INTO v_gain
  FROM public.accounts a
  WHERE a.business_id = p_business_id AND a.code = '4200' AND a.type = 'income' AND a.deleted_at IS NULL
  ORDER BY a.is_system DESC, a.created_at ASC LIMIT 1;

  IF v_gain IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Gain on disposal account (4200) not found for business %', p_business_id;
  END IF;

  SELECT a.id INTO v_loss
  FROM public.accounts a
  WHERE a.business_id = p_business_id AND a.code = '5800' AND a.type = 'expense' AND a.deleted_at IS NULL
  ORDER BY a.is_system DESC, a.created_at ASC LIMIT 1;

  IF v_loss IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Loss on disposal account (5800) not found for business %', p_business_id;
  END IF;

  IF p_disposal_type = 'cash' THEN
    IF p_payment_account_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_ACCOUNT: Payment account is required for cash disposal';
    END IF;
    SELECT a.id INTO v_proceeds
    FROM public.accounts a
    WHERE a.id = p_payment_account_id AND a.business_id = p_business_id AND a.deleted_at IS NULL;
    IF v_proceeds IS NULL THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_ACCOUNT: Payment account does not belong to this business';
    END IF;
  ELSIF p_disposal_type = 'credit' THEN
    SELECT a.id INTO v_proceeds
    FROM public.accounts a
    WHERE a.business_id = p_business_id AND a.code = '1100' AND a.type = 'asset' AND a.deleted_at IS NULL
    ORDER BY a.is_system DESC, a.created_at ASC LIMIT 1;
    IF v_proceeds IS NULL THEN
      RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Accounts receivable account (1100) not found for business %', p_business_id;
    END IF;
  ELSIF p_disposal_type = 'scrap' THEN
    v_proceeds := NULL;
  ELSE
    RAISE EXCEPTION 'Invalid disposal type: %', p_disposal_type;
  END IF;

  fixed_asset_account_id := v_fixed;
  accumulated_depreciation_account_id := v_accum;
  gain_on_disposal_account_id := v_gain;
  loss_on_disposal_account_id := v_loss;
  proceeds_account_id := v_proceeds;
  RETURN NEXT;
END;
$$;

-- ============================================================================
-- post_asset_disposal — atomic disposal transaction
-- ============================================================================

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

  -- Idempotent retry
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

  IF COALESCE(p_proceeds, 0) > 0 AND v_accounts.proceeds_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_accounts.proceeds_account_id, p_proceeds, 0, 'Proceeds from Asset Disposal');
  END IF;

  IF v_accum > 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_accounts.accumulated_depreciation_account_id, v_accum, 0, 'Remove Accumulated Depreciation');
  END IF;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_id, v_accounts.fixed_asset_account_id, 0, v_cost, 'Remove Asset Cost');

  IF v_gain_loss > 0.01 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_accounts.gain_on_disposal_account_id, 0, v_gain_loss, 'Gain on Asset Disposal');
  ELSIF v_gain_loss < -0.01 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_accounts.loss_on_disposal_account_id, ABS(v_gain_loss), 0, 'Loss on Asset Disposal');
  END IF;

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
  'Phase 1B: Atomic asset disposal with depreciation completeness check, lookup-only accounts, idempotency.';

REVOKE ALL ON FUNCTION public.post_asset_disposal(UUID, DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_asset_disposal(UUID, DATE, NUMERIC, TEXT, UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.finza_asset_depreciation_completeness(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finza_resolve_asset_disposal_accounts(UUID, TEXT, UUID) TO authenticated;
