-- ============================================================================
-- Fix schema cache lookup: redefine post_service_intent_to_ledger with
-- parameters in alphabetical order (p_business_id, p_entry_date, p_intent, p_user_id)
-- so Supabase schema cache finds the function when RPC is called with named args.
-- ============================================================================

DROP FUNCTION IF EXISTS post_service_intent_to_ledger(UUID, UUID, DATE, JSONB);

CREATE OR REPLACE FUNCTION post_service_intent_to_ledger(
  p_business_id UUID,
  p_entry_date DATE,
  p_intent JSONB,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_period_id UUID;
  v_period_status TEXT;
  v_owner_id UUID;
  v_intent_type TEXT;
  v_amount NUMERIC;
  v_bank_account_id UUID;
  v_equity_account_id UUID;
  v_description TEXT;
  v_journal_entry_id UUID;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1) Authorize: must be business owner
  -- -------------------------------------------------------------------------
  SELECT owner_id INTO v_owner_id
  FROM businesses
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  IF v_owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the business owner can post service intents';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2) Resolve period and enforce not locked
  -- -------------------------------------------------------------------------
  SELECT id, status INTO v_period_id, v_period_status
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_entry_date >= period_start
    AND p_entry_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for date %. Ensure period exists for this business.', p_entry_date;
  END IF;

  IF v_period_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post to locked period. Choose another date.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 3) Parse intent (engine controls sides)
  -- -------------------------------------------------------------------------
  v_intent_type := p_intent->>'intent_type';
  v_amount := (p_intent->>'amount')::NUMERIC;
  v_bank_account_id := (p_intent->>'bank_or_cash_account_id')::UUID;
  v_equity_account_id := (p_intent->>'equity_account_id')::UUID;
  v_description := NULLIF(TRIM(COALESCE(p_intent->>'description', '')), '');

  IF v_intent_type IS NULL OR v_amount IS NULL OR v_amount <= 0 OR v_bank_account_id IS NULL OR v_equity_account_id IS NULL THEN
    RAISE EXCEPTION 'Invalid intent: intent_type, amount (positive), bank_or_cash_account_id, equity_account_id required';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4) Insert journal_entries (reference_type = 'manual', source_type = 'service_intent')
  -- -------------------------------------------------------------------------
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    source_type,
    period_id,
    created_by,
    posted_by,
    posting_source
  ) VALUES (
    p_business_id,
    p_entry_date,
    COALESCE(v_description, CASE v_intent_type
      WHEN 'OWNER_CONTRIBUTION' THEN 'Owner Contribution'
      WHEN 'OWNER_WITHDRAWAL' THEN 'Owner Withdrawal'
      ELSE 'Service intent'
    END),
    'manual',
    NULL,
    'service_intent',
    v_period_id,
    p_user_id,
    p_user_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  -- -------------------------------------------------------------------------
  -- 5) Insert lines in ONE statement (double-entry trigger)
  --    OWNER_CONTRIBUTION: DR bank/cash, CR equity
  --    OWNER_WITHDRAWAL:   DR equity, CR bank/cash
  -- -------------------------------------------------------------------------
  IF v_intent_type = 'OWNER_CONTRIBUTION' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_journal_entry_id, v_bank_account_id, v_amount, 0, 'Owner Contribution'),
      (v_journal_entry_id, v_equity_account_id, 0, v_amount, 'Owner Contribution');
  ELSIF v_intent_type = 'OWNER_WITHDRAWAL' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_journal_entry_id, v_equity_account_id, v_amount, 0, 'Owner Withdrawal'),
      (v_journal_entry_id, v_bank_account_id, 0, v_amount, 'Owner Withdrawal');
  ELSE
    RAISE EXCEPTION 'Unsupported intent_type: %', v_intent_type;
  END IF;

  RETURN v_journal_entry_id;
END;
$$;

COMMENT ON FUNCTION post_service_intent_to_ledger(UUID, DATE, JSONB, UUID) IS
'Service workspace only. Posts intent to ledger with engine-controlled debit/credit. Owner-only. Period must not be locked. Single INSERT for lines.';
