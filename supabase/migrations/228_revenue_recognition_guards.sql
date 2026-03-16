-- ============================================================================
-- Migration: Revenue recognition policy at the accounting layer
-- ============================================================================
-- Policy: Revenue is recognized only when an invoice is issued (sent).
--
-- Safeguards:
-- 1. Revenue JEs can only be created during invoice issuance (reference_type
--    = 'invoice', reference_id = issued invoice) or as an explicitly flagged
--    revenue correction (is_revenue_correction = true, reference_id = issued
--    invoice).
-- 2. Draft invoices cannot post revenue (post_invoice_to_ledger raises;
--    post_journal_entry rejects revenue lines for draft invoice refs).
-- 3. Payments cannot post revenue (post_journal_entry rejects JEs with
--    reference_type = 'payment' that contain a revenue line).
-- 4. Reconciliation/adjustment JEs cannot post revenue unless explicitly
--    flagged as revenue correction (is_revenue_correction = true and
--    reference_id = issued invoice).
-- 5. All revenue JEs must reference an issued invoice (reference_id must
--    be an invoice with status != 'draft').
--
-- Revenue account: code 4000 (same as invoice issuance). No schema changes.
-- ============================================================================

-- Revenue account: code 4000 (same as invoice issuance). Resolved via get_account_by_code (accounts table).

-- ============================================================================
-- STEP 1: Replace canonical post_journal_entry with 16-param version
-- (add p_is_revenue_correction). Enforce revenue recognition rules before INSERT.
-- ============================================================================
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT) CASCADE;

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
RETURNS UUID AS $$
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
BEGIN
  -- Validate posting_source is provided
  IF p_posting_source IS NULL THEN
    RAISE EXCEPTION 'posting_source is required and must be explicitly set to ''system'' or ''accountant''';
  END IF;

  IF p_posting_source NOT IN ('system', 'accountant') THEN
    RAISE EXCEPTION 'posting_source must be ''system'' or ''accountant''. Found: %', p_posting_source;
  END IF;

  -- PHASE 6: Validate adjustment metadata
  -- Allow reference_id when is_revenue_correction = true (adjustment correcting revenue for an invoice)
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

  -- PHASE 12: Backfill entries must have reason and actor
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  -- Revenue recognition guard: detect if any line posts to revenue (account code 4000)
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
    -- Policy: Revenue is recognized only on invoice issuance. All revenue JEs must reference an issued invoice.
    IF p_reference_type = 'payment' THEN
      RAISE EXCEPTION 'Revenue is recognized only on invoice issuance. Payments cannot post revenue.';
    END IF;

    IF p_reference_type = 'invoice' THEN
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status
      FROM invoices
      WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue journal entries must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Draft invoices cannot post revenue. Issue the invoice first.';
      END IF;
    ELSIF p_reference_type IN ('adjustment', 'reconciliation') THEN
      IF COALESCE(p_is_revenue_correction, FALSE) = FALSE THEN
        RAISE EXCEPTION 'Reconciliation/adjustment entries cannot post revenue unless explicitly flagged as revenue correction (is_revenue_correction = true).';
      END IF;
      IF p_reference_id IS NULL THEN
        RAISE EXCEPTION 'Revenue correction entries must reference an issued invoice (reference_id required).';
      END IF;
      SELECT status INTO invoice_status
      FROM invoices
      WHERE id = p_reference_id AND business_id = p_business_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Invoice not found: %', p_reference_id;
      END IF;
      IF invoice_status = 'draft' THEN
        RAISE EXCEPTION 'Revenue correction must reference an issued invoice. Draft invoice: %', p_reference_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Revenue journal lines are only allowed for invoice issuance (reference_type = invoice) or explicitly flagged revenue corrections (reference_type = adjustment/reconciliation, is_revenue_correction = true).';
    END IF;
  END IF;

  -- Validate that debits equal credits BEFORE inserting
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Get system accountant (for system postings when posted_by_accountant_id not provided)
  IF p_posting_source = 'system' AND p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = p_business_id;
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
  END IF;

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
    posting_source
  )
  VALUES (
    p_business_id,
    p_date,
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
    p_posting_source
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
    COALESCE((jl->>'debit')::NUMERIC, 0),
    COALESCE((jl->>'credit')::NUMERIC, 0),
    jl->>'description'
  FROM jsonb_array_elements(p_lines) AS jl;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) IS
  'Posts journal entry. Enforces revenue recognition: revenue (account 4000) may only be posted on invoice issuance or explicitly flagged revenue corrections referencing an issued invoice. Payments and draft invoices cannot post revenue.';

-- ============================================================================
-- STEP 2: Update 14-parameter wrapper to call 16-param with p_is_revenue_correction = FALSE
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
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
  RETURN post_journal_entry(
    p_business_id => p_business_id,
    p_date => p_date,
    p_description => p_description,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_lines => p_lines,
    p_is_adjustment => p_is_adjustment,
    p_adjustment_reason => p_adjustment_reason,
    p_adjustment_ref => p_adjustment_ref,
    p_created_by => p_created_by,
    p_entry_type => p_entry_type,
    p_backfill_reason => p_backfill_reason,
    p_backfill_actor => p_backfill_actor,
    p_posted_by_accountant_id => p_posted_by_accountant_id,
    p_posting_source => 'accountant',
    p_is_revenue_correction => FALSE
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: post_invoice_to_ledger — guard: draft invoices cannot post to ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_invoice_to_ledger(
  p_invoice_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  gross NUMERIC;
  posting_date DATE;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  ar_account_code TEXT;
  tax_lines_posted INTEGER := 0;
  existing_je_id UUID;
BEGIN
  -- Revenue recognition policy: draft invoices cannot post. Revenue is recognized only when invoice is issued (sent).
  SELECT 
    i.business_id,
    i.total,
    i.subtotal,
    i.total_tax,
    i.customer_id,
    i.invoice_number,
    i.issue_date,
    i.sent_at,
    i.tax_lines,
    i.status
  INTO invoice_record
  FROM invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  IF invoice_record.status = 'draft' THEN
    RAISE EXCEPTION 'Draft invoices cannot post to ledger. Issue the invoice first. Revenue is recognized only on issuance.';
  END IF;

  business_id_val := invoice_record.business_id;
  subtotal := COALESCE(invoice_record.subtotal, 0);
  gross := COALESCE(invoice_record.total, 0);
  IF gross = 0 THEN
    gross := COALESCE(invoice_record.subtotal, 0) + COALESCE(invoice_record.total_tax, 0);
  END IF;

  posting_date := COALESCE(
    (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
    invoice_record.issue_date
  );
  IF posting_date IS NULL THEN
    RAISE EXCEPTION 'Invoice has no issue_date or sent_at. Cannot post to ledger. Invoice id: %', p_invoice_id;
  END IF;

  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %', business_id_val;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_invoice_id::text));

  SELECT je.id INTO existing_je_id
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.business_id = business_id_val
    AND je.reference_type = 'invoice'
    AND je.reference_id = p_invoice_id
    AND jel.account_id = ar_account_id
  LIMIT 1;

  IF existing_je_id IS NOT NULL THEN
    RETURN existing_je_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, posting_date);

  PERFORM assert_account_exists(business_id_val, '4000');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;

  tax_lines_jsonb := invoice_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF tax_lines_jsonb ? 'tax_lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'lines';
      END IF;
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'debit', gross,
      'description', 'Invoice receivable'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Service revenue'
    )
  );

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
        tax_lines_posted := tax_lines_posted + 1;
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
        tax_lines_posted := tax_lines_posted + 1;
      END IF;
    END IF;
  END LOOP;

  IF COALESCE(invoice_record.total_tax, 0) > 0 AND tax_lines_posted = 0 THEN
    RAISE EXCEPTION 'Invoice total_tax > 0 but no tax journal lines were posted. Aborting to prevent silent imbalance.';
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    posting_date,
    'Invoice #' || COALESCE(invoice_record.invoice_number, p_invoice_id::TEXT),
    'invoice',
    p_invoice_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,
    'system',
    FALSE
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_to_ledger(UUID, TEXT, TEXT, TEXT) IS
  'Accrual AR posting at invoice finalisation. Revenue recognition: only issued (non-draft) invoices may post. Dr AR / Cr Revenue (gross). Idempotent: skip if issuance JE exists. Draft invoices raise: "Draft invoices cannot post to ledger. Issue the invoice first."';
