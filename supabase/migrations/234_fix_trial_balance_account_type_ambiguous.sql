-- ============================================================================
-- Fix: "column reference account_type is ambiguous" in P&L and Balance Sheet
-- ============================================================================
-- Qualify table-function result with alias so WHERE account_type is unambiguous
-- when the planner or RLS expands the query. No logic change.
-- ============================================================================

-- P&L: qualify get_trial_balance_from_snapshot result
CREATE OR REPLACE FUNCTION get_profit_and_loss_from_trial_balance(
  p_period_id UUID
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  period_total NUMERIC
) AS $$
DECLARE
  trial_balance_row RECORD;
BEGIN
  FOR trial_balance_row IN
    SELECT tb.account_id, tb.account_code, tb.account_name, tb.account_type, tb.closing_balance
    FROM get_trial_balance_from_snapshot(p_period_id) AS tb
    WHERE tb.account_type IN ('income', 'expense')
  LOOP
    account_id := trial_balance_row.account_id;
    account_code := trial_balance_row.account_code;
    account_name := trial_balance_row.account_name;
    account_type := trial_balance_row.account_type;
    period_total := trial_balance_row.closing_balance;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_profit_and_loss_from_trial_balance IS 'PHASE 9: Returns P&L from Trial Balance snapshot only. No direct ledger queries. Filters income/expense accounts from canonical trial balance.';

-- Balance Sheet: qualify get_trial_balance_from_snapshot result
CREATE OR REPLACE FUNCTION get_balance_sheet_from_trial_balance(
  p_period_id UUID
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  balance NUMERIC
) AS $$
DECLARE
  trial_balance_row RECORD;
BEGIN
  FOR trial_balance_row IN
    SELECT tb.account_id, tb.account_code, tb.account_name, tb.account_type, tb.closing_balance
    FROM get_trial_balance_from_snapshot(p_period_id) AS tb
    WHERE tb.account_type IN ('asset', 'liability', 'equity')
  LOOP
    account_id := trial_balance_row.account_id;
    account_code := trial_balance_row.account_code;
    account_name := trial_balance_row.account_name;
    account_type := trial_balance_row.account_type;
    balance := trial_balance_row.closing_balance;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_balance_sheet_from_trial_balance IS 'PHASE 9: Returns Balance Sheet from Trial Balance snapshot only. No direct ledger queries. Filters asset/liability/equity accounts from canonical trial balance.';

-- validate_statement_reconciliation: qualify in both FOR loops
CREATE OR REPLACE FUNCTION validate_statement_reconciliation(
  p_period_id UUID
)
RETURNS JSONB AS $$
DECLARE
  trial_balance_snapshot trial_balance_snapshots;
  pnl_total NUMERIC := 0;
  balance_sheet_assets NUMERIC := 0;
  balance_sheet_liabilities NUMERIC := 0;
  balance_sheet_equity NUMERIC := 0;
  trial_balance_account RECORD;
  reconciliation_result JSONB;
BEGIN
  SELECT * INTO trial_balance_snapshot
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trial balance snapshot not found for period: %', p_period_id;
  END IF;

  FOR trial_balance_account IN
    SELECT tb.*
    FROM get_trial_balance_from_snapshot(p_period_id) AS tb
    WHERE tb.account_type IN ('income', 'expense')
  LOOP
    IF trial_balance_account.account_type = 'income' THEN
      pnl_total := pnl_total + trial_balance_account.closing_balance;
    ELSE
      pnl_total := pnl_total - trial_balance_account.closing_balance;
    END IF;
  END LOOP;

  FOR trial_balance_account IN
    SELECT tb.*
    FROM get_trial_balance_from_snapshot(p_period_id) AS tb
    WHERE tb.account_type IN ('asset', 'liability', 'equity')
  LOOP
    IF trial_balance_account.account_type = 'asset' THEN
      balance_sheet_assets := balance_sheet_assets + trial_balance_account.closing_balance;
    ELSIF trial_balance_account.account_type = 'liability' THEN
      balance_sheet_liabilities := balance_sheet_liabilities + trial_balance_account.closing_balance;
    ELSE
      balance_sheet_equity := balance_sheet_equity + trial_balance_account.closing_balance;
    END IF;
  END LOOP;

  -- Verify Balance Sheet equation: Assets = Liabilities + Equity
  IF ABS(balance_sheet_assets - (balance_sheet_liabilities + balance_sheet_equity)) > 0.01 THEN
    RAISE EXCEPTION 'PHASE 9 VIOLATION: Balance Sheet does not balance. Assets: %, Liabilities: %, Equity: %, Difference: %',
      balance_sheet_assets, balance_sheet_liabilities, balance_sheet_equity,
      ABS(balance_sheet_assets - (balance_sheet_liabilities + balance_sheet_equity));
  END IF;

  reconciliation_result := jsonb_build_object(
    'period_id', p_period_id,
    'valid', TRUE,
    'trial_balance_debits', trial_balance_snapshot.total_debits,
    'trial_balance_credits', trial_balance_snapshot.total_credits,
    'trial_balance_is_balanced', trial_balance_snapshot.is_balanced,
    'pnl_net_income', pnl_total,
    'balance_sheet_assets', balance_sheet_assets,
    'balance_sheet_liabilities', balance_sheet_liabilities,
    'balance_sheet_equity', balance_sheet_equity,
    'balance_sheet_balanced', ABS(balance_sheet_assets - (balance_sheet_liabilities + balance_sheet_equity)) <= 0.01,
    'validated_at', NOW()
  );
  RETURN reconciliation_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_statement_reconciliation IS 'PHASE 9: Validates that P&L and Balance Sheet reconcile exactly to Trial Balance. Enforces hard invariants.';
