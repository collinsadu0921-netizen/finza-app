-- ============================================================================
-- Migration 476: Fix ambiguous journal_entry_id (and related OUT names) in GL RPCs
-- ============================================================================
-- get_general_ledger / get_general_ledger_paginated use RETURNS TABLE columns
-- whose names match CTE output columns (journal_entry_id, reference_id, ...).
-- PostgreSQL then reports: column reference "journal_entry_id" is ambiguous.
-- Fix: #variable_conflict use_column — prefer SQL column over PL/pgSQL OUT variable
-- inside expressions. Logic and return shape unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_general_ledger(
  p_business_id UUID,
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  entry_date DATE,
  journal_entry_id UUID,
  journal_entry_description TEXT,
  reference_type TEXT,
  reference_id UUID,
  line_id UUID,
  line_description TEXT,
  debit NUMERIC,
  credit NUMERIC,
  running_balance NUMERIC
) AS $$
#variable_conflict use_column
DECLARE
  v_account_type TEXT;
  v_opening_balance NUMERIC := 0;
BEGIN
  SELECT type INTO v_account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  IF v_account_type IS NULL THEN
    RAISE EXCEPTION 'Account not found or does not belong to business: %', p_account_id;
  END IF;

  WITH filtered_entries_opening AS (
    SELECT id
    FROM journal_entries
    WHERE business_id = p_business_id
      AND date < p_start_date
  )
  SELECT
    CASE
      WHEN v_account_type IN ('asset', 'expense') THEN
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      ELSE
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END
  INTO v_opening_balance
  FROM journal_entry_lines jel
  WHERE jel.account_id = p_account_id
    AND jel.journal_entry_id IN (SELECT id FROM filtered_entries_opening);

  RETURN QUERY
  WITH filtered_entries AS (
    SELECT id, date, description, reference_type, reference_id, created_at
    FROM journal_entries
    WHERE business_id = p_business_id
      AND date >= p_start_date
      AND date <= p_end_date
  ),
  period_lines AS (
    SELECT
      je.date,
      je.id as journal_entry_id,
      je.description as journal_entry_description,
      je.reference_type,
      je.reference_id,
      je.created_at as journal_created_at,
      jel.id as line_id,
      jel.description as line_description,
      jel.created_at as line_created_at,
      COALESCE(jel.debit, 0) as debit,
      COALESCE(jel.credit, 0) as credit,
      CASE
        WHEN v_account_type IN ('asset', 'expense') THEN
          COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)
        ELSE
          COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)
      END as line_balance_change
    FROM filtered_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      AND jel.account_id = p_account_id
    ORDER BY je.date ASC, je.created_at ASC, jel.created_at ASC
  ),
  running_balance_lines AS (
    SELECT
      pl.date,
      pl.journal_entry_id,
      pl.journal_entry_description,
      pl.reference_type,
      pl.reference_id,
      pl.journal_created_at,
      pl.line_id,
      pl.line_description,
      pl.line_created_at,
      pl.debit,
      pl.credit,
      v_opening_balance + SUM(pl.line_balance_change) OVER (
        ORDER BY pl.date ASC, pl.journal_created_at ASC, pl.line_created_at ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) as running_balance
    FROM period_lines pl
  )
  SELECT
    rbl.date,
    rbl.journal_entry_id,
    rbl.journal_entry_description,
    rbl.reference_type,
    rbl.reference_id,
    rbl.line_id,
    rbl.line_description,
    rbl.debit,
    rbl.credit,
    rbl.running_balance
  FROM running_balance_lines rbl
  ORDER BY rbl.date ASC, rbl.journal_created_at ASC, rbl.line_created_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_general_ledger(uuid, uuid, date, date) IS 'Returns general ledger for selected account and date range. OPTIMIZED: Filters journal_entries first using idx_journal_entries_business_date_id, then joins lines using idx_journal_entry_lines_account_entry. Ledger-only (journal_entries + journal_entry_lines). Ordered by date with running balance. Period-aware via date filters. Migration 476: #variable_conflict use_column + qualified CTE aliases to avoid ambiguous OUT-parameter names.';


CREATE OR REPLACE FUNCTION get_general_ledger_paginated(
  p_business_id UUID,
  p_account_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_limit INTEGER DEFAULT 100,
  p_cursor_entry_date DATE DEFAULT NULL,
  p_cursor_journal_entry_id UUID DEFAULT NULL,
  p_cursor_line_id UUID DEFAULT NULL
)
RETURNS TABLE (
  entry_date DATE,
  journal_entry_id UUID,
  journal_entry_description TEXT,
  reference_type TEXT,
  reference_id UUID,
  line_id UUID,
  line_description TEXT,
  debit NUMERIC,
  credit NUMERIC,
  running_balance NUMERIC
) AS $$
#variable_conflict use_column
DECLARE
  v_account_type TEXT;
  v_opening_balance NUMERIC := 0;
  v_limit INTEGER := LEAST(COALESCE(p_limit, 100), 500);
BEGIN
  IF v_limit < 1 THEN
    v_limit := 100;
  END IF;

  SELECT type INTO v_account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  IF v_account_type IS NULL THEN
    RAISE EXCEPTION 'Account not found or does not belong to business: %', p_account_id;
  END IF;

  WITH filtered_entries_opening AS (
    SELECT id
    FROM journal_entries
    WHERE business_id = p_business_id
      AND date < p_start_date
  )
  SELECT
    CASE
      WHEN v_account_type IN ('asset', 'expense') THEN
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      ELSE
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END
  INTO v_opening_balance
  FROM journal_entry_lines jel
  WHERE jel.account_id = p_account_id
    AND jel.journal_entry_id IN (SELECT id FROM filtered_entries_opening);

  v_opening_balance := COALESCE(v_opening_balance, 0);

  RETURN QUERY
  WITH filtered_entries AS (
    SELECT id, date, description, reference_type, reference_id, created_at
    FROM journal_entries
    WHERE business_id = p_business_id
      AND date >= p_start_date
      AND date <= p_end_date
  ),
  all_period_lines AS (
    SELECT
      je.date,
      je.id as journal_entry_id,
      je.description as journal_entry_description,
      je.reference_type,
      je.reference_id,
      jel.id as line_id,
      jel.description as line_description,
      COALESCE(jel.debit, 0) as debit,
      COALESCE(jel.credit, 0) as credit,
      CASE
        WHEN v_account_type IN ('asset', 'expense') THEN
          COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)
        ELSE
          COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)
      END as line_balance_change
    FROM filtered_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      AND jel.account_id = p_account_id
  ),
  ordered_lines AS (
    SELECT
      apl.date,
      apl.journal_entry_id,
      apl.journal_entry_description,
      apl.reference_type,
      apl.reference_id,
      apl.line_id,
      apl.line_description,
      apl.debit,
      apl.credit,
      apl.line_balance_change,
      SUM(apl.line_balance_change) OVER (
        ORDER BY apl.date ASC, apl.journal_entry_id ASC, apl.line_id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) as cumulative_balance_change
    FROM all_period_lines apl
  ),
  cursor_filtered_lines AS (
    SELECT ol.*
    FROM ordered_lines ol
    WHERE (
      (p_cursor_entry_date IS NULL) OR
      (ol.date > p_cursor_entry_date) OR
      (ol.date = p_cursor_entry_date AND ol.journal_entry_id > p_cursor_journal_entry_id) OR
      (ol.date = p_cursor_entry_date AND ol.journal_entry_id = p_cursor_journal_entry_id AND ol.line_id > p_cursor_line_id)
    )
    ORDER BY ol.date ASC, ol.journal_entry_id ASC, ol.line_id ASC
    LIMIT v_limit
  )
  SELECT
    cfl.date,
    cfl.journal_entry_id,
    cfl.journal_entry_description,
    cfl.reference_type,
    cfl.reference_id,
    cfl.line_id,
    cfl.line_description,
    cfl.debit,
    cfl.credit,
    v_opening_balance + cfl.cumulative_balance_change as running_balance
  FROM cursor_filtered_lines cfl
  ORDER BY cfl.date ASC, cfl.journal_entry_id ASC, cfl.line_id ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_general_ledger_paginated(uuid, uuid, date, date, integer, date, uuid, uuid) IS 'Returns paginated general ledger for selected account and date range using keyset pagination (cursor-based). OPTIMIZED: Filters journal_entries first, uses indexes. Cursor: (entry_date, journal_entry_id, line_id) - deterministic and audit-safe. ORDER BY: entry_date ASC, journal_entry_id ASC, line_id ASC (matches cursor tuple). Max limit: 500. Ledger-only (journal_entries + journal_entry_lines). Period-aware via date filters. Note: Running balance requires processing all rows up to cursor for correctness. Migration 476: #variable_conflict use_column + qualified CTE aliases to avoid ambiguous OUT-parameter names.';
