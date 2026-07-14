-- Migration 527: Phase 1A safety corrections (staging delta over applied 526)
-- - No auto-create of COA accounts during depreciation posting
-- - Database-level immutability for posted depreciation entries
-- - Read-only reconciliation diagnostic RPC

-- ============================================================================
-- STEP 1: Account resolver — lookup only, never INSERT
-- ============================================================================

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
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Invalid depreciation expense account for business %', p_business_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
    WHERE id = v_accum_id
      AND business_id = p_business_id
      AND type IN ('contra_asset', 'asset')
      AND code = '1650'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Invalid accumulated depreciation account for business %', p_business_id;
  END IF;

  depreciation_expense_account_id := v_expense_id;
  accumulated_depreciation_account_id := v_accum_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finza_resolve_asset_depreciation_accounts(UUID) IS
  'Lookup-only: 5700 expense + 1650 contra_asset/asset. Raises ACCOUNT_CONFIGURATION_REQUIRED when missing. Never inserts accounts.';

-- ============================================================================
-- STEP 2: Legacy backfill path uses same resolver (no auto-create)
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

-- ============================================================================
-- STEP 3: Immutability trigger + RLS delete restriction
-- ============================================================================

DROP POLICY IF EXISTS "service trial write delete depreciation_entries" ON public.depreciation_entries;

CREATE POLICY "service trial write delete depreciation_entries"
  ON public.depreciation_entries FOR DELETE
  USING (
    public.finza_service_trial_rls_can_write(business_id)
    AND journal_entry_id IS NULL
    AND status NOT IN ('posted', 'adjusted', 'reversed', 'reversal')
  );

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

-- ============================================================================
-- STEP 4: Read-only reconciliation diagnostic RPC
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

  -- Incomplete entries: posted/adjusted status but no journal
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

  -- Register vs valid posted entries sum
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
      ON de.asset_id = a.id
     AND de.deleted_at IS NULL
     AND de.status IN ('posted', 'adjusted')
    WHERE a.deleted_at IS NULL
      AND (p_business_id IS NULL OR a.business_id = p_business_id)
    GROUP BY a.id, a.business_id, a.accumulated_depreciation
    HAVING ABS(a.accumulated_depreciation - COALESCE(SUM(de.amount), 0)) > 0.01
  LOOP
    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  -- Carrying value mismatch
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
        ),
      2)
    )
    FROM public.assets a
    WHERE a.deleted_at IS NULL
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
    WHERE de.deleted_at IS NULL
      AND de.journal_entry_id IS NOT NULL
      AND de.status IN ('posted', 'adjusted')
      AND (p_business_id IS NULL OR de.business_id = p_business_id)
    GROUP BY de.id, de.asset_id, de.business_id, de.amount, de.journal_entry_id
    HAVING ABS(de.amount - COALESCE(SUM(jel.debit), 0)) > 0.01
        OR ABS(de.amount - COALESCE(SUM(jel.credit), 0)) > 0.01
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

COMMENT ON FUNCTION public.finza_diagnose_asset_depreciation_reconciliation(UUID) IS
  'Read-only diagnostic: incomplete entries, register/entry/journal mismatches. Does not modify data.';

REVOKE ALL ON FUNCTION public.finza_diagnose_asset_depreciation_reconciliation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finza_diagnose_asset_depreciation_reconciliation(UUID) TO authenticated;
