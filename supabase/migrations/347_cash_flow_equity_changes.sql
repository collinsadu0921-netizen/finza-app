-- ============================================================================
-- MIGRATION 347: Account Movements — Cash Flow & Equity Changes foundations
-- ============================================================================
-- Adds get_account_movements() — a single, canonical per-account function that
-- returns opening balance, period activity, and closing balance in one pass.
--
-- Used by:
--   • Statement of Cash Flows    (IAS 7 — Indirect Method)
--   • Statement of Changes in Equity (IAS 1)
--
-- Design principles:
--   • Ledger-only (journal_entries + journal_entry_lines + accounts)
--   • Read-only, deterministic, audit-safe
--   • Signed per normal-balance convention:
--       - asset, expense            → debit-normal  (debit − credit)
--       - liability, equity, income,
--         revenue, contra_asset     → credit-normal (credit − debit)
--   • Opening  = cumulative to the day BEFORE p_start_date
--   • Period   = activity within [p_start_date, p_end_date] inclusive
--   • Closing  = cumulative to p_end_date inclusive
-- ============================================================================

CREATE OR REPLACE FUNCTION get_account_movements(
  p_business_id UUID,
  p_start_date  DATE,
  p_end_date    DATE
)
RETURNS TABLE (
  account_id      UUID,
  account_code    TEXT,
  account_name    TEXT,
  account_type    TEXT,
  opening_balance NUMERIC,   -- signed, cumulative to day before p_start_date
  period_debit    NUMERIC,   -- raw debits within period (unsigned)
  period_credit   NUMERIC,   -- raw credits within period (unsigned)
  period_movement NUMERIC,   -- signed net movement within period
  closing_balance NUMERIC    -- signed, cumulative to p_end_date
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,

    -- ── Opening balance ─────────────────────────────────────────────────────
    CASE
      WHEN a.type IN ('asset', 'expense') THEN
        COALESCE(SUM(CASE WHEN je.date <  p_start_date THEN jel.debit  ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN je.date <  p_start_date THEN jel.credit ELSE 0 END), 0)
      ELSE
        -- liability, equity, income, revenue, contra_asset
        COALESCE(SUM(CASE WHEN je.date <  p_start_date THEN jel.credit ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN je.date <  p_start_date THEN jel.debit  ELSE 0 END), 0)
    END AS opening_balance,

    -- ── Period raw debits ────────────────────────────────────────────────────
    COALESCE(SUM(
      CASE WHEN je.date >= p_start_date AND je.date <= p_end_date THEN jel.debit ELSE 0 END
    ), 0) AS period_debit,

    -- ── Period raw credits ───────────────────────────────────────────────────
    COALESCE(SUM(
      CASE WHEN je.date >= p_start_date AND je.date <= p_end_date THEN jel.credit ELSE 0 END
    ), 0) AS period_credit,

    -- ── Period movement (signed) ─────────────────────────────────────────────
    CASE
      WHEN a.type IN ('asset', 'expense') THEN
        COALESCE(SUM(CASE WHEN je.date >= p_start_date AND je.date <= p_end_date THEN jel.debit  ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN je.date >= p_start_date AND je.date <= p_end_date THEN jel.credit ELSE 0 END), 0)
      ELSE
        COALESCE(SUM(CASE WHEN je.date >= p_start_date AND je.date <= p_end_date THEN jel.credit ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN je.date >= p_start_date AND je.date <= p_end_date THEN jel.debit  ELSE 0 END), 0)
    END AS period_movement,

    -- ── Closing balance ──────────────────────────────────────────────────────
    CASE
      WHEN a.type IN ('asset', 'expense') THEN
        COALESCE(SUM(CASE WHEN je.date <= p_end_date THEN jel.debit  ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN je.date <= p_end_date THEN jel.credit ELSE 0 END), 0)
      ELSE
        COALESCE(SUM(CASE WHEN je.date <= p_end_date THEN jel.credit ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN je.date <= p_end_date THEN jel.debit  ELSE 0 END), 0)
    END AS closing_balance

  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries     je  ON je.id = jel.journal_entry_id
                                    AND je.business_id = p_business_id

  WHERE a.business_id = p_business_id
    AND a.deleted_at  IS NULL

  GROUP BY a.id, a.code, a.name, a.type

  HAVING
    -- Only accounts with any activity up to p_end_date
    COALESCE(SUM(CASE WHEN je.date <= p_end_date THEN jel.debit  ELSE 0 END), 0) != 0 OR
    COALESCE(SUM(CASE WHEN je.date <= p_end_date THEN jel.credit ELSE 0 END), 0) != 0

  ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_account_movements(UUID, DATE, DATE) IS
'Returns per-account opening balance, period debits/credits/movement, and closing balance.
Opening  = cumulative to the day before p_start_date.
Period   = activity within [p_start_date, p_end_date] inclusive.
Closing  = cumulative to p_end_date inclusive.
Signed per normal-balance convention (asset/expense: debit-normal; others: credit-normal).
Used for: Statement of Cash Flows (IAS 7 indirect method) and Statement of Changes in Equity (IAS 1).
Ledger-only, read-only, audit-safe.';
