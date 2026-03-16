-- ============================================================================
-- Forensic alert tracking: idempotency flag for escalation notifications.
-- Alert delivery only. No ledger, RPC, or invariant changes.
-- ============================================================================

ALTER TABLE accounting_invariant_runs
  ADD COLUMN IF NOT EXISTS alert_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN accounting_invariant_runs.alert_sent IS 'True after Slack/Email escalation sent for this run; prevents duplicate alerts.';
