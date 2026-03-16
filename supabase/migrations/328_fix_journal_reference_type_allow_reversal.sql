-- ============================================================================
-- Migration 328: Fix journal reference_type constraint — allow reversal entries
-- ============================================================================
-- BUG: Clicking "Reverse" on General Ledger raised:
--   "Adjustment entries must have reference_type = 'adjustment'. Found: reversal"
--
-- ROOT CAUSE:
-- 1. post_journal_entry() required p_reference_type = 'adjustment' whenever
--    p_is_adjustment = TRUE. Reversal API correctly passes p_is_adjustment = true
--    and p_reference_type = 'reversal' (with p_reference_id = original JE id).
-- 2. CHECK constraint journal_entries_adjustment_reference_type_check allowed
--    only (is_adjustment AND reference_type = 'adjustment').
-- 3. Trigger validate_period_open_for_entry (soft_closed path) required
--    reference_type = 'adjustment' and reference_id IS NULL for adjustments.
--
-- FIX:
-- 1. In post_journal_entry: when p_is_adjustment = TRUE, allow
--    p_reference_type IN ('adjustment', 'reversal'). For 'reversal' require
--    p_reference_id IS NOT NULL. For 'adjustment' keep existing rules.
-- 2. In validate_period_open_for_entry: when soft_closed and is_adjustment,
--    allow reference_type IN ('adjustment', 'reversal'); adjustment requires
--    reference_id IS NULL; reversal requires reference_id IS NOT NULL.
-- 3. Relax CHECK constraints to allow (is_adjustment AND reference_type =
--    'reversal' AND reference_id IS NOT NULL) in addition to existing rules.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: post_journal_entry — allow reference_type = 'reversal' when
--         p_is_adjustment = TRUE; require reference_id IS NOT NULL for reversal
-- ----------------------------------------------------------------------------
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
  p_is_revenue_correction BOOLEAN DEFAULT FALSE,
  p_reverses_entry_id UUID DEFAULT NULL
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

  -- Scoped: only enforce adjustment-specific rules when entry IS an adjustment
  -- or a reversal (both use is_adjustment for period rules). Allow reference_type
  -- 'adjustment' (standalone) or 'reversal' (references original JE).
  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type NOT IN ('adjustment', 'reversal') THEN
      RAISE EXCEPTION 'Adjustment/reversal entries must have reference_type = ''adjustment'' or ''reversal''. Found: %', p_reference_type;
    END IF;
    IF p_reference_type = 'reversal' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Reversal entries must have reference_id = original journal entry id.';
      END IF;
    ELSIF p_reference_type = 'adjustment' THEN
      IF p_reference_id IS NOT NULL AND COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL unless explicitly a revenue correction (is_revenue_correction = true).';
      END IF;
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
    ELSIF p_reference_type = 'reversal' THEN
      -- Reversals can contain revenue lines (reversing original entry); no extra validation
      NULL;
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
      RAISE EXCEPTION 'Revenue journal lines are only allowed for invoice issuance (reference_type = invoice), credit notes (reference_type = credit_note), reversals (reference_type = reversal), or explicitly flagged revenue corrections (reference_type = adjustment/reconciliation, is_revenue_correction = true).';
    END IF;
  END IF;

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

  IF v_accounting_start_date IS NOT NULL AND v_normalized_date < v_accounting_start_date THEN
    IF COALESCE(TRIM(p_entry_type), '') NOT IN ('opening_balance', 'backfill') THEN
      RAISE EXCEPTION 'Posting date precedes accounting adoption date. Use opening balance or backfill.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

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

  PERFORM assert_accounting_period_is_open(p_business_id, v_normalized_date, p_is_adjustment);

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
    period_id,
    reverses_entry_id
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
    v_period_id,
    p_reverses_entry_id
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

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID) IS
  'Posts journal entry. Allows reference_type = reversal when is_adjustment (General Ledger Reverse). Optional reverses_entry_id links reversal JEs to original.';

-- ----------------------------------------------------------------------------
-- STEP 2: validate_period_open_for_entry — allow reference_type = 'reversal'
--          with reference_id IS NOT NULL when is_adjustment and soft_closed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_period_open_for_entry()
RETURNS TRIGGER AS $$
DECLARE
  period_record RECORD;
BEGIN
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = NEW.business_id
    AND NEW.date >= period_start
    AND NEW.date <= period_end
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No accounting period found for date %. Period must exist before posting. Business ID: %',
      NEW.date, NEW.business_id;
  END IF;

  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into locked period (period_start: %). Journal entries are blocked for locked periods. Period ID: %, Date: %',
      period_record.period_start, period_record.id, NEW.date;
  END IF;

  IF period_record.status = 'soft_closed' THEN
    IF COALESCE(NEW.is_adjustment, FALSE) = TRUE THEN
      -- Adjustments and reversals allowed in soft_closed
      IF NEW.adjustment_reason IS NULL OR TRIM(NEW.adjustment_reason) = '' THEN
        RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
      END IF;
      IF NEW.reference_type NOT IN ('adjustment', 'reversal') THEN
        RAISE EXCEPTION 'Adjustment/reversal entries must have reference_type = ''adjustment'' or ''reversal''. Found: %', NEW.reference_type;
      END IF;
      IF NEW.reference_type = 'adjustment' AND NEW.reference_id IS NOT NULL THEN
        RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL';
      END IF;
      IF NEW.reference_type = 'reversal' AND NEW.reference_id IS NULL THEN
        RAISE EXCEPTION 'Reversal entries must have reference_id = original journal entry id.';
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked. Only adjustments and reversals are allowed in soft-closed periods. Period ID: %, Date: %',
        period_record.period_start, period_record.id, NEW.date;
    END IF;
  END IF;

  IF period_record.status != 'open' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into period with status ''%'' (period_start: %). Only periods with status ''open'' allow regular postings. Period ID: %, Date: %',
      period_record.status, period_record.period_start, period_record.id, NEW.date;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_period_open_for_entry() IS
  'PHASE 6 + 328: Blocks regular entries into locked/soft_closed periods. Allows adjustments (reference_type=adjustment, reference_id NULL) and reversals (reference_type=reversal, reference_id=original JE id) in soft_closed with required adjustment_reason.';

-- ----------------------------------------------------------------------------
-- STEP 3: Relax CHECK constraints — allow reference_type = 'reversal'
--         when is_adjustment = TRUE (with reference_id NOT NULL)
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_adjustment_reference_type_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_adjustment_reference_type_check
  CHECK (
    (is_adjustment = FALSE) OR
    (is_adjustment = TRUE AND reference_type IN ('adjustment', 'reversal'))
  );

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_adjustment_no_operational_ref_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_adjustment_no_operational_ref_check
  CHECK (
    (is_adjustment = FALSE) OR
    (is_adjustment = TRUE AND reference_type = 'adjustment' AND reference_id IS NULL) OR
    (is_adjustment = TRUE AND reference_type = 'reversal' AND reference_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT journal_entries_adjustment_reference_type_check ON journal_entries IS
  'When is_adjustment = TRUE, reference_type must be adjustment (standalone) or reversal (references original JE).';
COMMENT ON CONSTRAINT journal_entries_adjustment_no_operational_ref_check ON journal_entries IS
  'Adjustments: reference_id must be NULL. Reversals: reference_id must be original journal entry id. Prevents disguising operational posts as adjustments.';
