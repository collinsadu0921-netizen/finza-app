-- ============================================================================
-- MIGRATION: get_ar_balances_by_invoice RPC + indexes
-- ============================================================================
-- Canonical DB primitive for per-invoice AR balances. Replaces client-side
-- grouping of get_general_ledger in reconciliation and batch flows.
--
-- Rules:
--   - Uses journal_entry_lines + journal_entries only
--   - Only AR control account for that business
--   - Only reference_type = 'invoice'
--   - Period-native: accounting_periods by p_period_id (no manual date passing)
--   - Returns NUMERIC balances, no rounding in SQL
--   - Index-friendly
-- ============================================================================

-- ============================================================================
-- INDEX: journal_entries (business_id, reference_type, date)
-- ============================================================================
-- Optimizes get_ar_balances_by_invoice and any query filtering by
-- business + reference_type = 'invoice' + date range.
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_reference_date
ON journal_entries(business_id, reference_type, date);

COMMENT ON INDEX idx_journal_entries_business_reference_date IS
'Optimizes AR-by-invoice queries: business_id + reference_type (e.g. invoice) + date. Used by get_ar_balances_by_invoice.';

-- ============================================================================
-- RPC: get_ar_balances_by_invoice
-- ============================================================================
CREATE OR REPLACE FUNCTION get_ar_balances_by_invoice(
  p_business_id UUID,
  p_period_id UUID,
  p_invoice_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE(invoice_id UUID, balance NUMERIC)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period_start DATE;
  v_period_end   DATE;
  v_ar_account_id UUID;
  v_ar_code TEXT;
BEGIN
  -- Period: resolve from accounting_periods (period-native, no manual dates)
  SELECT ap.period_start, ap.period_end
  INTO v_period_start, v_period_end
  FROM accounting_periods ap
  WHERE ap.id = p_period_id
    AND ap.business_id = p_business_id;

  IF v_period_start IS NULL OR v_period_end IS NULL THEN
    RETURN;  -- no period => empty result
  END IF;

  -- AR account: chart_of_accounts_control_map 'AR' -> accounts.id; fallback 1100/1200
  SELECT m.account_code INTO v_ar_code
  FROM chart_of_accounts_control_map m
  WHERE m.business_id = p_business_id
    AND m.control_key = 'AR'
  LIMIT 1;

  IF v_ar_code IS NOT NULL THEN
    SELECT a.id INTO v_ar_account_id
    FROM accounts a
    WHERE a.business_id = p_business_id
      AND a.code = v_ar_code
      AND a.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_ar_account_id IS NULL THEN
    SELECT a.id INTO v_ar_account_id
    FROM accounts a
    WHERE a.business_id = p_business_id
      AND a.code IN ('1100', '1200')
      AND a.deleted_at IS NULL
    LIMIT 1;
  END IF;

  IF v_ar_account_id IS NULL THEN
    RETURN;  -- no AR account => empty result
  END IF;

  RETURN QUERY
  WITH period_entries AS (
    SELECT je.id AS journal_entry_id,
           je.reference_id AS inv_id
    FROM journal_entries je
    WHERE je.business_id = p_business_id
      AND je.reference_type = 'invoice'
      AND je.date >= v_period_start
      AND je.date <= v_period_end
      AND (p_invoice_id IS NULL OR je.reference_id = p_invoice_id)
      AND (p_customer_id IS NULL OR EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.id = je.reference_id
          AND i.business_id = p_business_id
          AND i.customer_id = p_customer_id
      ))
  ),
  line_totals AS (
    SELECT
      pe.inv_id,
      SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)) AS bal
    FROM period_entries pe
    JOIN journal_entry_lines jel
      ON jel.journal_entry_id = pe.journal_entry_id
      AND jel.account_id = v_ar_account_id
    GROUP BY pe.inv_id
  )
  SELECT
    lt.inv_id AS invoice_id,
    lt.bal AS balance
  FROM line_totals lt;
END;
$$;

COMMENT ON FUNCTION get_ar_balances_by_invoice IS
'Returns per-invoice AR ledger balances for a period. Uses journal_entry_lines + journal_entries, AR control account only, reference_type=invoice. Period-native via accounting_periods. Optional filters: p_invoice_id, p_customer_id. NUMERIC balance, no rounding. Index-friendly: idx_journal_entries_business_reference_date, idx_journal_entry_lines_account_entry.';
