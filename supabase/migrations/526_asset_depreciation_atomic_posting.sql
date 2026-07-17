-- Migration 526: Phase 1A — atomic asset depreciation posting and reversal
-- Forward-only. Does not modify historical migrations.

-- ============================================================================
-- STEP 1: Extend depreciation_entries
-- ============================================================================

ALTER TABLE public.depreciation_entries
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS reverses_entry_id UUID REFERENCES public.depreciation_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_by_entry_id UUID REFERENCES public.depreciation_entries(id) ON DELETE SET NULL;

-- Backfill status for existing rows
UPDATE public.depreciation_entries
SET status = CASE
  WHEN journal_entry_id IS NOT NULL THEN 'posted'
  ELSE 'posted'
END
WHERE status IS NULL;

ALTER TABLE public.depreciation_entries
  ALTER COLUMN status SET DEFAULT 'posted',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.depreciation_entries
  DROP CONSTRAINT IF EXISTS depreciation_entries_status_check;

ALTER TABLE public.depreciation_entries
  ADD CONSTRAINT depreciation_entries_status_check
  CHECK (status IN ('posted', 'adjusted', 'reversed', 'reversal'));

ALTER TABLE public.depreciation_entries
  DROP CONSTRAINT IF EXISTS depreciation_entries_amount_non_negative;

ALTER TABLE public.depreciation_entries
  ADD CONSTRAINT depreciation_entries_amount_non_negative
  CHECK (amount >= 0);

ALTER TABLE public.depreciation_entries
  DROP CONSTRAINT IF EXISTS depreciation_entries_reversal_link_consistency;

ALTER TABLE public.depreciation_entries
  ADD CONSTRAINT depreciation_entries_reversal_link_consistency
  CHECK (
    (status = 'reversal' AND reverses_entry_id IS NOT NULL)
    OR (status <> 'reversal')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_depreciation_entries_idempotency_key
  ON public.depreciation_entries (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_depreciation_entries_one_reversal_per_original
  ON public.depreciation_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_depreciation_entries_status
  ON public.depreciation_entries (asset_id, status)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- STEP 2: Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_asset_valid_posted_depreciation_total(p_asset_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(de.amount), 0)
  FROM public.depreciation_entries de
  WHERE de.asset_id = p_asset_id
    AND de.deleted_at IS NULL
    AND de.status IN ('posted', 'adjusted');
$$;

COMMENT ON FUNCTION public.finza_asset_valid_posted_depreciation_total(UUID) IS
  'Sum of posted/adjusted depreciation entry amounts for an asset (excludes reversals and reversed originals).';

CREATE OR REPLACE FUNCTION public.finza_resolve_asset_depreciation_accounts(p_business_id UUID)
RETURNS TABLE (
  depreciation_expense_account_id UUID,
  accumulated_depreciation_account_id UUID
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_expense_id UUID;
  v_accum_id UUID;
BEGIN
  SELECT a.id INTO v_expense_id
  FROM public.accounts a
  WHERE a.business_id = p_business_id
    AND a.code = '5700'
    AND a.type = 'expense'
    AND a.deleted_at IS NULL
  ORDER BY a.is_system DESC, a.created_at ASC
  LIMIT 1;

  IF v_expense_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Depreciation expense account (5700) not found for business %', p_business_id;
  END IF;

  SELECT a.id INTO v_accum_id
  FROM public.accounts a
  WHERE a.business_id = p_business_id
    AND a.code = '1650'
    AND a.type IN ('contra_asset', 'asset')
    AND a.deleted_at IS NULL
  ORDER BY
    CASE WHEN a.type = 'contra_asset' THEN 0 ELSE 1 END,
    a.is_system DESC,
    a.created_at ASC
  LIMIT 1;

  IF v_accum_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Accumulated depreciation account (1650) not found for business %', p_business_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = v_expense_id AND business_id = p_business_id AND type = 'expense'
  ) THEN
    RAISE EXCEPTION 'Invalid depreciation expense account configuration for business %', p_business_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = v_accum_id
      AND business_id = p_business_id
      AND type IN ('contra_asset', 'asset')
      AND code = '1650'
  ) THEN
    RAISE EXCEPTION 'Invalid accumulated depreciation account configuration for business %', p_business_id;
  END IF;

  depreciation_expense_account_id := v_expense_id;
  accumulated_depreciation_account_id := v_accum_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finza_resolve_asset_depreciation_accounts(UUID) IS
  'Resolves depreciation expense (5700) and accumulated depreciation (1650). Never creates accounts; raises ACCOUNT_CONFIGURATION_REQUIRED when missing.';

-- ============================================================================
-- STEP 3: post_asset_depreciation — authoritative atomic posting
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_asset_depreciation(
  p_asset_id UUID,
  p_posting_date DATE,
  p_amount NUMERIC DEFAULT NULL,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_posted_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_posting_date DATE;
  v_posted_accum NUMERIC;
  v_expected_amount NUMERIC;
  v_amount NUMERIC;
  v_remaining NUMERIC;
  v_status TEXT;
  v_entry_id UUID;
  v_journal_entry_id UUID;
  v_existing RECORD;
  v_accounts RECORD;
  v_result JSONB;
BEGIN
  IF p_posting_date IS NULL THEN
    RAISE EXCEPTION 'posting date is required';
  END IF;

  v_posting_date := date_trunc('month', p_posting_date)::date;

  SELECT
    a.id,
    a.business_id,
    a.name,
    a.purchase_date,
    a.purchase_amount,
    a.salvage_value,
    a.useful_life_years,
    a.depreciation_method,
    a.current_value,
    a.accumulated_depreciation,
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
    RAISE EXCEPTION 'Not authorized to post depreciation for this business';
  END IF;

  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot depreciate asset with status %', v_asset.status;
  END IF;

  IF v_posting_date < v_asset.purchase_date THEN
    RAISE EXCEPTION 'Posting date cannot be before asset purchase date';
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_asset.business_id, v_posting_date);

  -- Idempotent retry by idempotency key
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
    SELECT de.id, de.journal_entry_id, de.amount, de.status, de.date
    INTO v_existing
    FROM public.depreciation_entries de
    WHERE de.business_id = v_asset.business_id
      AND de.idempotency_key = TRIM(p_idempotency_key)
      AND de.deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.journal_entry_id IS NULL THEN
        RAISE EXCEPTION 'Incomplete depreciation entry exists for idempotency key; reconciliation required';
      END IF;

      RETURN jsonb_build_object(
        'depreciation_entry_id', v_existing.id,
        'journal_entry_id', v_existing.journal_entry_id,
        'amount', v_existing.amount,
        'status', v_existing.status,
        'posting_date', v_existing.date,
        'idempotent', TRUE
      );
    END IF;
  END IF;

  -- Duplicate protection for same asset + month
  SELECT de.id, de.journal_entry_id, de.amount, de.status, de.date, de.idempotency_key
  INTO v_existing
  FROM public.depreciation_entries de
  WHERE de.asset_id = p_asset_id
    AND de.date = v_posting_date
    AND de.deleted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Incomplete depreciation entry exists for this asset and date; reconciliation required';
    END IF;

    IF p_idempotency_key IS NOT NULL
       AND TRIM(p_idempotency_key) <> ''
       AND v_existing.idempotency_key = TRIM(p_idempotency_key) THEN
      RETURN jsonb_build_object(
        'depreciation_entry_id', v_existing.id,
        'journal_entry_id', v_existing.journal_entry_id,
        'amount', v_existing.amount,
        'status', v_existing.status,
        'posting_date', v_existing.date,
        'idempotent', TRUE
      );
    END IF;

    RAISE EXCEPTION 'Depreciation already posted for this asset and date';
  END IF;

  v_posted_accum := public.finza_asset_valid_posted_depreciation_total(p_asset_id);
  v_remaining := GREATEST(0, COALESCE(v_asset.purchase_amount, 0) - COALESCE(v_asset.salvage_value, 0) - v_posted_accum);

  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'Asset is fully depreciated';
  END IF;

  IF COALESCE(v_asset.useful_life_years, 0) <= 0 THEN
    RAISE EXCEPTION 'Asset useful life must be greater than zero';
  END IF;

  v_expected_amount := public.calculate_monthly_depreciation(
    v_asset.purchase_amount,
    v_asset.salvage_value,
    v_asset.useful_life_years
  );

  IF p_amount IS NULL THEN
    v_amount := LEAST(v_expected_amount, v_remaining);
  ELSE
    v_amount := ROUND(p_amount, 2);
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Depreciation amount must be greater than zero';
  END IF;

  IF v_amount > v_remaining + 0.001 THEN
    RAISE EXCEPTION 'Depreciation amount exceeds remaining depreciable value';
  END IF;

  IF p_amount IS NOT NULL AND ABS(v_amount - v_expected_amount) > 0.01 THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment reason is required when amount differs from calculated depreciation';
    END IF;
    v_status := 'adjusted';
  ELSE
    v_status := 'posted';
  END IF;

  SELECT * INTO v_accounts FROM public.finza_resolve_asset_depreciation_accounts(v_asset.business_id);

  INSERT INTO public.depreciation_entries (
    asset_id,
    business_id,
    date,
    amount,
    status,
    adjustment_reason,
    posted_by,
    posted_at,
    idempotency_key
  )
  VALUES (
    p_asset_id,
    v_asset.business_id,
    v_posting_date,
    v_amount,
    v_status,
    NULLIF(TRIM(p_adjustment_reason), ''),
    p_posted_by,
    NOW(),
    NULLIF(TRIM(p_idempotency_key), '')
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    posting_source
  )
  VALUES (
    v_asset.business_id,
    v_posting_date,
    'Depreciation: ' || v_asset.name,
    'depreciation',
    v_entry_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_accounts.depreciation_expense_account_id, v_amount, 0, 'Depreciation Expense'),
    (v_journal_entry_id, v_accounts.accumulated_depreciation_account_id, 0, v_amount, 'Accumulated Depreciation');

  UPDATE public.depreciation_entries
  SET journal_entry_id = v_journal_entry_id,
      updated_at = NOW()
  WHERE id = v_entry_id;

  UPDATE public.assets
  SET
    accumulated_depreciation = ROUND(COALESCE(v_posted_accum, 0) + v_amount, 2),
    current_value = GREATEST(
      COALESCE(v_asset.salvage_value, 0),
      ROUND(COALESCE(v_asset.purchase_amount, 0) - (COALESCE(v_posted_accum, 0) + v_amount), 2)
    ),
    updated_at = NOW()
  WHERE id = p_asset_id;

  v_result := jsonb_build_object(
    'depreciation_entry_id', v_entry_id,
    'journal_entry_id', v_journal_entry_id,
    'amount', v_amount,
    'status', v_status,
    'posting_date', v_posting_date,
    'depreciation_expense_account_id', v_accounts.depreciation_expense_account_id,
    'accumulated_depreciation_account_id', v_accounts.accumulated_depreciation_account_id,
    'idempotent', FALSE
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.post_asset_depreciation(UUID, DATE, NUMERIC, TEXT, TEXT, UUID) IS
  'Phase 1A: Atomically posts asset depreciation — entry, balanced journal, and register update in one transaction.';

REVOKE ALL ON FUNCTION public.post_asset_depreciation(UUID, DATE, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_asset_depreciation(UUID, DATE, NUMERIC, TEXT, TEXT, UUID) TO authenticated;

-- ============================================================================
-- STEP 4: reverse_asset_depreciation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reverse_asset_depreciation(
  p_depreciation_entry_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_reversed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_asset RECORD;
  v_reversal_date DATE;
  v_reversal_je_id UUID;
  v_reversal_entry_id UUID;
  v_lines JSONB;
  v_posted_accum NUMERIC;
  v_existing_rev UUID;
BEGIN
  IF p_reversal_date IS NULL THEN
    RAISE EXCEPTION 'Reversal date is required';
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Reversal reason is required';
  END IF;

  v_reversal_date := p_reversal_date;

  SELECT
    de.id,
    de.asset_id,
    de.business_id,
    de.date,
    de.amount,
    de.status,
    de.journal_entry_id,
    de.reversed_by_entry_id,
    de.deleted_at
  INTO v_entry
  FROM public.depreciation_entries de
  WHERE de.id = p_depreciation_entry_id
  FOR UPDATE;

  IF NOT FOUND OR v_entry.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Depreciation entry not found';
  END IF;

  IF v_entry.status NOT IN ('posted', 'adjusted') THEN
    RAISE EXCEPTION 'Only posted or adjusted depreciation entries can be reversed';
  END IF;

  IF v_entry.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation entry has no linked journal; reconciliation required';
  END IF;

  IF v_entry.reversed_by_entry_id IS NOT NULL THEN
    SELECT de.id, de.journal_entry_id
    INTO v_reversal_entry_id, v_reversal_je_id
    FROM public.depreciation_entries de
    WHERE de.id = v_entry.reversed_by_entry_id;

    RETURN jsonb_build_object(
      'depreciation_entry_id', v_entry.id,
      'reversal_entry_id', v_reversal_entry_id,
      'journal_entry_id', v_reversal_je_id,
      'idempotent', TRUE
    );
  END IF;

  IF NOT public.finza_user_can_access_business(v_entry.business_id) THEN
    RAISE EXCEPTION 'Not authorized to reverse depreciation for this business';
  END IF;

  SELECT id INTO v_existing_rev
  FROM public.depreciation_entries de
  WHERE de.reverses_entry_id = p_depreciation_entry_id
    AND de.deleted_at IS NULL
  LIMIT 1;

  IF v_existing_rev IS NOT NULL THEN
    RAISE EXCEPTION 'Depreciation entry already reversed';
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_entry.business_id, v_reversal_date);

  SELECT
    a.id,
    a.purchase_amount,
    a.salvage_value,
    a.status,
    a.deleted_at
  INTO v_asset
  FROM public.assets a
  WHERE a.id = v_entry.asset_id
  FOR UPDATE;

  IF NOT FOUND OR v_asset.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'account_id', jel.account_id,
        'debit', jel.credit,
        'credit', jel.debit,
        'description', COALESCE(jel.description, '')
      )
      ORDER BY jel.id
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_entry.journal_entry_id;

  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Original depreciation journal has no lines';
  END IF;

  SELECT public.post_journal_entry(
    v_entry.business_id,
    v_reversal_date,
    'Reversal: Depreciation entry ' || v_entry.id::text,
    'reversal',
    v_entry.journal_entry_id,
    v_lines,
    TRUE,
    TRIM(p_reason),
    'asset_depreciation_reversal',
    p_reversed_by,
    NULL,
    NULL,
    NULL,
    NULL,
    'system',
    FALSE,
    v_entry.journal_entry_id
  )
  INTO v_reversal_je_id;

  INSERT INTO public.depreciation_entries (
    asset_id,
    business_id,
    date,
    amount,
    status,
    adjustment_reason,
    journal_entry_id,
    reverses_entry_id,
    posted_by,
    posted_at
  )
  VALUES (
    v_entry.asset_id,
    v_entry.business_id,
    v_reversal_date,
    v_entry.amount,
    'reversal',
    TRIM(p_reason),
    v_reversal_je_id,
    v_entry.id,
    p_reversed_by,
    NOW()
  )
  RETURNING id INTO v_reversal_entry_id;

  UPDATE public.depreciation_entries
  SET
    status = 'reversed',
    reversed_by_entry_id = v_reversal_entry_id,
    updated_at = NOW()
  WHERE id = v_entry.id;

  v_posted_accum := public.finza_asset_valid_posted_depreciation_total(v_entry.asset_id);

  UPDATE public.assets
  SET
    accumulated_depreciation = ROUND(v_posted_accum, 2),
    current_value = GREATEST(
      COALESCE(v_asset.salvage_value, 0),
      ROUND(COALESCE(v_asset.purchase_amount, 0) - v_posted_accum, 2)
    ),
    updated_at = NOW()
  WHERE id = v_entry.asset_id;

  RETURN jsonb_build_object(
    'depreciation_entry_id', v_entry.id,
    'reversal_entry_id', v_reversal_entry_id,
    'journal_entry_id', v_reversal_je_id,
    'amount', v_entry.amount,
    'reversal_date', v_reversal_date,
    'idempotent', FALSE
  );
END;
$$;

COMMENT ON FUNCTION public.reverse_asset_depreciation(UUID, DATE, TEXT, UUID) IS
  'Phase 1A: Reverses a posted depreciation entry via balancing reversal journal and register rollback.';

REVOKE ALL ON FUNCTION public.reverse_asset_depreciation(UUID, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_asset_depreciation(UUID, DATE, TEXT, UUID) TO authenticated;

-- ============================================================================
-- STEP 5: Fix legacy post_depreciation_to_ledger (contra_asset 1650 + status)
-- ============================================================================

CREATE OR REPLACE FUNCTION post_depreciation_to_ledger(p_depreciation_entry_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_asset_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_asset_name TEXT;
  v_existing_je_id UUID;
  v_depreciation_expense_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  SELECT de.business_id, de.asset_id, de.amount, de.date, a.name, de.journal_entry_id
  INTO v_business_id, v_asset_id, v_amount, v_date, v_asset_name, v_existing_je_id
  FROM depreciation_entries de
  JOIN assets a ON a.id = de.asset_id
  WHERE de.id = p_depreciation_entry_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation entry not found';
  END IF;

  IF v_existing_je_id IS NOT NULL THEN
    RAISE EXCEPTION 'Depreciation entry already posted (journal_entry_id: %)', v_existing_je_id;
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_date);

  SELECT depreciation_expense_account_id, accumulated_depreciation_account_id
  INTO v_depreciation_expense_account_id, v_accumulated_depreciation_account_id
  FROM public.finza_resolve_asset_depreciation_accounts(v_business_id);

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_date, 'Depreciation: ' || v_asset_name, 'depreciation', p_depreciation_entry_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_depreciation_expense_account_id, v_amount, 0, 'Depreciation Expense'),
    (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_amount, 'Accumulated Depreciation');

  UPDATE depreciation_entries
  SET journal_entry_id = v_journal_entry_id,
      status = COALESCE(status, 'posted'),
      posted_at = COALESCE(posted_at, NOW()),
      updated_at = NOW()
  WHERE id = p_depreciation_entry_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_depreciation_to_ledger(UUID) IS
  'Legacy/backfill depreciation posting. Uses finza_resolve_asset_depreciation_accounts (supports contra_asset 1650).';

-- ============================================================================
-- STEP 6: RLS hardening for depreciation_entries
-- ============================================================================

ALTER TABLE public.depreciation_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view depreciation entries for their business" ON public.depreciation_entries;
DROP POLICY IF EXISTS "Users can insert depreciation entries for their business" ON public.depreciation_entries;
DROP POLICY IF EXISTS "Users can update depreciation entries for their business" ON public.depreciation_entries;
DROP POLICY IF EXISTS "Users can delete depreciation entries for their business" ON public.depreciation_entries;

CREATE POLICY "depreciation_entries: business members select"
  ON public.depreciation_entries FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "service trial write insert depreciation_entries"
  ON public.depreciation_entries FOR INSERT
  WITH CHECK (public.finza_service_trial_rls_can_write(business_id));

CREATE POLICY "service trial write update depreciation_entries"
  ON public.depreciation_entries FOR UPDATE
  USING (public.finza_service_trial_rls_can_write(business_id))
  WITH CHECK (public.finza_service_trial_rls_can_write(business_id));

DROP POLICY IF EXISTS "service trial write delete depreciation_entries" ON public.depreciation_entries;

CREATE POLICY "service trial write delete depreciation_entries"
  ON public.depreciation_entries FOR DELETE
  USING (
    public.finza_service_trial_rls_can_write(business_id)
    AND journal_entry_id IS NULL
    AND status NOT IN ('posted', 'adjusted', 'reversed', 'reversal')
  );

-- Block hard delete and soft-delete of posted accounting records at trigger level
CREATE OR REPLACE FUNCTION public.finza_depreciation_entries_prevent_posted_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.journal_entry_id IS NOT NULL
       OR OLD.status IN ('posted', 'adjusted', 'reversed', 'reversal') THEN
      RAISE EXCEPTION 'ACCOUNTING_RECORD_IMMUTABLE: Posted depreciation entries cannot be deleted. Use reverse_asset_depreciation.';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       AND NEW.deleted_at IS NOT NULL
       AND (
         OLD.journal_entry_id IS NOT NULL
         OR OLD.status IN ('posted', 'adjusted', 'reversed', 'reversal')
       ) THEN
      RAISE EXCEPTION 'ACCOUNTING_RECORD_IMMUTABLE: Posted depreciation entries cannot be deleted. Use reverse_asset_depreciation.';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_depreciation_entries_prevent_posted_delete ON public.depreciation_entries;

CREATE TRIGGER trg_depreciation_entries_prevent_posted_delete
  BEFORE DELETE OR UPDATE ON public.depreciation_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_depreciation_entries_prevent_posted_delete();

COMMENT ON FUNCTION public.finza_depreciation_entries_prevent_posted_delete() IS
  'Prevents DELETE or soft-delete (deleted_at) of posted depreciation accounting records.';
