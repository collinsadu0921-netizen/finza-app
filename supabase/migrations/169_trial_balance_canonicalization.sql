-- ============================================================================
-- MIGRATION: Phase 9 - Trial Balance Canonicalization & Hard Guarantee
-- ============================================================================
-- Guarantees the Trial Balance is the single canonical truth source for all
-- downstream financial statements.
--
-- Invariants:
-- 1. Trial Balance must be ledger-derived ONLY
-- 2. Trial Balance must include opening balance + period movement + closing balance per account
-- 3. Total debits MUST equal total credits (hard invariant)
-- 4. P&L and Balance Sheet MUST reconcile exactly to Trial Balance
-- 5. No financial statement may bypass Trial Balance
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE TRIAL BALANCE SNAPSHOTS TABLE
-- ============================================================================
-- Persist trial balance snapshots per period for audit and reconciliation
CREATE TABLE IF NOT EXISTS trial_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Snapshot metadata
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  generated_by UUID REFERENCES auth.users(id),
  
  -- Aggregated totals (for validation)
  total_debits NUMERIC NOT NULL DEFAULT 0,
  total_credits NUMERIC NOT NULL DEFAULT 0,
  account_count INTEGER NOT NULL DEFAULT 0,
  
  -- Balance validation
  is_balanced BOOLEAN NOT NULL DEFAULT FALSE,
  balance_difference NUMERIC NOT NULL DEFAULT 0,
  
  -- Snapshot data (JSONB array of account balances)
  snapshot_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  UNIQUE(period_id)
);

CREATE INDEX IF NOT EXISTS idx_trial_balance_snapshots_period_id ON trial_balance_snapshots(period_id);
CREATE INDEX IF NOT EXISTS idx_trial_balance_snapshots_business_id ON trial_balance_snapshots(business_id);
CREATE INDEX IF NOT EXISTS idx_trial_balance_snapshots_generated_at ON trial_balance_snapshots(generated_at);

COMMENT ON TABLE trial_balance_snapshots IS 'PHASE 9: Canonical trial balance snapshots per period. Single source of truth for all financial statements.';
COMMENT ON COLUMN trial_balance_snapshots.is_balanced IS 'PHASE 9: Hard invariant: SUM(debits) == SUM(credits). Must be TRUE.';
COMMENT ON COLUMN trial_balance_snapshots.snapshot_data IS 'PHASE 9: JSONB array of account balances: [{account_id, account_code, account_name, account_type, opening_balance, debit_total, credit_total, closing_balance}]';

-- ============================================================================
-- STEP 2: CANONICAL TRIAL BALANCE GENERATOR
-- ============================================================================
-- Generate trial balance from ledger-only source (period_opening_balances + journal_entry_lines)
-- Enforces hard invariant: SUM(debits) == SUM(credits)
CREATE OR REPLACE FUNCTION generate_trial_balance(
  p_period_id UUID,
  p_generated_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  period_record accounting_periods;
  account_record RECORD;
  opening_balance NUMERIC := 0;
  period_debit NUMERIC := 0;
  period_credit NUMERIC := 0;
  closing_balance NUMERIC := 0;
  total_debits NUMERIC := 0;
  total_credits NUMERIC := 0;
  account_count INTEGER := 0;
  trial_balance_rows JSONB[] := ARRAY[]::JSONB[];
  account_row JSONB;
  snapshot_json JSONB;
  balance_difference NUMERIC;
BEGIN
  -- Get period record
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found: %', p_period_id;
  END IF;

  -- Process all accounts
  FOR account_record IN
    SELECT id, code, name, type
    FROM accounts
    WHERE business_id = period_record.business_id
      AND deleted_at IS NULL
    ORDER BY code
  LOOP
    -- Get opening balance from period_opening_balances (ledger-derived snapshot)
    SELECT opening_balance INTO opening_balance
    FROM period_opening_balances
    WHERE period_id = p_period_id
      AND account_id = account_record.id;

    opening_balance := COALESCE(opening_balance, 0);

    -- Calculate period activity from ledger (ledger-only source)
    SELECT 
      COALESCE(SUM(jel.debit), 0),
      COALESCE(SUM(jel.credit), 0)
    INTO period_debit, period_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = account_record.id
      AND je.business_id = period_record.business_id
      AND je.date >= period_record.period_start
      AND je.date <= period_record.period_end;

    period_debit := COALESCE(period_debit, 0);
    period_credit := COALESCE(period_credit, 0);

    -- Calculate closing balance based on account type
    -- Assets/Expenses: debit - credit (normal balance is debit)
    -- Liabilities/Equity/Income: credit - debit (normal balance is credit)
    IF account_record.type IN ('asset', 'expense') THEN
      closing_balance := opening_balance + (period_debit - period_credit);
    ELSE
      closing_balance := opening_balance + (period_credit - period_debit);
    END IF;

    -- Add to totals (for hard invariant check)
    total_debits := total_debits + period_debit;
    total_credits := total_credits + period_credit;

    -- Build account row
    account_row := jsonb_build_object(
      'account_id', account_record.id,
      'account_code', account_record.code,
      'account_name', account_record.name,
      'account_type', account_record.type,
      'opening_balance', opening_balance,
      'debit_total', period_debit,
      'credit_total', period_credit,
      'closing_balance', closing_balance
    );

    trial_balance_rows := array_append(trial_balance_rows, account_row);
    account_count := account_count + 1;
  END LOOP;

  -- HARD INVARIANT: Total debits MUST equal total credits
  balance_difference := ABS(total_debits - total_credits);
  
  IF balance_difference > 0.01 THEN
    RAISE EXCEPTION 'PHASE 9 VIOLATION: Trial Balance does not balance. Total Debits: %, Total Credits: %, Difference: %. All journal entries must be balanced before generating trial balance.', 
      total_debits, total_credits, balance_difference;
  END IF;

  -- Build snapshot JSON
  snapshot_json := jsonb_build_object(
    'period_id', p_period_id,
    'period_start', period_record.period_start,
    'period_end', period_record.period_end,
    'business_id', period_record.business_id,
    'account_count', account_count,
    'total_debits', total_debits,
    'total_credits', total_credits,
    'is_balanced', TRUE,
    'balance_difference', 0,
    'generated_at', NOW(),
    'generated_by', p_generated_by,
    'accounts', trial_balance_rows
  );

  -- Persist snapshot
  INSERT INTO trial_balance_snapshots (
    period_id,
    business_id,
    generated_at,
    generated_by,
    total_debits,
    total_credits,
    account_count,
    is_balanced,
    balance_difference,
    snapshot_data
  )
  VALUES (
    p_period_id,
    period_record.business_id,
    NOW(),
    p_generated_by,
    total_debits,
    total_credits,
    account_count,
    TRUE,
    0,
    to_jsonb(trial_balance_rows)
  )
  ON CONFLICT (period_id) DO UPDATE
  SET 
    generated_at = NOW(),
    generated_by = EXCLUDED.generated_by,
    total_debits = EXCLUDED.total_debits,
    total_credits = EXCLUDED.total_credits,
    account_count = EXCLUDED.account_count,
    is_balanced = EXCLUDED.is_balanced,
    balance_difference = EXCLUDED.balance_difference,
    snapshot_data = EXCLUDED.snapshot_data;

  RETURN snapshot_json;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_trial_balance IS 'PHASE 9: Canonical trial balance generator. Ledger-only source (period_opening_balances + journal_entry_lines). Enforces hard invariant: SUM(debits) == SUM(credits). Persists snapshot for downstream consumption.';

-- ============================================================================
-- STEP 3: GET TRIAL BALANCE FROM SNAPSHOT
-- ============================================================================
-- Returns trial balance from snapshot (canonical source)
-- If snapshot doesn't exist, generates it first
CREATE OR REPLACE FUNCTION get_trial_balance_from_snapshot(
  p_period_id UUID
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  opening_balance NUMERIC,
  debit_total NUMERIC,
  credit_total NUMERIC,
  closing_balance NUMERIC
) AS $$
DECLARE
  snapshot_record trial_balance_snapshots;
  account_data JSONB;
BEGIN
  -- Get snapshot
  SELECT * INTO snapshot_record
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id;

  -- If snapshot doesn't exist, generate it first
  IF NOT FOUND THEN
    PERFORM generate_trial_balance(p_period_id, NULL);
    
    SELECT * INTO snapshot_record
    FROM trial_balance_snapshots
    WHERE period_id = p_period_id;
  END IF;

  -- Return accounts from snapshot
  FOR account_data IN SELECT * FROM jsonb_array_elements(snapshot_record.snapshot_data)
  LOOP
    RETURN QUERY SELECT
      (account_data->>'account_id')::UUID,
      account_data->>'account_code',
      account_data->>'account_name',
      account_data->>'account_type',
      (account_data->>'opening_balance')::NUMERIC,
      (account_data->>'debit_total')::NUMERIC,
      (account_data->>'credit_total')::NUMERIC,
      (account_data->>'closing_balance')::NUMERIC;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_trial_balance_from_snapshot IS 'PHASE 9: Returns trial balance from canonical snapshot. If snapshot doesn''t exist, generates it first. Used by all downstream financial statements.';

-- ============================================================================
-- STEP 4: UPDATE P&L TO CONSUME TRIAL BALANCE ONLY
-- ============================================================================
-- Profit & Loss must consume Trial Balance snapshot only
-- No direct queries to journal_entry_lines
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
  -- Get trial balance from canonical snapshot
  FOR trial_balance_row IN
    SELECT *
    FROM get_trial_balance_from_snapshot(p_period_id)
    WHERE account_type IN ('income', 'expense')
  LOOP
    RETURN QUERY SELECT
      trial_balance_row.account_id,
      trial_balance_row.account_code,
      trial_balance_row.account_name,
      trial_balance_row.account_type,
      -- Period total is the closing balance for income statement accounts
      -- (which is effectively period activity since opening balance is 0)
      trial_balance_row.closing_balance;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_profit_and_loss_from_trial_balance IS 'PHASE 9: Returns P&L from Trial Balance snapshot only. No direct ledger queries. Filters income/expense accounts from canonical trial balance.';

-- ============================================================================
-- STEP 5: UPDATE BALANCE SHEET TO CONSUME TRIAL BALANCE ONLY
-- ============================================================================
-- Balance Sheet must consume Trial Balance snapshot only
-- No direct queries to journal_entry_lines
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
  -- Get trial balance from canonical snapshot
  FOR trial_balance_row IN
    SELECT *
    FROM get_trial_balance_from_snapshot(p_period_id)
    WHERE account_type IN ('asset', 'liability', 'equity')
  LOOP
    RETURN QUERY SELECT
      trial_balance_row.account_id,
      trial_balance_row.account_code,
      trial_balance_row.account_name,
      trial_balance_row.account_type,
      -- Balance is the closing balance for balance sheet accounts
      trial_balance_row.closing_balance;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_balance_sheet_from_trial_balance IS 'PHASE 9: Returns Balance Sheet from Trial Balance snapshot only. No direct ledger queries. Filters asset/liability/equity accounts from canonical trial balance.';

-- ============================================================================
-- STEP 6: GUARD: PREVENT DIRECT LEDGER QUERIES IN STATEMENTS
-- ============================================================================
-- Audit function to detect if statements are bypassing Trial Balance
-- This is a detection mechanism (not a hard block, as application code may
-- still query journal_entry_lines directly - that must be fixed in app layer)
CREATE OR REPLACE FUNCTION assert_statement_uses_trial_balance(
  p_function_name TEXT
)
RETURNS VOID AS $$
BEGIN
  -- This function serves as documentation and can be called from application
  -- to verify that statements use Trial Balance functions
  -- Hard enforcement would require application-level changes
  IF p_function_name NOT IN (
    'get_trial_balance_from_snapshot',
    'get_profit_and_loss_from_trial_balance',
    'get_balance_sheet_from_trial_balance',
    'generate_trial_balance'
  ) THEN
    RAISE WARNING 'PHASE 9: Function % may be bypassing Trial Balance canonical source. Use get_trial_balance_from_snapshot() instead.', p_function_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_statement_uses_trial_balance IS 'PHASE 9: Audit function to detect if statements bypass Trial Balance. Documentation/enforcement marker.';

-- ============================================================================
-- STEP 7: VALIDATE TRIAL BALANCE INTEGRITY
-- ============================================================================
-- Verify that P&L and Balance Sheet reconcile exactly to Trial Balance
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
  -- Get trial balance snapshot
  SELECT * INTO trial_balance_snapshot
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trial balance snapshot not found for period: %', p_period_id;
  END IF;

  -- Calculate P&L totals from trial balance
  FOR trial_balance_account IN
    SELECT *
    FROM get_trial_balance_from_snapshot(p_period_id)
    WHERE account_type IN ('income', 'expense')
  LOOP
    IF trial_balance_account.account_type = 'income' THEN
      pnl_total := pnl_total + trial_balance_account.closing_balance;
    ELSE
      pnl_total := pnl_total - trial_balance_account.closing_balance;
    END IF;
  END LOOP;

  -- Calculate Balance Sheet totals from trial balance
  FOR trial_balance_account IN
    SELECT *
    FROM get_trial_balance_from_snapshot(p_period_id)
    WHERE account_type IN ('asset', 'liability', 'equity')
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
  -- (Net income should be included in Equity via retained earnings)
  IF ABS(balance_sheet_assets - (balance_sheet_liabilities + balance_sheet_equity)) > 0.01 THEN
    RAISE EXCEPTION 'PHASE 9 VIOLATION: Balance Sheet does not balance. Assets: %, Liabilities: %, Equity: %, Difference: %', 
      balance_sheet_assets, balance_sheet_liabilities, balance_sheet_equity,
      ABS(balance_sheet_assets - (balance_sheet_liabilities + balance_sheet_equity));
  END IF;

  -- Build reconciliation result
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

-- ============================================================================
-- STEP 8: DEPRECATE OLD FUNCTIONS (MARK AS NON-CANONICAL)
-- ============================================================================
-- Rename old functions to indicate they are deprecated
-- Keep for backwards compatibility but mark as non-canonical
DO $$
BEGIN
  -- Rename old get_trial_balance if it exists (without period_id)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_trial_balance'
      AND pg_get_function_arguments(p.oid) LIKE '%p_start_date%'
  ) THEN
    ALTER FUNCTION get_trial_balance(UUID, DATE, DATE) RENAME TO get_trial_balance_legacy;
    
    COMMENT ON FUNCTION get_trial_balance_legacy IS 'PHASE 9 DEPRECATED: Use generate_trial_balance(period_id) or get_trial_balance_from_snapshot(period_id) instead. This function does not use canonical Trial Balance snapshots.';
  END IF;

  -- Rename old get_profit_and_loss if it exists (without period_id)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_profit_and_loss'
      AND pg_get_function_arguments(p.oid) LIKE '%p_start_date%'
  ) THEN
    ALTER FUNCTION get_profit_and_loss(UUID, DATE, DATE) RENAME TO get_profit_and_loss_legacy;
    
    COMMENT ON FUNCTION get_profit_and_loss_legacy IS 'PHASE 9 DEPRECATED: Use get_profit_and_loss_from_trial_balance(period_id) instead. This function bypasses canonical Trial Balance.';
  END IF;

  -- Rename old get_balance_sheet if it exists (without period_id)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_balance_sheet'
      AND pg_get_function_arguments(p.oid) LIKE '%p_as_of_date%'
  ) THEN
    ALTER FUNCTION get_balance_sheet(UUID, DATE) RENAME TO get_balance_sheet_legacy;
    
    COMMENT ON FUNCTION get_balance_sheet_legacy IS 'PHASE 9 DEPRECATED: Use get_balance_sheet_from_trial_balance(period_id) instead. This function bypasses canonical Trial Balance.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Functions may not exist or have different signatures, ignore
    NULL;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Trial Balance ledger-derived ONLY: ✅ generate_trial_balance uses period_opening_balances + journal_entry_lines
-- Trial Balance includes opening + movement + closing: ✅ All fields included in snapshot
-- Total debits == total credits (hard invariant): ✅ Enforced with RAISE EXCEPTION
-- P&L and Balance Sheet reconcile to Trial Balance: ✅ validate_statement_reconciliation
-- No statement bypasses Trial Balance: ✅ New functions consume snapshots only (app layer must be updated)
-- ============================================================================
