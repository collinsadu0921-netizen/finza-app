-- ============================================================================
-- Migration 567: Fix create_loan_with_drawdown for journal immutability (566)
-- Journal entries cannot be UPDATEd after insert (migration 156).
-- Reorder: loan row → JE with reference on INSERT → link drawdown_journal_entry_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_loan_with_drawdown(
  p_business_id       UUID,
  p_user_id           UUID,
  p_entry_date        DATE,
  p_intent            JSONB,
  p_lender_name       TEXT DEFAULT NULL,
  p_interest_rate_pct NUMERIC DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_period_id          UUID;
  v_period_status      TEXT;
  v_owner_id           UUID;
  v_amount             NUMERIC;
  v_bank_account_id    UUID;
  v_loan_account_id    UUID;
  v_description        TEXT;
  v_journal_entry_id   UUID;
  v_loan_id            UUID;
BEGIN
  IF COALESCE(p_intent->>'intent_type', '') <> 'LOAN_DRAWDOWN' THEN
    RAISE EXCEPTION 'intent_type must be LOAN_DRAWDOWN';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
  IF v_owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the business owner can post service intents';
  END IF;

  SELECT id, status INTO v_period_id, v_period_status
  FROM public.accounting_periods
  WHERE business_id = p_business_id
    AND p_entry_date >= period_start
    AND p_entry_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for date %. Ensure the period exists.', p_entry_date;
  END IF;
  IF v_period_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post to a locked period. Choose another date.';
  END IF;

  v_amount          := (p_intent->>'amount')::NUMERIC;
  v_bank_account_id := (p_intent->>'bank_or_cash_account_id')::UUID;
  v_loan_account_id := (p_intent->>'loan_account_id')::UUID;
  v_description     := NULLIF(TRIM(COALESCE(p_intent->>'description', '')), '');

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid intent: a positive amount is required';
  END IF;
  IF v_bank_account_id IS NULL OR v_loan_account_id IS NULL THEN
    RAISE EXCEPTION 'Invalid intent: bank_or_cash_account_id and loan_account_id are required';
  END IF;

  INSERT INTO public.loans (
    business_id,
    lender_name,
    principal_amount,
    interest_rate_pct,
    start_date,
    loan_account_id,
    drawdown_journal_entry_id,
    notes
  ) VALUES (
    p_business_id,
    NULLIF(TRIM(COALESCE(p_lender_name, '')), ''),
    v_amount,
    p_interest_rate_pct,
    p_entry_date,
    v_loan_account_id,
    NULL,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_loan_id;

  INSERT INTO public.journal_entries (
    business_id, date, description,
    reference_type, reference_id,
    source_type, period_id,
    created_by, posted_by, posting_source
  ) VALUES (
    p_business_id,
    p_entry_date,
    COALESCE(v_description, 'Loan Drawdown'),
    'loan', v_loan_id,
    'service_intent', v_period_id,
    p_user_id, p_user_id, 'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_journal_entry_id, v_bank_account_id, v_amount, 0, 'Loan Drawdown'),
    (v_journal_entry_id, v_loan_account_id, 0, v_amount, 'Loan Drawdown');

  UPDATE public.loans
  SET drawdown_journal_entry_id = v_journal_entry_id
  WHERE id = v_loan_id;

  INSERT INTO public.loan_principal_ledger (
    business_id, loan_id, journal_entry_id, entry_kind, amount, entry_date
  ) VALUES (
    p_business_id, v_loan_id, v_journal_entry_id, 'drawdown', v_amount, p_entry_date
  );

  RETURN jsonb_build_object(
    'loan_id', v_loan_id,
    'journal_entry_id', v_journal_entry_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_loan_with_drawdown(UUID, UUID, DATE, JSONB, TEXT, NUMERIC, TEXT) IS
  'Atomic loan drawdown. JE reference set on INSERT (immutable journal constraint).';

GRANT EXECUTE ON FUNCTION public.create_loan_with_drawdown(UUID, UUID, DATE, JSONB, TEXT, NUMERIC, TEXT) TO authenticated;
