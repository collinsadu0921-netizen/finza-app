-- ============================================================================
-- Fix: "column reference opening_balance is ambiguous" in P&L / Trial Balance
-- ============================================================================
-- Qualify opening_balance with period_opening_balances table alias so the
-- reference is unambiguous when RLS or planner expands the query. No logic change.
-- ============================================================================

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
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found: %', p_period_id;
  END IF;

  FOR account_record IN
    SELECT a.id, a.code, a.name, a.type
    FROM accounts a
    WHERE a.business_id = period_record.business_id
      AND a.deleted_at IS NULL
    ORDER BY a.code
  LOOP
    -- Qualified: period_opening_balances.opening_balance (disambiguate if RLS joins)
    SELECT pob.opening_balance INTO opening_balance
    FROM period_opening_balances pob
    WHERE pob.period_id = p_period_id
      AND pob.account_id = account_record.id;

    opening_balance := COALESCE(opening_balance, 0);

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

    IF account_record.type IN ('asset', 'expense') THEN
      closing_balance := opening_balance + (period_debit - period_credit);
    ELSE
      closing_balance := opening_balance + (period_credit - period_debit);
    END IF;

    total_debits := total_debits + period_debit;
    total_credits := total_credits + period_credit;

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

  balance_difference := ABS(total_debits - total_credits);

  IF balance_difference > 0.01 THEN
    RAISE EXCEPTION 'PHASE 9 VIOLATION: Trial Balance does not balance. Total Debits: %, Total Credits: %, Difference: %. All journal entries must be balanced before generating trial balance.',
      total_debits, total_credits, balance_difference;
  END IF;

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
  ON CONFLICT (period_id) DO UPDATE SET
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

COMMENT ON FUNCTION generate_trial_balance(UUID, UUID) IS 'PHASE 9: Canonical trial balance generator. Ledger-only source (period_opening_balances + journal_entry_lines). opening_balance qualified to avoid ambiguity.';
