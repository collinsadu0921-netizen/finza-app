-- ============================================================================
-- Forensic accounting monitoring: tables + run_forensic_accounting_verification
-- Monitoring only. No ledger or posting changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) accounting_invariant_runs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_invariant_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2) accounting_invariant_failures
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_invariant_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES accounting_invariant_runs(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  business_id UUID,
  severity TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_invariant_failures_run_id ON accounting_invariant_failures(run_id);
CREATE INDEX IF NOT EXISTS idx_accounting_invariant_failures_check_id ON accounting_invariant_failures(check_id);
CREATE INDEX IF NOT EXISTS idx_accounting_invariant_failures_severity ON accounting_invariant_failures(severity);

-- ----------------------------------------------------------------------------
-- 3) run_forensic_accounting_verification(p_run_id UUID) RETURNS JSONB
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION run_forensic_accounting_verification(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check_id TEXT;
  v_count BIGINT;
  v_total_failures BIGINT := 0;
  v_alertable_failures BIGINT := 0;
  v_check_counts JSONB := '{}'::JSONB;
  v_row RECORD;
  v_ledger_debits NUMERIC;
  v_ledger_credits NUMERIC;
  v_snapshot_debits NUMERIC;
  v_snapshot_credits NUMERIC;
  v_snapshot_balanced BOOLEAN;
  v_tb_mismatch_count BIGINT := 0;
BEGIN
  -- -------------------------------------------------------------------------
  -- ENFORCEMENT: Archived tenant exclusion (forensic runner only).
  -- Every invariant query MUST be scoped by JOIN businesses b ON b.id = <table>.business_id AND b.archived_at IS NULL.
  -- Tables read: journal_entries, journal_entry_lines (via je), invoices, trial_balance_snapshots.
  -- journal_entry_lines: scoped via journal_entries → businesses.
  -- trial_balance_snapshots: scoped via tbs.business_id → businesses; loop body uses v_row.business_id from that set.
  -- Archived data remains queryable elsewhere; filter applies ONLY to this runner.
  -- -------------------------------------------------------------------------

  -- 1) je_imbalanced: journal_entry_lines → journal_entries → businesses (archived_at IS NULL)
  INSERT INTO accounting_invariant_failures (run_id, check_id, business_id, severity, payload)
  SELECT
    p_run_id,
    'je_imbalanced',
    je.business_id,
    'alert',
    jsonb_build_object(
      'journal_entry_id', s.journal_entry_id,
      'business_id', je.business_id,
      'sum_debit', s.sd,
      'sum_credit', s.sc,
      'difference', ABS(s.sd - s.sc)
    )
  FROM (
    SELECT
      journal_entry_id,
      SUM(debit) AS sd,
      SUM(credit) AS sc
    FROM journal_entry_lines
    GROUP BY journal_entry_id
    HAVING ABS(SUM(debit) - SUM(credit)) > 0.005
  ) s
  JOIN journal_entries je ON je.id = s.journal_entry_id
  JOIN businesses b ON b.id = je.business_id AND b.archived_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_failures := v_total_failures + v_count;
  v_alertable_failures := v_alertable_failures + v_count;
  v_check_counts := v_check_counts || jsonb_build_object('je_imbalanced', v_count);

  -- 2) period_id_null: journal_entries → businesses (archived_at IS NULL)
  INSERT INTO accounting_invariant_failures (run_id, check_id, business_id, severity, payload)
  SELECT
    p_run_id,
    'period_id_null',
    je.business_id,
    'alert',
    jsonb_build_object('id', je.id, 'business_id', je.business_id)
  FROM journal_entries je
  JOIN businesses b ON b.id = je.business_id AND b.archived_at IS NULL
  WHERE je.period_id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_failures := v_total_failures + v_count;
  v_alertable_failures := v_alertable_failures + v_count;
  v_check_counts := v_check_counts || jsonb_build_object('period_id_null', v_count);

  -- 3) invoice_je_date_mismatch: journal_entries + invoices → businesses (archived_at IS NULL)
  INSERT INTO accounting_invariant_failures (run_id, check_id, business_id, severity, payload)
  SELECT
    p_run_id,
    'invoice_je_date_mismatch',
    je.business_id,
    'alert',
    jsonb_build_object(
      'journal_entry_id', je.id,
      'invoice_id', i.id,
      'je_date', je.date,
      'invoice_date', COALESCE(i.sent_at::date, i.issue_date)
    )
  FROM journal_entries je
  JOIN invoices i ON i.id = je.reference_id AND i.business_id = je.business_id
  JOIN businesses b ON b.id = je.business_id AND b.archived_at IS NULL
  WHERE je.reference_type = 'invoice'
    AND je.date IS DISTINCT FROM COALESCE(i.sent_at::date, i.issue_date);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_total_failures := v_total_failures + v_count;
  v_alertable_failures := v_alertable_failures + v_count;
  v_check_counts := v_check_counts || jsonb_build_object('invoice_je_date_mismatch', v_count);

  -- 4) trial_balance_snapshot_mismatch: trial_balance_snapshots → accounting_periods → businesses (archived_at IS NULL); loop body ledger read uses v_row.business_id (already non-archived)
  FOR v_row IN
    SELECT tbs.period_id, tbs.business_id, tbs.total_debits AS sd, tbs.total_credits AS sc, tbs.is_balanced AS bal,
           ap.period_start, ap.period_end
    FROM trial_balance_snapshots tbs
    JOIN accounting_periods ap ON ap.id = tbs.period_id
    JOIN businesses b ON b.id = tbs.business_id AND b.archived_at IS NULL
  LOOP
    SELECT
      COALESCE(SUM(jel.debit), 0),
      COALESCE(SUM(jel.credit), 0)
    INTO v_ledger_debits, v_ledger_credits
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = v_row.business_id
      AND je.date >= v_row.period_start
      AND je.date <= v_row.period_end;

    v_snapshot_debits := v_row.sd;
    v_snapshot_credits := v_row.sc;
    v_snapshot_balanced := v_row.bal;

    IF ABS(v_ledger_debits - v_snapshot_debits) > 0.005
       OR ABS(v_ledger_credits - v_snapshot_credits) > 0.005
       OR (v_snapshot_balanced IS FALSE AND ABS(v_ledger_debits - v_ledger_credits) <= 0.005)
       OR (v_snapshot_balanced IS TRUE AND ABS(v_ledger_debits - v_ledger_credits) > 0.005) THEN
      INSERT INTO accounting_invariant_failures (run_id, check_id, business_id, severity, payload)
      VALUES (
        p_run_id,
        'trial_balance_snapshot_mismatch',
        v_row.business_id,
        'alert',
        jsonb_build_object(
          'period_id', v_row.period_id,
          'snapshot_total_debits', v_snapshot_debits,
          'snapshot_total_credits', v_snapshot_credits,
          'snapshot_is_balanced', v_snapshot_balanced,
          'ledger_total_debits', v_ledger_debits,
          'ledger_total_credits', v_ledger_credits
        )
      );
      v_total_failures := v_total_failures + 1;
      v_alertable_failures := v_alertable_failures + 1;
      v_tb_mismatch_count := v_tb_mismatch_count + 1;
    END IF;
  END LOOP;

  v_check_counts := v_check_counts || jsonb_build_object('trial_balance_snapshot_mismatch', v_tb_mismatch_count);

  RETURN jsonb_build_object(
    'total_failures', v_total_failures,
    'alertable_failures', v_alertable_failures,
    'check_counts', v_check_counts
  );
END;
$$;

COMMENT ON FUNCTION run_forensic_accounting_verification(UUID) IS 'Forensic accounting verification: runs read-only invariant checks, inserts failures into accounting_invariant_failures. Returns summary counts. Monitoring only. Archived tenants excluded from forensic dataset (businesses.archived_at IS NULL). No schema or contract changes.';
