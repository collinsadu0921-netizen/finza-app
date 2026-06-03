-- ============================================================================
-- Payment ↔ Journal integrity diagnostics (read-only)
-- Run in Supabase SQL Editor. Does not modify data.
-- ============================================================================

-- Recent payments with journal linkage
SELECT
  p.id AS payment_id,
  p.business_id,
  p.invoice_id,
  p.amount,
  p.date AS payment_date,
  p.method,
  p.created_at,
  i.status AS invoice_status,
  je.id AS journal_entry_id,
  je.date AS journal_date,
  je.created_at AS journal_created_at,
  CASE
    WHEN je.id IS NULL THEN 'MISSING_JOURNAL'
    ELSE 'OK'
  END AS integrity_status
FROM payments p
LEFT JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN journal_entries je
  ON je.business_id = p.business_id
 AND je.reference_type = 'payment'
 AND je.reference_id = p.id
WHERE p.deleted_at IS NULL
ORDER BY p.created_at DESC
LIMIT 25;

-- Orphan payments (no payment journal)
SELECT
  'orphan_payment' AS diagnostic,
  p.id AS payment_id,
  p.business_id,
  p.invoice_id,
  p.amount,
  p.date,
  p.method,
  p.created_at,
  i.status AS invoice_status
FROM payments p
LEFT JOIN invoices i ON i.id = p.invoice_id
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.business_id = p.business_id
      AND je.reference_type = 'payment'
      AND je.reference_id = p.id
  )
ORDER BY p.created_at DESC;

-- Summary counts
SELECT
  'summary_orphan_payment_count' AS metric,
  COUNT(*)::TEXT AS value
FROM payments p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.business_id = p.business_id
      AND je.reference_type = 'payment'
      AND je.reference_id = p.id
  );

-- Period open check for a specific payment date (replace UUID/date as needed)
-- SELECT ap.id, ap.period_start, ap.period_end, ap.status
-- FROM accounting_periods ap
-- WHERE ap.business_id = '<business_id>'
--   AND '<payment_date>'::date BETWEEN ap.period_start AND ap.period_end;
