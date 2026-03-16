-- ============================================================================
-- MIGRATION: Phase 3.1 - Report Function Optimization
-- ============================================================================
-- Optimizes report functions for better performance:
-- - Filter journal_entries by business_id + date range FIRST
-- - Join lines only after filtering entries
-- - Optimize join order for index usage
-- 
-- Scope: READ-ONLY hardening only (no posting, no edits, no mutations)
-- Mode: CONTROLLED BATCH (no drift)
-- 
-- No logic changes - outputs remain identical
-- ============================================================================

-- ============================================================================
-- PART 1: OPTIMIZE TRIAL BALANCE FUNCTION
-- ============================================================================
-- Strategy: Filter journal_entries first, then join lines
-- This allows the database to use idx_journal_entries_business_date_id
-- ============================================================================

CREATE OR REPLACE FUNCTION get_trial_balance(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  debit_total NUMERIC,
  credit_total NUMERIC,
  ending_balance NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  -- Strategy: Filter entries first, then aggregate by account
  -- This allows use of idx_journal_entries_business_date_id
  WITH filtered_entries AS (
    SELECT id
    FROM journal_entries
    WHERE business_id = p_business_id
      AND date >= p_start_date
      AND date <= p_end_date
  ),
  account_balances AS (
    SELECT
      a.id as account_id,
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(jel.debit), 0) as debit_total,
      COALESCE(SUM(jel.credit), 0) as credit_total
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      AND jel.journal_entry_id IN (SELECT id FROM filtered_entries)
    WHERE a.business_id = p_business_id
      AND a.deleted_at IS NULL
    GROUP BY a.id, a.code, a.name, a.type
    HAVING COALESCE(SUM(jel.debit), 0) != 0 OR COALESCE(SUM(jel.credit), 0) != 0
  )
  SELECT
    account_id,
    code,
    name,
    type,
    debit_total,
    credit_total,
    CASE
      WHEN type IN ('asset', 'expense') THEN
        debit_total - credit_total
      ELSE
        -- liability, equity, income
        credit_total - debit_total
    END as ending_balance
  FROM account_balances
  ORDER BY code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_trial_balance IS 'Returns trial balance for given date range. OPTIMIZED: Filters journal_entries first using idx_journal_entries_business_date_id, then joins lines. Ledger-only (journal_entries + journal_entry_lines + accounts). One row per account with debit/credit totals and ending balance. Period-aware via date filters.';

-- ============================================================================
-- PART 2: OPTIMIZE GENERAL LEDGER FUNCTION (NON-PAGINATED)
-- ============================================================================
-- Strategy: Filter entries first, then join lines for specific account
-- This allows use of idx_journal_entries_business_date_id and idx_journal_entry_lines_account_entry
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
DECLARE
  v_account_type TEXT;
  v_opening_balance NUMERIC := 0;
BEGIN
  -- Get account type for balance calculation
  SELECT type INTO v_account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  IF v_account_type IS NULL THEN
    RAISE EXCEPTION 'Account not found or does not belong to business: %', p_account_id;
  END IF;

  -- Calculate opening balance (balance up to but not including start_date)
  -- OPTIMIZED: Filter entries first
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
        -- liability, equity, income
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END
  INTO v_opening_balance
  FROM journal_entry_lines jel
  WHERE jel.account_id = p_account_id
    AND jel.journal_entry_id IN (SELECT id FROM filtered_entries_opening);

  -- Return journal lines with running balance using window functions
  -- OPTIMIZED: Filter entries first, then join lines
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
          -- liability, equity, income
          COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)
      END as line_balance_change
    FROM filtered_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      AND jel.account_id = p_account_id
    ORDER BY je.date ASC, je.created_at ASC, jel.created_at ASC
  ),
  running_balance_lines AS (
    SELECT
      date,
      journal_entry_id,
      journal_entry_description,
      reference_type,
      reference_id,
      journal_created_at,
      line_id,
      line_description,
      line_created_at,
      debit,
      credit,
      v_opening_balance + SUM(line_balance_change) OVER (
        ORDER BY date ASC, journal_created_at ASC, line_created_at ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) as running_balance
    FROM period_lines
  )
  SELECT
    date,
    journal_entry_id,
    journal_entry_description,
    reference_type,
    reference_id,
    line_id,
    line_description,
    debit,
    credit,
    running_balance
  FROM running_balance_lines
  ORDER BY date ASC, journal_created_at ASC, line_created_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_general_ledger IS 'Returns general ledger for selected account and date range. OPTIMIZED: Filters journal_entries first using idx_journal_entries_business_date_id, then joins lines using idx_journal_entry_lines_account_entry. Ledger-only (journal_entries + journal_entry_lines). Ordered by date with running balance. Period-aware via date filters.';

-- ============================================================================
-- PART 3: PAGINATED GENERAL LEDGER FUNCTION (NEW)
-- ============================================================================
-- Strategy: Keyset pagination using cursor (entry_date, journal_entry_id, line_id)
-- More efficient than OFFSET for large datasets
-- 
-- Note: Running balance calculation requires processing all rows up to cursor.
-- For performance, we fetch all rows up to cursor, calculate running balance,
-- then return only the requested page. This is acceptable for pagination correctness.
-- ============================================================================

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
DECLARE
  v_account_type TEXT;
  v_opening_balance NUMERIC := 0;
  v_limit INTEGER := LEAST(COALESCE(p_limit, 100), 500); -- Enforce max limit
BEGIN
  -- Enforce minimum limit
  IF v_limit < 1 THEN
    v_limit := 100;
  END IF;

  -- Get account type for balance calculation
  SELECT type INTO v_account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  IF v_account_type IS NULL THEN
    RAISE EXCEPTION 'Account not found or does not belong to business: %', p_account_id;
  END IF;

  -- Calculate opening balance (balance up to but not including start_date)
  -- Always calculate from beginning for correctness
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
        -- liability, equity, income
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END
  INTO v_opening_balance
  FROM journal_entry_lines jel
  WHERE jel.account_id = p_account_id
    AND jel.journal_entry_id IN (SELECT id FROM filtered_entries_opening);
  
  v_opening_balance := COALESCE(v_opening_balance, 0);

  -- Return journal lines with running balance using window functions
  -- OPTIMIZED: Filter entries first, then join lines, then apply cursor
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
          -- liability, equity, income
          COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)
      END as line_balance_change
    FROM filtered_entries je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      AND jel.account_id = p_account_id
  ),
  ordered_lines AS (
    SELECT
      date,
      journal_entry_id,
      journal_entry_description,
      reference_type,
      reference_id,
      line_id,
      line_description,
      debit,
      credit,
      line_balance_change,
      -- Calculate cumulative balance change from period start
      -- ORDER BY must match cursor tuple: (entry_date, journal_entry_id, line_id)
      SUM(line_balance_change) OVER (
        ORDER BY date ASC, journal_entry_id ASC, line_id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) as cumulative_balance_change
    FROM all_period_lines
  ),
  cursor_filtered_lines AS (
    SELECT *
    FROM ordered_lines
    WHERE (
      -- No cursor: return from start
      (p_cursor_entry_date IS NULL) OR
      -- Cursor: return rows after cursor position using tuple (entry_date, journal_entry_id, line_id)
      (date > p_cursor_entry_date) OR
      (date = p_cursor_entry_date AND journal_entry_id > p_cursor_journal_entry_id) OR
      (date = p_cursor_entry_date AND journal_entry_id = p_cursor_journal_entry_id AND line_id > p_cursor_line_id)
    )
    ORDER BY date ASC, journal_entry_id ASC, line_id ASC
    LIMIT v_limit
  )
  SELECT
    date,
    journal_entry_id,
    journal_entry_description,
    reference_type,
    reference_id,
    line_id,
    line_description,
    debit,
    credit,
    -- Calculate running balance: opening_balance + cumulative change from period start
    -- Note: For pagination correctness, we need to process all rows up to cursor
    -- This ensures running balance is always correct, even if slower for very large datasets
    v_opening_balance + cumulative_balance_change as running_balance
  FROM cursor_filtered_lines
  ORDER BY date ASC, journal_entry_id ASC, line_id ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_general_ledger_paginated IS 'Returns paginated general ledger for selected account and date range using keyset pagination (cursor-based). OPTIMIZED: Filters journal_entries first, uses indexes. Cursor: (entry_date, journal_entry_id, line_id) - deterministic and audit-safe. ORDER BY: entry_date ASC, journal_entry_id ASC, line_id ASC (matches cursor tuple). Max limit: 500. Ledger-only (journal_entries + journal_entry_lines). Period-aware via date filters. Note: Running balance requires processing all rows up to cursor for correctness.';
