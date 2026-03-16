-- ============================================================================
-- MIGRATION: STEP 7 - Tax Return Extraction from Ledger
-- ============================================================================
-- This migration implements READ-ONLY tax return extraction that reads the ledger
-- and produces GRA-ready summaries for VAT, NHIL, GETFund, and COVID (pre-2026).
--
-- Rules:
-- 1. Source of truth: ONLY ledger data (journal_entries, journal_entry_lines, accounts)
-- 2. Do NOT read invoices, sales, bills, or tax_lines
-- 3. Do NOT recalculate taxes
-- 4. Period-based extraction with business_id, start_date, end_date
-- 5. Per-tax summaries: opening balance, period debits, period credits, closing balance
-- 6. COVID only for periods before 2026-01-01
-- ============================================================================

-- ============================================================================
-- FUNCTION: Extract tax return data from ledger
-- ============================================================================
-- Returns JSON array with tax summaries for each control account:
-- - 2100 → VAT Control
-- - 2110 → NHIL Control
-- - 2120 → GETFund Control
-- - 2130 → COVID Levy Control (pre-2026 only)
--
-- Parameters:
--   p_business_id: Business UUID
--   p_start_date: Period start date (inclusive)
--   p_end_date: Period end date (inclusive)
--
-- Returns: JSONB array of tax summary objects
-- ============================================================================
CREATE OR REPLACE FUNCTION extract_tax_return_from_ledger(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB AS $$
DECLARE
  tax_account_codes TEXT[] := ARRAY['2100', '2110', '2120', '2130'];
  tax_names TEXT[] := ARRAY['VAT', 'NHIL', 'GETFund', 'COVID'];
  result JSONB := '[]'::JSONB;
  tax_code TEXT;
  tax_name TEXT;
  account_id_val UUID;
  account_code TEXT;
  opening_balance NUMERIC;
  period_debits NUMERIC;
  period_credits NUMERIC;
  closing_balance NUMERIC;
  tax_summary JSONB;
  idx INTEGER;
BEGIN
  -- Validate dates
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date (%) must be before or equal to end date (%)', p_start_date, p_end_date;
  END IF;

  -- Iterate through each tax control account
  FOR idx IN 1..array_length(tax_account_codes, 1)
  LOOP
    account_code := tax_account_codes[idx];
    tax_name := tax_names[idx];

    -- Skip COVID for periods on or after 2026-01-01
    IF account_code = '2130' AND p_start_date >= '2026-01-01'::DATE THEN
      CONTINUE;
    END IF;

    -- Get account ID
    SELECT id INTO account_id_val
    FROM accounts
    WHERE business_id = p_business_id
      AND code = account_code
      AND deleted_at IS NULL
    LIMIT 1;

    -- If account doesn't exist, skip it (return zero values)
    IF account_id_val IS NULL THEN
      tax_summary := jsonb_build_object(
        'tax_code', tax_name,
        'account_code', account_code,
        'opening_balance', 0,
        'period_debits', 0,
        'period_credits', 0,
        'closing_balance', 0
      );
      result := result || jsonb_build_array(tax_summary);
      CONTINUE;
    END IF;

    -- Calculate opening balance (sum of all entries before start_date)
    -- Opening balance = sum(credits) - sum(debits) before start_date
    -- For liability accounts: credit balance = payable (positive), debit balance = receivable (negative)
    SELECT 
      COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    INTO opening_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date < p_start_date;

    -- Calculate period debits (sum of debits in period)
    SELECT COALESCE(SUM(jel.debit), 0)
    INTO period_debits
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date >= p_start_date
      AND je.date <= p_end_date;

    -- Calculate period credits (sum of credits in period)
    SELECT COALESCE(SUM(jel.credit), 0)
    INTO period_credits
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date >= p_start_date
      AND je.date <= p_end_date;

    -- Calculate closing balance
    -- Closing = Opening + (Credits - Debits) in period
    closing_balance := opening_balance + (period_credits - period_debits);

    -- Build tax summary object
    tax_summary := jsonb_build_object(
      'tax_code', tax_name,
      'account_code', account_code,
      'opening_balance', ROUND(opening_balance, 2),
      'period_debits', ROUND(period_debits, 2),
      'period_credits', ROUND(period_credits, 2),
      'closing_balance', ROUND(closing_balance, 2)
    );

    -- Append to result array
    result := result || jsonb_build_array(tax_summary);
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Get tax return summary (table format for easier querying)
-- ============================================================================
-- Returns a table with one row per tax type for easier SQL querying
-- ============================================================================
CREATE OR REPLACE FUNCTION get_tax_return_summary(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  tax_code TEXT,
  account_code TEXT,
  opening_balance NUMERIC,
  period_debits NUMERIC,
  period_credits NUMERIC,
  closing_balance NUMERIC
) AS $$
DECLARE
  tax_account_codes TEXT[] := ARRAY['2100', '2110', '2120', '2130'];
  tax_names TEXT[] := ARRAY['VAT', 'NHIL', 'GETFund', 'COVID'];
  account_id_val UUID;
  account_code TEXT;
  tax_name TEXT;
  opening_bal NUMERIC;
  period_deb NUMERIC;
  period_cred NUMERIC;
  closing_bal NUMERIC;
  idx INTEGER;
BEGIN
  -- Validate dates
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date (%) must be before or equal to end date (%)', p_start_date, p_end_date;
  END IF;

  -- Iterate through each tax control account
  FOR idx IN 1..array_length(tax_account_codes, 1)
  LOOP
    account_code := tax_account_codes[idx];
    tax_name := tax_names[idx];

    -- Skip COVID for periods on or after 2026-01-01
    IF account_code = '2130' AND p_start_date >= '2026-01-01'::DATE THEN
      CONTINUE;
    END IF;

    -- Get account ID
    SELECT id INTO account_id_val
    FROM accounts
    WHERE business_id = p_business_id
      AND code = account_code
      AND deleted_at IS NULL
    LIMIT 1;

    -- If account doesn't exist, return zero values
    IF account_id_val IS NULL THEN
      tax_code := tax_name;
      opening_balance := 0;
      period_debits := 0;
      period_credits := 0;
      closing_balance := 0;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Calculate opening balance (sum of all entries before start_date)
    SELECT 
      COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    INTO opening_bal
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date < p_start_date;

    -- Calculate period debits
    SELECT COALESCE(SUM(jel.debit), 0)
    INTO period_deb
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date >= p_start_date
      AND je.date <= p_end_date;

    -- Calculate period credits
    SELECT COALESCE(SUM(jel.credit), 0)
    INTO period_cred
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = p_business_id
      AND jel.account_id = account_id_val
      AND je.date >= p_start_date
      AND je.date <= p_end_date;

    -- Calculate closing balance
    closing_bal := opening_bal + (period_cred - period_deb);

    -- Return row
    tax_code := tax_name;
    opening_balance := ROUND(opening_bal, 2);
    period_debits := ROUND(period_deb, 2);
    period_credits := ROUND(period_cred, 2);
    closing_balance := ROUND(closing_bal, 2);
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION: Functions created successfully
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'STEP 7: Tax return extraction functions created';
  RAISE NOTICE '  - extract_tax_return_from_ledger: Returns JSONB array of tax summaries';
  RAISE NOTICE '  - get_tax_return_summary: Returns table format for SQL querying';
  RAISE NOTICE '  - Source: ONLY ledger data (journal_entries, journal_entry_lines, accounts)';
  RAISE NOTICE '  - COVID levy: Only included for periods before 2026-01-01';
  RAISE NOTICE '  - READ-ONLY: No modifications to ledger data';
END;
$$;

