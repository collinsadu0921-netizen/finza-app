-- ============================================================================
-- Migration 586: Trial Balance opening-balance fallback
-- ============================================================================
-- Problem:
--   generate_trial_balance() reads opening balances only from
--   period_opening_balances. Existing periods can have no rollforward rows
--   (the table is empty for the whole business), so every account starts at 0
--   and the Trial Balance shows period movement instead of cumulative balances.
--   That makes October Trial Balance closing balances disagree with the
--   cumulative General Ledger and Balance Sheet.
--
-- Intended calculation (migrations 168/169):
--   opening balance = prior period closing balance
--   closing balance = opening balance + current-period movement
--   income/expense accounts reset to zero each period; balance-sheet accounts
--   carry forward.
--
-- Fix:
--   Keep using period_opening_balances when a row exists. When it does not,
--   derive the missing opening balance from ledger activity before the period
--   start for asset/liability/equity accounts, and use zero for income/expense.
--   This is ledger-only and self-heals periods whose rollforward rows were
--   never generated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_trial_balance(
  p_period_id UUID,
  p_generated_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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
  existing_snapshot trial_balance_snapshots;
  lock_key BIGINT;
  has_opening_row BOOLEAN := FALSE;
BEGIN
  -- Serialize concurrent rebuilds for this period.
  lock_key := ('x' || substr(replace(p_period_id::text, '-', ''), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  -- Another transaction may have generated a fresh snapshot while we waited.
  SELECT * INTO existing_snapshot
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id
    AND is_stale = FALSE;

  IF FOUND THEN
    SELECT * INTO period_record
    FROM accounting_periods
    WHERE id = p_period_id;

    snapshot_json := jsonb_build_object(
      'period_id', existing_snapshot.period_id,
      'period_start', period_record.period_start,
      'period_end', period_record.period_end,
      'business_id', existing_snapshot.business_id,
      'account_count', existing_snapshot.account_count,
      'total_debits', existing_snapshot.total_debits,
      'total_credits', existing_snapshot.total_credits,
      'is_balanced', existing_snapshot.is_balanced,
      'balance_difference', existing_snapshot.balance_difference,
      'generated_at', existing_snapshot.generated_at,
      'generated_by', existing_snapshot.generated_by,
      'accounts', existing_snapshot.snapshot_data
    );
    RETURN snapshot_json;
  END IF;

  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found: %', p_period_id;
  END IF;

  FOR account_record IN
    SELECT id, code, name, type
    FROM accounts
    WHERE business_id = period_record.business_id
      AND deleted_at IS NULL
    ORDER BY code
  LOOP
    has_opening_row := FALSE;
    opening_balance := 0;

    SELECT pob.opening_balance
    INTO opening_balance
    FROM period_opening_balances pob
    WHERE pob.period_id = p_period_id
      AND pob.account_id = account_record.id;

    has_opening_row := FOUND;

    IF NOT has_opening_row THEN
      IF account_record.type IN ('asset', 'liability', 'equity') THEN
        -- Carry forward the cumulative ledger balance before this period.
        -- Assets have a debit-normal balance; liabilities/equity are credit-normal.
        SELECT COALESCE(
          SUM(
            CASE
              WHEN account_record.type = 'asset'
                THEN jel.debit - jel.credit
              ELSE jel.credit - jel.debit
            END
          ),
          0
        )
        INTO opening_balance
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE jel.account_id = account_record.id
          AND je.business_id = period_record.business_id
          AND je.date < period_record.period_start;
      ELSE
        -- Income/expense accounts reset each period.
        opening_balance := 0;
      END IF;
    END IF;

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
    snapshot_data,
    is_stale,
    last_rebuilt_at,
    stale_reason
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
    to_jsonb(trial_balance_rows),
    FALSE,
    NOW(),
    NULL
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
    snapshot_data = EXCLUDED.snapshot_data,
    is_stale = FALSE,
    last_rebuilt_at = NOW(),
    stale_reason = NULL,
    last_ledger_change_at = COALESCE(trial_balance_snapshots.last_ledger_change_at, NOW());

  RETURN snapshot_json;
END;
$$;

COMMENT ON FUNCTION public.generate_trial_balance(UUID, UUID) IS
  'Ledger-only Trial Balance generator. Uses period_opening_balances when present; otherwise derives missing balance-sheet openings from ledger activity before period start. Income/expense openings reset to zero.';

-- Force existing snapshots to rebuild with the corrected opening balances.
UPDATE public.trial_balance_snapshots
SET
  is_stale = TRUE,
  stale_reason = 'opening_balance_calculation_fix_586'
WHERE is_stale = FALSE;
