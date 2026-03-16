-- ============================================================================
-- MIGRATION: Period close audit checks RPC + append-only log
-- ============================================================================
-- Pre-close checks (audit compliance):
-- 1) Trial balance balanced (zero tolerance)
-- 2) Period AR total matches operational expected (zero tolerance) or resolved
-- 3) No unposted WARN/FAIL mismatches (no invoice with |delta| > 0 and no resolution)
-- ============================================================================

-- ============================================================================
-- TABLE: period_close_attempts (append-only log of each close attempt)
-- ============================================================================
CREATE TABLE IF NOT EXISTS period_close_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checks_passed BOOLEAN NOT NULL,
  failures JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_period_close_attempts_business_period
  ON period_close_attempts(business_id, period_id);
CREATE INDEX IF NOT EXISTS idx_period_close_attempts_performed_at
  ON period_close_attempts(performed_at);

COMMENT ON TABLE period_close_attempts IS
  'Append-only log of period close check runs. Each row = one attempt (checks_passed, failures). No UPDATE/DELETE.';

-- Append-only: prevent UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_period_close_attempts_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'period_close_attempts is append-only.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_period_close_attempts_modification ON period_close_attempts;
CREATE TRIGGER trigger_prevent_period_close_attempts_modification
  BEFORE UPDATE OR DELETE ON period_close_attempts
  FOR EACH ROW EXECUTE PROCEDURE prevent_period_close_attempts_modification();

-- ============================================================================
-- RPC: run_period_close_checks(p_business_id, p_period_id)
-- Returns: { "ok": boolean, "failures": [ { "code", "title", "detail" } ] }
-- ============================================================================
CREATE OR REPLACE FUNCTION run_period_close_checks(
  p_business_id UUID,
  p_period_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_period_start DATE;
  v_period_end   DATE;
  v_tb_debit    NUMERIC := 0;
  v_tb_credit   NUMERIC := 0;
  v_failures    JSONB[] := ARRAY[]::JSONB[];
  v_ledger_ar   NUMERIC := 0;
  v_operational NUMERIC := 0;
  v_mismatch_count INT := 0;
BEGIN
  -- Resolve period
  SELECT period_start, period_end INTO v_period_start, v_period_end
  FROM accounting_periods
  WHERE id = p_period_id AND business_id = p_business_id;

  IF v_period_start IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'failures', jsonb_build_array(
        jsonb_build_object(
          'code', 'PERIOD_NOT_FOUND',
          'title', 'Period not found',
          'detail', format('No period found for business %s and period %s', p_business_id, p_period_id)
        )
      )
    );
  END IF;

  -- -------------------------------------------------------------------------
  -- Check 1: Trial balance balanced (zero tolerance)
  -- Contract v2.0 enforcement: Period Close uses Snapshot TB only
  -- -------------------------------------------------------------------------
  SELECT COALESCE(SUM(tb.debit_total), 0), COALESCE(SUM(tb.credit_total), 0)
  INTO v_tb_debit, v_tb_credit
  FROM get_trial_balance_from_snapshot(p_period_id) AS tb;

  IF ABS(v_tb_debit - v_tb_credit) > 0 THEN
    v_failures := array_append(v_failures, jsonb_build_object(
      'code', 'TRIAL_BALANCE_UNBALANCED',
      'title', 'Trial balance is not balanced',
      'detail', format('Total debits (%s) do not equal total credits (%s). Trial balance must balance (zero tolerance) before period close.', v_tb_debit, v_tb_credit)
    ));
  END IF;

  -- -------------------------------------------------------------------------
  -- Check 2 & 3: Period AR vs operational; unresolved WARN/FAIL mismatches
  -- Ledger AR from get_ar_balances_by_invoice; operational = invoice total - payments - credits per invoice
  -- -------------------------------------------------------------------------
  WITH ar_ledger AS (
    SELECT invoice_id, balance
    FROM get_ar_balances_by_invoice(p_business_id, p_period_id)
  ),
  inv_expected AS (
    SELECT
      i.id AS invoice_id,
      (i.total - COALESCE(SUM(p.amount), 0) - COALESCE(SUM(cn.total), 0)) AS expected
    FROM invoices i
    INNER JOIN ar_ledger ar ON ar.invoice_id = i.id
    LEFT JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
    LEFT JOIN credit_notes cn ON cn.invoice_id = i.id AND cn.status = 'applied' AND cn.deleted_at IS NULL
    WHERE i.business_id = p_business_id
    GROUP BY i.id, i.total
  ),
  comparison AS (
    SELECT
      ar.invoice_id,
      ar.balance AS ledger_balance,
      e.expected AS operational_expected,
      (ar.balance - e.expected) AS delta,
      EXISTS (
        SELECT 1 FROM reconciliation_resolutions rr
        WHERE rr.business_id = p_business_id
          AND rr.scope_type = 'invoice'
          AND rr.scope_id = ar.invoice_id
      ) AS has_resolution
    FROM ar_ledger ar
    JOIN inv_expected e ON e.invoice_id = ar.invoice_id
  )
  SELECT
    COALESCE(SUM(c.ledger_balance), 0),
    COALESCE(SUM(c.operational_expected), 0),
    COUNT(*) FILTER (WHERE ABS(c.delta) > 0.01 AND NOT c.has_resolution)
  INTO v_ledger_ar, v_operational, v_mismatch_count
  FROM comparison c;

  IF ABS(v_ledger_ar - v_operational) > 0.01 THEN
    v_failures := array_append(v_failures, jsonb_build_object(
      'code', 'AR_RECONCILIATION_MISMATCH',
      'title', 'Period AR does not match operational expected',
      'detail', format('Ledger AR total (%s) does not equal operational expected total (%s). Resolve mismatches via reconciliation before close.', v_ledger_ar, v_operational)
    ));
  END IF;

  IF v_mismatch_count > 0 THEN
    v_failures := array_append(v_failures, jsonb_build_object(
      'code', 'UNRESOLVED_AR_MISMATCHES',
      'title', format('%s invoice(s) with unresolved AR mismatch', v_mismatch_count),
      'detail', format('%s invoice(s) have ledger vs operational mismatch and no posted reconciliation adjustment. Resolve or post adjustments before close.', v_mismatch_count)
    ));
  END IF;

  RETURN jsonb_build_object(
    'ok', array_length(v_failures, 1) IS NULL,
    'failures', COALESCE(
      (SELECT jsonb_agg(f) FROM unnest(v_failures) f),
      '[]'::jsonb
    )
  );
END;
$$;

COMMENT ON FUNCTION run_period_close_checks IS
  'Pre-close audit checks: (1) Trial balance balanced, (2) Period AR matches operational or resolved, (3) No unposted WARN/FAIL mismatches. Returns ok and structured failures.';
