-- ============================================================================
-- Migration 292: Credit note as negative invoice — allow revenue journal lines
-- ============================================================================
-- Treat credit note posting as a negative invoice event: allow revenue (4000)
-- when reference_type = 'credit_note' and reference_id is an applied credit
-- note for the business. No new accounts; post_credit_note_to_ledger already
-- mirrors invoice account mapping (AR, revenue 4000, tax from canonical lines).
-- ============================================================================

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL,
  p_posting_source TEXT DEFAULT NULL,
  p_is_revenue_correction BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  system_accountant_id UUID;
  revenue_account_id UUID;
  has_revenue_line BOOLEAN := FALSE;
  invoice_status TEXT;
  v_scale INT := 2;
  v_currency TEXT;
  v_timezone TEXT;
  v_normalized_date DATE;
  v_period_id UUID;
  v_accounting_start_date DATE;
BEGIN
  IF p_posting_source IS NULL THEN
    RAISE EXCEPTION 'posting_source is required and must be explicitly set to ''system'' or ''accountant''';
  END IF;
  IF p_posting_source NOT IN ('system', 'accountant') THEN
    RAISE EXCEPTION 'posting_source must be ''system'' or ''accountant''. Found: %', p_posting_source;
  END IF;

  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    IF p_reference_id IS NOT NULL AND COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL unless explicitly a revenue correction (is_revenue_correction = true).';
    END IF;
  ELSE
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  revenue_account_id := get_account_by_code(p_business_id, '4000');
  IF revenue_account_id IS NOT NULL THEN
    FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      IF (line->>'account_id')::UUID = revenue_account_id THEN
        has_revenue_line := TRUE;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF has_revenue_line THEN
    IF p_reference_type = 'payment' THEN
      RAISE EXCEPTION 'Revenue is recognized only on invoice issuance. Payments cannot post revenue.';
    END IF;
    IF p_reference_type = 'invoice' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status FROM invoices WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Draft invoices cannot post revenue. Issue the invoice first.';
      END IF;
    ELSIF p_reference_type = 'credit_note' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries for credit notes must reference the credit note (reference_id required).';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM credit_notes
        WHERE id = p_reference_id
          AND business_id = p_business_id
          AND status = 'applied'
          AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Revenue journal lines for credit_note must reference an applied credit note. Credit note not found or not applied: %', p_reference_id;
      END IF;
    ELSIF p_reference_type IN ('adjustment', 'reconciliation') THEN
      IF COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Reconciliation/adjustment entries cannot post revenue unless explicitly flagged as revenue correction (is_revenue_correction = true).';
      END IF;
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue correction entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status FROM invoices WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Draft invoice: %', p_reference_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Revenue journal lines are only allowed for invoice issuance (reference_type = invoice), credit notes (reference_type = credit_note), or explicitly flagged revenue corrections (reference_type = adjustment/reconciliation, is_revenue_correction = true).';
    END IF;
  END IF;

  -- Contract v1.1: currency scale and timezone before balance check and period lookup
  SELECT COALESCE(default_currency, 'USD')
  INTO v_currency
  FROM businesses
  WHERE id = p_business_id;
  v_scale := get_currency_scale(v_currency);

  SELECT timezone, accounting_start_date INTO v_timezone, v_accounting_start_date
  FROM businesses
  WHERE id = p_business_id;
  v_normalized_date := (p_date::timestamp AT TIME ZONE COALESCE(v_timezone, 'UTC'))::date;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit +
      ROUND(COALESCE((line->>'debit')::NUMERIC, 0), v_scale);
    total_credit := total_credit +
      ROUND(COALESCE((line->>'credit')::NUMERIC, 0), v_scale);
  END LOOP;
  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  IF p_posting_source = 'system' AND p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id FROM businesses WHERE id = p_business_id;
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
  END IF;

  -- Contract v2.0 Adoption Boundary Enforcement
  IF v_accounting_start_date IS NOT NULL AND v_normalized_date < v_accounting_start_date THEN
    IF COALESCE(TRIM(p_entry_type), '') NOT IN ('opening_balance', 'backfill') THEN
      RAISE EXCEPTION 'Posting date precedes accounting adoption date. Use opening balance or backfill.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Contract v1.1: period assignment (using normalized date)
  SELECT id INTO v_period_id
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND v_normalized_date >= period_start
    AND v_normalized_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;
  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for business % and date %. Posting is not allowed.', p_business_id, v_normalized_date
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_accounting_period_is_open(p_business_id, v_normalized_date);

  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    entry_type,
    backfill_reason,
    backfill_actor,
    posted_by_accountant_id,
    posting_source,
    period_id
  )
  VALUES (
    p_business_id,
    v_normalized_date,
    p_description,
    p_reference_type,
    p_reference_id,
    COALESCE(p_created_by, system_accountant_id, p_posted_by_accountant_id),
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    COALESCE(p_posted_by_accountant_id, system_accountant_id),
    p_posting_source,
    v_period_id
  )
  RETURNING id INTO journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    journal_id,
    (jl->>'account_id')::UUID,
    ROUND(COALESCE((jl->>'debit')::NUMERIC, 0)::NUMERIC, v_scale),
    ROUND(COALESCE((jl->>'credit')::NUMERIC, 0)::NUMERIC, v_scale),
    jl->>'description'
  FROM jsonb_array_elements(p_lines) AS jl;

  RETURN journal_id;
END;
$$;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) IS
  'Posts journal entry. Revenue: allowed for invoice, credit_note (applied), or adjustment/reconciliation with is_revenue_correction. Contract v1.1: period_id, rounding. Contract v2.0: adoption boundary.';

-- Document credit note posting as negative invoice event (logic unchanged in 190)
COMMENT ON FUNCTION post_credit_note_to_ledger(UUID) IS
  'Negative invoice event: Cr AR (total), Dr Revenue (4000), reverse tax from canonical tax_lines. Mirrors invoice account mapping. Idempotency and period open enforced by trigger and RPC.';
