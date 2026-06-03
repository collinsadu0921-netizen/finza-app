-- ============================================================================
-- Repair orphan invoice payments (posts missing payment journals)
-- Requires migration 484_payment_posting_integrity_phase2f.sql applied.
--
-- Usage:
--   SELECT repair_orphan_invoice_payment_journals(NULL, 200, 'manual-repair');
--   SELECT repair_orphan_invoice_payment_journals('<business_id>'::uuid, 50, 'manual-repair');
--
-- Review skipped[].reason before re-running (e.g. locked period, draft invoice).
-- ============================================================================

-- Preview orphans first (read-only):
-- \i scripts/diagnose-payment-journal-integrity.sql

SELECT repair_orphan_invoice_payment_journals(
  NULL,           -- all businesses (NULL) or set business UUID
  200,            -- max rows to attempt
  'manual-repair' -- actor label in result JSON
);
