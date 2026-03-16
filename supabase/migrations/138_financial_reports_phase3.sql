-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 3: Read-Only Financial Reports (Canonical)
-- ============================================================================
-- Adds canonical read-only database functions for core accounting reports:
-- 1. Trial Balance
-- 2. General Ledger
-- 3. Profit & Loss
-- 4. Balance Sheet
-- 
-- All reports are:
-- - Ledger-only (journal_entries + journal_entry_lines + accounts)
-- - Period-aware (respect accounting periods)
-- - Read-only (no writes, no mutations)
-- - Deterministic (same inputs = same outputs)
-- 
-- Scope: LEDGER-ONLY, READ-ONLY, AUDIT-SAFE
-- Mode: CONTROLLED BATCH (no drift, no shortcuts)
-- ============================================================================

-- ============================================================================
-- STEP 1: TRIAL BALANCE FUNCTION
-- ============================================================================
-- For a given period or date range:
-- - One row per account
-- - Columns: Account code, name, debit total, credit total, ending balance (signed)
-- - Must balance: Sum(debits) == Sum(credits)
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
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    COALESCE(SUM(jel.debit), 0) as debit_total,
    COALESCE(SUM(jel.credit), 0) as credit_total,
    CASE
      WHEN a.type IN ('asset', 'expense') THEN
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      ELSE
        -- liability, equity, income
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END as ending_balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date
  WHERE a.business_id = p_business_id
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.code, a.name, a.type
  HAVING COALESCE(SUM(jel.debit), 0) != 0 OR COALESCE(SUM(jel.credit), 0) != 0
  ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_trial_balance IS 'Returns trial balance for given date range. Ledger-only (journal_entries + journal_entry_lines + accounts). One row per account with debit/credit totals and ending balance. Period-aware via date filters.';

-- ============================================================================
-- STEP 2: GENERAL LEDGER FUNCTION
-- ============================================================================
-- For a selected account + period:
-- - Ordered list of journal lines
-- - Columns: Entry date, Journal entry ID, Description, Debit, Credit, Running balance
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
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id
    AND je.business_id = p_business_id
    AND je.date < p_start_date;

  -- Return journal lines with running balance using window functions
  RETURN QUERY
  WITH period_lines AS (
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
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.business_id = p_business_id
      AND je.date >= p_start_date
      AND je.date <= p_end_date
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

COMMENT ON FUNCTION get_general_ledger IS 'Returns general ledger for selected account and date range. Ledger-only (journal_entries + journal_entry_lines). Ordered by date with running balance. Period-aware via date filters.';

-- ============================================================================
-- STEP 3: PROFIT & LOSS FUNCTION
-- ============================================================================
-- For a period or date range:
-- - Include only: Income, Expense
-- - Group by account
-- - Show: Account name, Period total
-- - Calculate: Total income, Total expenses, Net profit/loss
-- ============================================================================

CREATE OR REPLACE FUNCTION get_profit_and_loss(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  period_total NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    CASE
      WHEN a.type = 'income' THEN
        -- Income: credit - debit (normal balance is credit)
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
      WHEN a.type = 'expense' THEN
        -- Expense: debit - credit (normal balance is debit)
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      ELSE
        0
    END as period_total
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date
  WHERE a.business_id = p_business_id
    AND a.type IN ('income', 'expense')
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.code, a.name, a.type
  HAVING 
    (a.type = 'income' AND (COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)) != 0) OR
    (a.type = 'expense' AND (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) != 0)
  ORDER BY a.type, a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_profit_and_loss IS 'Returns profit & loss for given date range. Ledger-only (journal_entries + journal_entry_lines + accounts). Only income and expense accounts. Period-aware via date filters.';

-- ============================================================================
-- STEP 4: BALANCE SHEET FUNCTION
-- ============================================================================
-- As of a date (usually period end):
-- - Assets, Liabilities, Equity
-- - Each section grouped by account
-- - Totals per section
-- - Must satisfy: Assets = Liabilities + Equity
-- ============================================================================

CREATE OR REPLACE FUNCTION get_balance_sheet(
  p_business_id UUID,
  p_as_of_date DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  balance NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    CASE
      WHEN a.type = 'asset' THEN
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      ELSE
        -- liability, equity
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END as balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date <= p_as_of_date
  WHERE a.business_id = p_business_id
    AND a.type IN ('asset', 'liability', 'equity')
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.code, a.name, a.type
  HAVING
    (a.type = 'asset' AND (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) != 0) OR
    (a.type IN ('liability', 'equity') AND (COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)) != 0)
  ORDER BY a.type, a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_balance_sheet IS 'Returns balance sheet as of given date. Ledger-only (journal_entries + journal_entry_lines + accounts). Only asset, liability, equity accounts. Uses cumulative balances up to as_of_date. Period-aware via date filter.';
