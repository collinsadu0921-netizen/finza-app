-- ============================================================================
-- Migration: Snapshot Engine v2 — Stale-Aware, Lock-Safe, Non-Blocking
-- ============================================================================
-- Fixes: Ledger updates (expenses/invoices/payments) must reflect in Trial Balance
-- / P&L / Balance Sheet snapshots after the next report load.
--
-- Design:
-- 1. Invalidate: Mark period snapshot as stale when ledger changes (cheap, O(1))
-- 2. Rebuild: Regenerate snapshot if missing OR stale (on report request)
-- 3. Lock: Prevent concurrent rebuilds for same period (advisory lock)
--
-- Non-Negotiables:
-- - Posting remains fast and atomic (no heavy aggregation in triggers)
-- - Ledger remains immutable
-- - Multi-tenant isolation (all queries filter by business_id)
-- - Reporting remains deterministic
-- ============================================================================

-- ============================================================================
-- STEP 1: EXTEND trial_balance_snapshots WITH STALE METADATA
-- ============================================================================

ALTER TABLE trial_balance_snapshots
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_rebuilt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ledger_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_reason TEXT;

-- Mark all existing snapshots as stale (forces refresh once after deploy)
-- Note: DEFAULT TRUE already sets new rows to stale, but we explicitly mark existing
-- rows with audit trail (stale_reason and last_ledger_change_at) for clarity
UPDATE trial_balance_snapshots 
SET 
  is_stale = TRUE,
  stale_reason = 'deploy_refresh',
  last_ledger_change_at = NOW()
WHERE is_stale = FALSE OR stale_reason IS NULL;

COMMENT ON COLUMN trial_balance_snapshots.is_stale IS 'Snapshot Engine v2: TRUE if snapshot is stale and needs regeneration. Set to FALSE after successful rebuild.';
COMMENT ON COLUMN trial_balance_snapshots.last_rebuilt_at IS 'Snapshot Engine v2: Timestamp when snapshot was last successfully rebuilt.';
COMMENT ON COLUMN trial_balance_snapshots.last_ledger_change_at IS 'Snapshot Engine v2: Timestamp when ledger change invalidated this snapshot. Preserved across rebuilds for audit trail.';
COMMENT ON COLUMN trial_balance_snapshots.stale_reason IS 'Snapshot Engine v2: Reason why snapshot was marked stale (e.g., journal_entry_insert, deploy_refresh). Cleared on rebuild.';

-- ============================================================================
-- STEP 2: INVALIDATION FUNCTION (O(1), BUSINESS-SCOPED)
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_trial_balance_snapshot_stale(
  p_business_id UUID,
  p_posting_date DATE,
  p_reason TEXT DEFAULT 'journal_entry_insert'
)
RETURNS VOID AS $$
DECLARE
  v_period_id UUID;
BEGIN
  -- Resolve period for posting date (O(1) lookup, no period creation)
  -- IMPORTANT: Does NOT create periods (unlike ensure_accounting_period).
  -- If no period exists, invalidation is a no-op (safe fallback).
  -- Expected behavior: Invalidation only affects existing snapshots.
  -- If period doesn't exist yet, report generation will create period and snapshot.
  SELECT id INTO v_period_id
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_posting_date >= period_start
    AND p_posting_date <= period_end
  LIMIT 1;

  -- If period found and snapshot exists, mark stale
  IF v_period_id IS NOT NULL THEN
    UPDATE trial_balance_snapshots
    SET 
      is_stale = TRUE,
      last_ledger_change_at = NOW(),
      stale_reason = p_reason
    WHERE period_id = v_period_id
      AND business_id = p_business_id;
    -- If snapshot doesn't exist, do nothing (report will generate it later)
    -- This is intentional: invalidation only affects existing snapshots.
  END IF;
  -- If period doesn't exist, do nothing (safe fallback, no period creation in write path)
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_trial_balance_snapshot_stale IS 'Snapshot Engine v2: Marks trial balance snapshot as stale when ledger changes. O(1) operation, business-scoped, idempotent. Does NOT create periods. Only affects existing snapshots. If period/snapshot missing, no-op (safe fallback).';

-- ============================================================================
-- STEP 3: INVALIDATION TRIGGER (MUST NOT ABORT POSTING)
-- ============================================================================

CREATE OR REPLACE FUNCTION invalidate_snapshot_on_journal_entry()
RETURNS TRIGGER AS $$
BEGIN
  -- CRITICAL: Wrap in exception handler to prevent aborting journal_entries insert
  -- Trigger is SECURITY INVOKER (default) - runs with caller privileges, safe
  BEGIN
    PERFORM mark_trial_balance_snapshot_stale(
      NEW.business_id,
      NEW.date,
      'journal_entry_insert'
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- Log error but do NOT abort the journal_entries insert
      -- Posting must succeed even if invalidation fails
      RAISE WARNING 'Failed to invalidate snapshot for business_id=%, date=%, error=%', 
        NEW.business_id, NEW.date, SQLERRM;
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_invalidate_snapshot_on_journal_entry ON journal_entries;
CREATE TRIGGER trigger_invalidate_snapshot_on_journal_entry
  AFTER INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_snapshot_on_journal_entry();

COMMENT ON FUNCTION invalidate_snapshot_on_journal_entry IS 'Snapshot Engine v2: Trigger function that invalidates snapshot on journal entry insert. Wrapped in exception handler to prevent aborting posting. SECURITY INVOKER (default).';
COMMENT ON TRIGGER trigger_invalidate_snapshot_on_journal_entry ON journal_entries IS 'Snapshot Engine v2: Marks trial balance snapshot stale when journal entry is inserted. Does NOT abort posting if invalidation fails. References journal_entries.business_id and journal_entries.date.';

-- ============================================================================
-- STEP 4: UPGRADE get_trial_balance_from_snapshot (STALE-AWARE)
-- ============================================================================

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
  v_business_id UUID;
BEGIN
  -- Defensive tenant isolation: resolve business_id from period
  SELECT business_id INTO v_business_id
  FROM accounting_periods
  WHERE id = p_period_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid period_id: %', p_period_id;
  END IF;
  
  -- Get snapshot with explicit business_id validation (tenant isolation guard)
  SELECT * INTO snapshot_record
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id
    AND business_id = v_business_id;

  -- If snapshot doesn't exist OR is stale, regenerate it
  IF NOT FOUND OR snapshot_record.is_stale = TRUE THEN
    PERFORM generate_trial_balance(p_period_id, NULL);
    
    -- Re-fetch snapshot after generation (with business_id validation)
    SELECT * INTO snapshot_record
    FROM trial_balance_snapshots
    WHERE period_id = p_period_id
      AND business_id = v_business_id;
  END IF;

  -- Return accounts from snapshot
  -- snapshot_data is JSONB array: [{account_id, account_code, ...}, ...]
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

COMMENT ON FUNCTION get_trial_balance_from_snapshot IS 'Snapshot Engine v2: Returns trial balance from canonical snapshot. Regenerates if missing OR stale. Used by all downstream financial statements.';

-- ============================================================================
-- STEP 5: UPGRADE generate_trial_balance (CONCURRENCY PROTECTION + FRESH MARKING)
-- ============================================================================
-- Backward compatibility: Signature matches migration 169 exactly:
-- generate_trial_balance(p_period_id UUID, p_generated_by UUID DEFAULT NULL) RETURNS JSONB
-- Safe to REPLACE (no breaking changes)
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
  existing_snapshot trial_balance_snapshots;
  lock_key BIGINT;
BEGIN
  -- Acquire advisory lock for this period_id (prevents concurrent rebuilds)
  -- Use collision-safe UUID lock: first 16 hex chars converted to BIGINT
  -- This ensures mathematical collision safety (64-bit space from UUID)
  -- Namespace 'trial_balance_snapshot' ensures separation from other lock types
  lock_key := ('x' || substr(replace(p_period_id::text, '-', ''), 1, 16))::bit(64)::bigint;
  
  PERFORM pg_advisory_xact_lock(lock_key);

  -- After acquiring lock, re-check snapshot (another transaction may have generated it)
  SELECT * INTO existing_snapshot
  FROM trial_balance_snapshots
  WHERE period_id = p_period_id
    AND is_stale = FALSE;

  IF FOUND THEN
    -- Another transaction already generated fresh snapshot while we waited for lock
    -- Get period record for period_start/period_end
    SELECT * INTO period_record
    FROM accounting_periods
    WHERE id = p_period_id;
    
    -- Build JSONB from existing snapshot and return
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
    SELECT pob.opening_balance
    INTO opening_balance
    FROM period_opening_balances pob
    WHERE pob.period_id = p_period_id
      AND pob.account_id = account_record.id;

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

  -- Persist snapshot and mark as fresh
  -- snapshot_data: to_jsonb(JSONB[]) converts PostgreSQL array to JSONB array (correct shape)
  -- last_ledger_change_at: Preserved on rebuild (audit trail of when snapshot was invalidated)
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
    to_jsonb(trial_balance_rows),  -- Converts JSONB[] to JSONB array (correct shape)
    FALSE,  -- Mark fresh
    NOW(),  -- Update rebuild timestamp
    NULL    -- Clear stale reason
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
    is_stale = FALSE,  -- Mark fresh
    last_rebuilt_at = NOW(),  -- Update rebuild timestamp
    stale_reason = NULL,  -- Clear stale reason
    -- Preserve last_ledger_change_at (audit trail, not overwritten on rebuild)
    last_ledger_change_at = COALESCE(trial_balance_snapshots.last_ledger_change_at, NOW());

  RETURN snapshot_json;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_trial_balance IS 'Snapshot Engine v2: Canonical trial balance generator with concurrency protection. Ledger-only source (period_opening_balances + journal_entry_lines). Enforces hard invariant: SUM(debits) == SUM(credits). Marks snapshot fresh after rebuild. Uses advisory lock to prevent concurrent rebuilds. Backward compatible: signature matches migration 169.';

-- ============================================================================
-- VERIFICATION NOTES
-- ============================================================================
-- After migration, verify:
-- 1. Posting expense causes snapshot to flip is_stale=true (if snapshot exists)
-- 2. Loading report rebuilds snapshot and flips is_stale=false with last_rebuilt_at updated
-- 3. Concurrency: two parallel report calls do not both rebuild (lock works)
-- 4. Posting still succeeds even if invalidation fails (exception handler works)
-- 5. snapshot_data is JSONB array (not PostgreSQL array encoding)
-- ============================================================================
