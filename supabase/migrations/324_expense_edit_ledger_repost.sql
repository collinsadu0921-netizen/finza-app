-- ============================================================================
-- Expense edit → ledger: reverse prior posting + post new (immutable-safe)
-- ============================================================================
-- Phase B: When a posted expense is edited, ledger reflects change by:
-- 1. Reversal JE (opposite debits/credits of prior posting)
-- 2. New JE for current expense amounts
-- No edits to existing ledger rows. Idempotent. business_id scoped. Retail untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Add reverses_entry_id to journal_entries (link reversal → original)
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS reverses_entry_id UUID REFERENCES journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reverses_entry_id
  ON journal_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

COMMENT ON COLUMN journal_entries.reverses_entry_id IS
  'When set, this journal entry is a reversal of the referenced entry. Used for expense edit repost and other reversal flows.';

-- ----------------------------------------------------------------------------
-- STEP 2: Extend post_journal_entry with optional p_reverses_entry_id
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN) CASCADE;

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
  'Posts journal entry. Optional reverses_entry_id links reversal JEs to original. Revenue: allowed for invoice, credit_note (applied), or adjustment/reconciliation with is_revenue_correction. Call with 16 args (omit p_reverses_entry_id) for backward compatibility.';

-- ----------------------------------------------------------------------------
-- STEP 3: Relax expense guard — allow UPDATE when posted; block DELETE only
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_expense_immutable_after_posting()
RETURNS TRIGGER AS $$
BEGIN
  -- DELETE: block if expense has any journal entry (posted)
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'expense' AND reference_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Posted expenses are immutable. Create a correcting expense or adjustment.';
    END IF;
  END IF;

  -- UPDATE and DELETE: block if expense date falls in closed or locked period
  BEGIN
    PERFORM assert_accounting_period_is_open(OLD.business_id, OLD.date);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot modify expenses in a closed or locked accounting period.';
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION guard_expense_immutable_after_posting IS
  'Blocks DELETE on expenses that have a journal entry (posted). Allows UPDATE (edit triggers reverse+repost). Blocks UPDATE/DELETE when expense date is in closed/locked period.';

-- ----------------------------------------------------------------------------
-- STEP 4: post_expense_to_ledger — idempotency by "unreversed current" JE only
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_expense_to_ledger(
  p_expense_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  expense_row RECORD;
  business_id_val UUID;
  expense_account_id UUID;
  cash_account_id UUID;
  journal_id UUID;
  cash_account_code TEXT;
  v_subtotal NUMERIC;
  v_total_tax NUMERIC;
  v_description TEXT;
  journal_lines JSONB;
  v_nhil NUMERIC;
  v_getfund NUMERIC;
  v_vat NUMERIC;
  v_covid NUMERIC;
BEGIN
  -- Idempotency: already posted (current = unreversed JE for this expense)
  SELECT je.id INTO journal_id
  FROM journal_entries je
  WHERE je.reference_type = 'expense' AND je.reference_id = p_expense_id
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id
    )
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT
    ex.business_id,
    ex.category_id,
    ex.supplier,
    ex.amount,
    COALESCE(ex.nhil, 0) AS nhil,
    COALESCE(ex.getfund, 0) AS getfund,
    COALESCE(ex.vat, 0) AS vat,
    COALESCE(ex.covid, 0) AS covid,
    ex.total,
    ex.date,
    ex.notes
  INTO expense_row
  FROM expenses ex
  WHERE ex.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id;
  END IF;

  business_id_val := expense_row.business_id;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_expense_id::text));

  -- Re-check idempotency after lock
  SELECT je.id INTO journal_id
  FROM journal_entries je
  WHERE je.reference_type = 'expense' AND je.reference_id = p_expense_id
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id
    )
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  v_nhil   := expense_row.nhil;
  v_getfund := expense_row.getfund;
  v_vat    := expense_row.vat;
  v_covid  := CASE WHEN expense_row.covid > 0 THEN expense_row.covid ELSE 0 END;
  v_total_tax := v_nhil + v_getfund + v_vat + v_covid;

  IF v_total_tax > 0 AND expense_row.total IS NOT NULL THEN
    v_subtotal := expense_row.total - v_total_tax;
    IF v_subtotal < 0 THEN
      RAISE EXCEPTION 'Expense total (%) is less than sum of taxes (%). Fix amount/total/tax fields for expense %', expense_row.total, v_total_tax, p_expense_id;
    END IF;
  ELSE
    v_subtotal := COALESCE(expense_row.amount, expense_row.total, 0);
  END IF;

  v_description := 'Expense: ' || COALESCE(NULLIF(TRIM(expense_row.supplier), ''), NULLIF(TRIM(expense_row.notes), ''), 'General expense');

  PERFORM assert_accounting_period_is_open(business_id_val, expense_row.date);

  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '5100');

  IF v_nhil > 0 THEN PERFORM assert_account_exists(business_id_val, '2110'); END IF;
  IF v_getfund > 0 THEN PERFORM assert_account_exists(business_id_val, '2120'); END IF;
  IF v_vat > 0 THEN PERFORM assert_account_exists(business_id_val, '2100'); END IF;
  IF v_covid > 0 THEN PERFORM assert_account_exists(business_id_val, '2130'); END IF;

  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  expense_account_id := get_account_by_code(business_id_val, '5100');

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', v_subtotal,
      'description', 'Operating expense'
    ),
    jsonb_build_object(
      'account_id', cash_account_id,
      'credit', expense_row.total,
      'description', 'Cash payment'
    )
  );

  IF v_vat > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2100'),
        'debit', v_vat,
        'description', 'VAT input tax'
      )
    );
  END IF;
  IF v_nhil > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2110'),
        'debit', v_nhil,
        'description', 'NHIL input tax'
      )
    );
  END IF;
  IF v_getfund > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2120'),
        'debit', v_getfund,
        'description', 'GETFund input tax'
      )
    );
  END IF;
  IF v_covid > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2130'),
        'debit', v_covid,
        'description', 'COVID levy (legacy) input tax'
      )
    );
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    expense_row.date,
    v_description,
    'expense',
    p_expense_id,
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
    FALSE,
    NULL::UUID
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_expense_to_ledger(UUID, TEXT, TEXT, TEXT) IS
  'Posts expense to ledger. Idempotent: skips if unreversed JE exists for this expense. Used on insert (trigger) and after edit (repost).';

-- ----------------------------------------------------------------------------
-- STEP 5: repost_expense_to_ledger — reverse prior posting + post new
-- Idempotent: no-op if no current JE (first post is on insert) or already
-- reposted for this update (current JE created_at >= expense.updated_at).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION repost_expense_to_ledger(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expense_row RECORD;
  business_id_val UUID;
  current_je_id UUID;
  current_je_created_at TIMESTAMPTZ;
  reversal_lines JSONB;
  rev_je_id UUID;
  new_je_id UUID;
  v_je_date DATE;
BEGIN
  SELECT id, business_id, updated_at
  INTO expense_row
  FROM expenses
  WHERE id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id;
  END IF;

  business_id_val := expense_row.business_id;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_expense_id::text));

  -- Current posting = unreversed JE for this expense
  SELECT je.id, je.created_at
  INTO current_je_id, current_je_created_at
  FROM journal_entries je
  WHERE je.reference_type = 'expense' AND je.reference_id = p_expense_id
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id
    )
  LIMIT 1;

  -- No current JE: never posted or only reversals exist; first post is on INSERT only — do nothing
  IF current_je_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotency: already reposted for this update (new JE created after this expense update)
  IF current_je_created_at >= (expense_row.updated_at - INTERVAL '1 second') THEN
    RETURN current_je_id;
  END IF;

  -- Build reversal lines: same accounts, swap debit/credit
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'account_id', jel.account_id,
      'debit', jel.credit,
      'credit', jel.debit,
      'description', COALESCE(jel.description, '') || ' (reversal)'
    )
  ), '[]'::JSONB) INTO reversal_lines
  FROM journal_entry_lines jel
  WHERE jel.journal_entry_id = current_je_id;

  -- Period and balance are preserved by reversal; use same date as original
  SELECT je.date INTO v_je_date FROM journal_entries je WHERE je.id = current_je_id;

  SELECT post_journal_entry(
    business_id_val,
    v_je_date,
    'Expense edit reversal (expense ' || p_expense_id::TEXT || ')',
    'expense_reversal',
    p_expense_id,
    reversal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system',
    FALSE,
    current_je_id
  ) INTO rev_je_id;

  -- Post new JE for current expense amounts (post_expense_to_ledger now sees no unreversed current)
  new_je_id := post_expense_to_ledger(p_expense_id);

  RETURN new_je_id;
END;
$$;

COMMENT ON FUNCTION repost_expense_to_ledger(UUID) IS
  'On expense edit: reverses prior expense posting then posts new JE for current amounts. Idempotent. No-op if not posted or already reposted for this update.';
