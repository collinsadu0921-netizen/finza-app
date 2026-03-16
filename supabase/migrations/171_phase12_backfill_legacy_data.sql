-- ============================================================================
-- MIGRATION: Phase 12 - Data Backfill & Legacy Data Conformance
-- ============================================================================
-- Brings historical (pre-invariant) data into compliance with the current
-- accounting model. NO AUTO-CORRECTION: all backfill is explicit and audited.
--
-- Constraints: No UI, POS, tax engine, or schema refactors except for
-- audit traceability. Data repair must be deterministic, auditable, reversible.
-- NO silent fixes — everything is logged.
-- ============================================================================

-- ============================================================================
-- STEP 1: SCHEMA — journal_entries backfill columns (audit traceability)
-- ============================================================================
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_type TEXT,
  ADD COLUMN IF NOT EXISTS backfill_reason TEXT,
  ADD COLUMN IF NOT EXISTS backfill_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS backfill_actor TEXT;

COMMENT ON COLUMN journal_entries.entry_type IS 'PHASE 12: ''backfill'' for Phase 12 backfilled entries; NULL for operational';
COMMENT ON COLUMN journal_entries.backfill_reason IS 'PHASE 12: Reason for backfill (e.g. sale missing journal entry)';
COMMENT ON COLUMN journal_entries.backfill_at IS 'PHASE 12: When the backfill was performed';
COMMENT ON COLUMN journal_entries.backfill_actor IS 'PHASE 12: Who performed the backfill (user UUID or ''system'')';

-- ============================================================================
-- STEP 2: backfill_audit_log (MANDATORY audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS backfill_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES accounting_periods(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action_taken TEXT NOT NULL,
  actor TEXT NOT NULL,
  before_summary JSONB,
  after_summary JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_audit_log_period_id ON backfill_audit_log(period_id);
CREATE INDEX IF NOT EXISTS idx_backfill_audit_log_entity ON backfill_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_backfill_audit_log_created_at ON backfill_audit_log(created_at);

COMMENT ON TABLE backfill_audit_log IS 'PHASE 12: Audit trail for every backfill action. No legacy data modified without an entry here.';

-- ============================================================================
-- STEP 3: ENHANCED post_journal_entry — add backfill params
-- ============================================================================
-- Add p_entry_type, p_backfill_reason, p_backfill_actor. When p_entry_type='backfill',
-- set entry_type, backfill_reason, backfill_at=NOW(), backfill_actor on INSERT.
-- Existing callers pass 6–10 args; 11–13 default to NULL.
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID);

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
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
BEGIN
  -- PHASE 6: Validate adjustment metadata
  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    IF p_reference_id IS NOT NULL THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL. Adjustments are standalone entries.';
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

  PERFORM assert_accounting_period_is_open(p_business_id, p_date, p_is_adjustment);

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry (including backfill columns when p_entry_type='backfill')
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    created_by,
    entry_type,
    backfill_reason,
    backfill_at,
    backfill_actor
  )
  VALUES (
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_created_by,
    CASE WHEN p_entry_type = 'backfill' THEN 'backfill' ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN p_backfill_reason ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN NOW() ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN p_backfill_actor ELSE NULL END
  )
  RETURNING id INTO journal_id;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := (line->>'account_id')::UUID;
    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account ID is NULL in journal entry line. Description: %', line->>'description';
    END IF;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->>'debit')::NUMERIC, 0),
      COALESCE((line->>'credit')::NUMERIC, 0),
      line->>'description'
    );
  END LOOP;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry IS 'PHASE 6/12: Creates journal entry. Supports adjustment and backfill metadata. Backfill: entry_type=backfill, backfill_reason, backfill_at, backfill_actor.';

-- ============================================================================
-- STEP 4: ENHANCED post_sale_to_ledger — optional backfill params
-- ============================================================================
-- Add p_entry_type, p_backfill_reason, p_backfill_actor. Pass to post_journal_entry
-- when provided. Existing callers pass 1 arg; backfill path passes 4.
-- Drop old 1-parameter version to avoid ambiguity
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID);

CREATE OR REPLACE FUNCTION post_sale_to_ledger(
  p_sale_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  business_id_val UUID;
  cash_account_id UUID;
  revenue_account_id UUID;
  cogs_account_id UUID;
  inventory_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  cash_account_code TEXT;
  total_cogs NUMERIC := 0;
  total_tax_amount NUMERIC := 0;
BEGIN
  SELECT s.business_id, s.amount, s.created_at, s.description, s.tax_lines
  INTO sale_record FROM sales s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;
  business_id_val := sale_record.business_id;
  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) INTO total_cogs FROM sale_items WHERE sale_id = p_sale_id;

  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  PERFORM assert_account_exists(business_id_val, '5000');
  PERFORM assert_account_exists(business_id_val, '1200');
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  cogs_account_id := get_account_by_code(business_id_val, '5000');
  inventory_account_id := get_account_by_code(business_id_val, '1200');

  IF cash_account_id IS NULL OR revenue_account_id IS NULL OR cogs_account_id IS NULL OR inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Required accounts not found for business: %', business_id_val;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object('account_id', cash_account_id, 'debit', sale_record.amount, 'description', 'Sale receipt'),
    jsonb_build_object('account_id', revenue_account_id, 'credit', subtotal, 'description', 'Sales revenue'),
    jsonb_build_object('account_id', cogs_account_id, 'debit', total_cogs, 'description', 'Cost of goods sold'),
    jsonb_build_object('account_id', inventory_account_id, 'credit', total_cogs, 'description', 'Inventory reduction')
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
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'credit', tax_amount, 'description', COALESCE(tax_code, 'Tax') || ' tax'));
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'debit', tax_amount, 'description', COALESCE(tax_code, 'Tax') || ' tax'));
      END IF;
    END IF;
  END LOOP;

  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger IS 'PHASE 12: Post sale to ledger. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';

-- ============================================================================
-- STEP 5: detect_legacy_issues — READ-ONLY, no side effects
-- ============================================================================
-- Identifies records created before p_invariant_enforcement_date that fail
-- current invariants. Returns structured JSONB. Does NOT modify data.
CREATE OR REPLACE FUNCTION detect_legacy_issues(
  p_business_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01'
)
RETURNS JSONB AS $$
DECLARE
  res JSONB;
  sales_without_je JSONB;
  invoices_without_je JSONB;
  expenses_without_je JSONB;
  payments_without_je JSONB;
  journal_entries_missing_lines JSONB;
  periods_without_opening_balances JSONB;
  periods_not_properly_closed JSONB;
  trial_balance_imbalance JSONB;
BEGIN
  -- Sales without journal entries (legacy only)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sale_id', s.id, 'created_at', s.created_at)), '[]'::jsonb) INTO sales_without_je
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.created_at::DATE < p_invariant_enforcement_date
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'sale' AND je.reference_id = s.id AND je.business_id = s.business_id
    );

  -- Invoices without journal entries (legacy, postable statuses)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', i.id, 'issue_date', i.issue_date)), '[]'::jsonb) INTO invoices_without_je
  FROM invoices i
  WHERE i.business_id = p_business_id
    AND i.issue_date < p_invariant_enforcement_date
    AND i.status IN ('sent', 'paid', 'partially_paid')
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'invoice' AND je.reference_id = i.id AND je.business_id = i.business_id
    );

  -- Expenses without journal entries (legacy, not deleted)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('expense_id', e.id, 'date', e.date)), '[]'::jsonb) INTO expenses_without_je
  FROM expenses e
  WHERE e.business_id = p_business_id
    AND e.date < p_invariant_enforcement_date
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'expense' AND je.reference_id = e.id AND je.business_id = e.business_id
    );

  -- Payments (invoice) without journal entries (legacy, not deleted)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('payment_id', p.id, 'date', p.date)), '[]'::jsonb) INTO payments_without_je
  FROM payments p
  WHERE p.business_id = p_business_id
    AND p.date < p_invariant_enforcement_date
    AND p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'payment' AND je.reference_id = p.id AND je.business_id = p.business_id
    );

  -- Journal entries with missing required lines (simplified: sale JEs without Cash/AR or Revenue) — FLAG ONLY, no repair (immutability)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('journal_entry_id', je.id, 'reference_type', je.reference_type, 'reference_id', je.reference_id, 'reason', 'missing_required_ledger_lines')), '[]'::jsonb) INTO journal_entries_missing_lines
  FROM journal_entries je
  WHERE je.business_id = p_business_id
    AND je.date < p_invariant_enforcement_date
    AND je.reference_type = 'sale'
    AND NOT EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = je.id
        AND ((a.code >= '1000' AND a.code < '1100' AND a.type = 'asset') OR (a.type = 'income' AND jel.credit > 0))
    );

  -- Periods (legacy) without any opening balances
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_id', ap.id, 'period_start', ap.period_start)), '[]'::jsonb) INTO periods_without_opening_balances
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start < p_invariant_enforcement_date
    AND NOT EXISTS (SELECT 1 FROM period_opening_balances pob WHERE pob.period_id = ap.id);

  -- Periods not properly closed/locked (legacy: status should be soft_closed or locked for old periods)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_id', ap.id, 'period_start', ap.period_start, 'status', ap.status)), '[]'::jsonb) INTO periods_not_properly_closed
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start < p_invariant_enforcement_date
    AND ap.status NOT IN ('soft_closed', 'locked');

  -- Trial balance imbalance: periods where snapshot exists and is_balanced = false
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_id', tbs.period_id, 'difference', tbs.balance_difference, 'total_debits', tbs.total_debits, 'total_credits', tbs.total_credits)), '[]'::jsonb) INTO trial_balance_imbalance
  FROM trial_balance_snapshots tbs
  JOIN accounting_periods ap ON ap.id = tbs.period_id
  WHERE ap.business_id = p_business_id
    AND ap.period_start < p_invariant_enforcement_date
    AND (tbs.is_balanced = FALSE OR tbs.balance_difference <> 0);

  res := jsonb_build_object(
    'business_id', p_business_id,
    'invariant_enforcement_date', p_invariant_enforcement_date,
    'detected_at', NOW(),
    'sales_without_journal_entry', sales_without_je,
    'invoices_without_journal_entry', invoices_without_je,
    'expenses_without_journal_entry', expenses_without_je,
    'payments_without_journal_entry', payments_without_je,
    'journal_entries_missing_required_lines', journal_entries_missing_lines,
    'periods_without_opening_balances', periods_without_opening_balances,
    'periods_not_properly_closed', periods_not_properly_closed,
    'trial_balance_imbalance', trial_balance_imbalance,
    'counts', jsonb_build_object(
      'sales_without_je', jsonb_array_length(sales_without_je),
      'invoices_without_je', jsonb_array_length(invoices_without_je),
      'expenses_without_je', jsonb_array_length(expenses_without_je),
      'payments_without_je', jsonb_array_length(payments_without_je),
      'journal_entries_missing_lines', jsonb_array_length(journal_entries_missing_lines),
      'periods_without_opening_balances', jsonb_array_length(periods_without_opening_balances),
      'periods_not_properly_closed', jsonb_array_length(periods_not_properly_closed),
      'trial_balance_imbalance', jsonb_array_length(trial_balance_imbalance)
    )
  );
  RETURN res;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_legacy_issues IS 'PHASE 12: READ-ONLY. Identifies legacy (pre-invariant) records that fail current invariants. No side effects.';

-- ============================================================================
-- STEP 6: backfill_missing_sale_journals — CONTROLLED, only for open periods
-- ============================================================================
-- For a given period: finds sales without JE, calls post_sale_to_ledger with
-- backfill params, logs to backfill_audit_log. Only runs when period status = 'open'.
CREATE OR REPLACE FUNCTION backfill_missing_sale_journals(
  p_business_id UUID,
  p_period_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01',
  p_actor TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
DECLARE
  period_rec RECORD;
  sale_rec RECORD;
  journal_id UUID;
  repaired INTEGER := 0;
  skipped_not_open INTEGER := 0;
  err_msg TEXT;
  after_js JSONB;
BEGIN
  SELECT * INTO period_rec FROM accounting_periods WHERE id = p_period_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found or does not belong to business: %', p_business_id;
  END IF;

  IF period_rec.status != 'open' THEN
    RETURN jsonb_build_object('repaired', 0, 'skipped_reason', 'period status is not open', 'period_status', period_rec.status);
  END IF;

  FOR sale_rec IN
    SELECT s.id, s.created_at
    FROM sales s
    WHERE s.business_id = p_business_id
      AND s.created_at::DATE >= period_rec.period_start
      AND s.created_at::DATE <= period_rec.period_end
      AND s.created_at::DATE < p_invariant_enforcement_date
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'sale' AND je.reference_id = s.id AND je.business_id = s.business_id
      )
  LOOP
    BEGIN
      SELECT post_sale_to_ledger(
        sale_rec.id,
        'backfill',
        'Phase 12 backfill: sale missing journal entry',
        p_actor
      ) INTO journal_id;

      after_js := jsonb_build_object('journal_entry_id', journal_id, 'sale_id', sale_rec.id);
      INSERT INTO backfill_audit_log (period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary)
      VALUES (p_period_id, 'sale', sale_rec.id, 'created_journal_entry', p_actor, jsonb_build_object('sale_id', sale_rec.id, 'had_journal_entry', FALSE), after_js);
      repaired := repaired + 1;
    EXCEPTION WHEN OTHERS THEN
      err_msg := SQLERRM;
      INSERT INTO backfill_audit_log (period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary)
      VALUES (p_period_id, 'sale', sale_rec.id, 'backfill_failed', p_actor, jsonb_build_object('sale_id', sale_rec.id), jsonb_build_object('error', err_msg));
      RAISE;
    END;
  END LOOP;

  RETURN jsonb_build_object('repaired', repaired, 'period_id', p_period_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_missing_sale_journals IS 'PHASE 12: Backfill missing journal entries for legacy sales. Only when period is open. Logs every action to backfill_audit_log.';

-- ============================================================================
-- STEP 7: backfill_missing_invoice_journals — requires post_invoice_to_ledger with backfill params
-- ============================================================================
-- NOTE: post_invoice_to_ledger must be updated to accept (p_invoice_id, p_entry_type, p_backfill_reason, p_backfill_actor).
-- This function calls post_invoice_to_ledger(invoice_id) only; backfill metadata is not yet supported for invoices
-- in this migration. To support: add same 3 optional params to post_invoice_to_ledger and pass to post_journal_entry.
-- For now we FLAG: backfill_missing_invoice_journals runs detect and returns counts; actual backfill raises.
CREATE OR REPLACE FUNCTION backfill_missing_invoice_journals(
  p_business_id UUID,
  p_period_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01',
  p_actor TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
BEGIN
  -- Invoices: post_invoice_to_ledger does not yet accept backfill params. Flag for manual/ follow-up.
  RETURN jsonb_build_object(
    'repaired', 0,
    'period_id', p_period_id,
    'message', 'Backfill for invoices requires post_invoice_to_ledger to accept (p_invoice_id, p_entry_type, p_backfill_reason, p_backfill_actor). Add in follow-up migration. Use detect_legacy_issues for counts.'
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 8: run_phase12_period_integrity — re-run close workflow on historical periods
-- ============================================================================
-- For one period: validate_period_ready_for_close; if pass and open -> close; if pass and soft_closed -> lock.
-- If validate fails, returns flagged. p_actor used for close_accounting_period and lock_accounting_period.
CREATE OR REPLACE FUNCTION run_phase12_period_integrity(
  p_business_id UUID,
  p_period_id UUID,
  p_actor UUID
)
RETURNS JSONB AS $$
DECLARE
  period_rec RECORD;
  validation_result JSONB;
  closed_rec RECORD;
  locked_rec RECORD;
BEGIN
  SELECT * INTO period_rec FROM accounting_periods WHERE id = p_period_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found or does not belong to business: %', p_business_id;
  END IF;

  BEGIN
    validation_result := validate_period_ready_for_close(p_period_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'period_id', p_period_id,
      'status', 'flagged_manual_review',
      'reason', 'validate_period_ready_for_close failed',
      'error', SQLERRM
    );
  END;

  IF period_rec.status = 'open' THEN
    BEGIN
      SELECT * INTO closed_rec FROM close_accounting_period(p_period_id, p_actor);
      RETURN jsonb_build_object('period_id', p_period_id, 'status', 'soft_closed', 'action', 'closed');
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('period_id', p_period_id, 'status', 'flagged_manual_review', 'reason', SQLERRM);
    END;
  ELSIF period_rec.status = 'soft_closed' THEN
    BEGIN
      SELECT * INTO locked_rec FROM lock_accounting_period(p_period_id, p_actor);
      RETURN jsonb_build_object('period_id', p_period_id, 'status', 'locked', 'action', 'locked');
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('period_id', p_period_id, 'status', 'flagged_manual_review', 'reason', SQLERRM);
    END;
  ELSE
    RETURN jsonb_build_object('period_id', p_period_id, 'status', period_rec.status, 'action', 'none');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_phase12_period_integrity IS 'PHASE 12: Re-run close workflow on a historical period. Validate -> close (if open) -> lock (if soft_closed). Flags on failure.';

-- ============================================================================
-- STEP 9: run_phase12_regenerate_trial_balances — regenerate TB for all historical periods
-- ============================================================================
CREATE OR REPLACE FUNCTION run_phase12_regenerate_trial_balances(
  p_business_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01',
  p_generated_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  rec RECORD;
  regenerated INTEGER := 0;
  failed INTEGER := 0;
  failures JSONB := '[]'::jsonb;
BEGIN
  FOR rec IN
    SELECT ap.id
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
      AND ap.period_start < p_invariant_enforcement_date
  LOOP
    BEGIN
      PERFORM generate_trial_balance(rec.id, p_generated_by);
      regenerated := regenerated + 1;
    EXCEPTION WHEN OTHERS THEN
      failed := failed + 1;
      failures := failures || jsonb_build_array(jsonb_build_object('period_id', rec.id, 'error', SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('regenerated', regenerated, 'failed', failed, 'failures', failures);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_phase12_regenerate_trial_balances IS 'PHASE 12: Regenerate trial balance snapshots for all historical periods. Enforces balance invariants.';

-- ============================================================================
-- STEP 10: run_phase12_final_validation — run_accounting_invariant_audit per period
-- ============================================================================
CREATE OR REPLACE FUNCTION run_phase12_final_validation(
  p_business_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01'
)
RETURNS JSONB AS $$
DECLARE
  rec RECORD;
  audit_result JSONB;
  periods_passed INTEGER := 0;
  periods_failed INTEGER := 0;
  failure_reasons JSONB := '[]'::jsonb;
BEGIN
  FOR rec IN
    SELECT ap.id, ap.period_start, ap.period_end
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
      AND ap.period_start < p_invariant_enforcement_date
  LOOP
    BEGIN
      SELECT run_accounting_invariant_audit(rec.id) INTO audit_result;
      IF (audit_result->>'overall_status') = 'PASS' THEN
        periods_passed := periods_passed + 1;
      ELSE
        periods_failed := periods_failed + 1;
        failure_reasons := failure_reasons || jsonb_build_array(jsonb_build_object(
          'period_id', rec.id,
          'period_start', rec.period_start,
          'overall_status', audit_result->>'overall_status',
          'failed_checks', audit_result->'failed_checks',
          'invariants', audit_result->'invariants'
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      periods_failed := periods_failed + 1;
      failure_reasons := failure_reasons || jsonb_build_array(jsonb_build_object('period_id', rec.id, 'error', SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object(
    'periods_passed', periods_passed,
    'periods_failed', periods_failed,
    'failure_reasons', failure_reasons
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_phase12_final_validation IS 'PHASE 12: Run run_accounting_invariant_audit for each historical period. Returns summary.';

-- ============================================================================
-- STEP 11: run_phase12_backfill_report — per-business report (detect + final validation)
-- ============================================================================
-- NO AUTO-CORRECTION. Runs detect_legacy_issues and run_phase12_final_validation.
-- Returns: total records scanned (from detect counts), total repaired (0 – repair is explicit),
-- total flagged for manual review, invariant audit results.
CREATE OR REPLACE FUNCTION run_phase12_backfill_report(
  p_business_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01'
)
RETURNS JSONB AS $$
DECLARE
  detect_result JSONB;
  validation_result JSONB;
  counts JSONB;
  total_scanned INTEGER;
  total_flagged INTEGER;
BEGIN
  detect_result := detect_legacy_issues(p_business_id, p_invariant_enforcement_date);
  validation_result := run_phase12_final_validation(p_business_id, p_invariant_enforcement_date);

  counts := detect_result->'counts';
  total_scanned := COALESCE((counts->>'sales_without_je')::int, 0) + COALESCE((counts->>'invoices_without_je')::int, 0)
    + COALESCE((counts->>'expenses_without_je')::int, 0) + COALESCE((counts->>'payments_without_je')::int, 0)
    + COALESCE((counts->>'journal_entries_missing_lines')::int, 0) + COALESCE((counts->>'periods_without_opening_balances')::int, 0)
    + COALESCE((counts->>'periods_not_properly_closed')::int, 0) + COALESCE((counts->>'trial_balance_imbalance')::int, 0);

  total_flagged := (validation_result->>'periods_failed')::int
    + COALESCE((counts->>'journal_entries_missing_lines')::int, 0)
    + COALESCE((counts->>'periods_without_opening_balances')::int, 0);

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'invariant_enforcement_date', p_invariant_enforcement_date,
    'generated_at', NOW(),
    'total_records_scanned', total_scanned,
    'total_repaired', 0,
    'total_flagged_manual_review', total_flagged,
    'detect_legacy_issues', detect_result,
    'invariant_audit', validation_result,
    'periods_passed', validation_result->>'periods_passed',
    'periods_failed', validation_result->>'periods_failed',
    'failure_reasons', validation_result->'failure_reasons'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_phase12_backfill_report IS 'PHASE 12: Backfill report per business. Read-only: detect + final validation. No auto-correction. total_repaired=0; repair via explicit backfill_* and run_phase12_* calls.';
