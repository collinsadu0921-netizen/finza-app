-- ============================================================================
-- Audit: invoices posted under sent_at-first rule (pre-migration 492)
-- Read-only. Does not modify journal entries.
--
-- Finds invoice issuance JEs where journal month differs from issue_date month
-- and JE date matches sent_at date (legacy COALESCE(sent_at, issue_date) behavior).
-- ============================================================================

SELECT
  i.business_id,
  i.id AS invoice_id,
  i.invoice_number,
  i.issue_date,
  (i.sent_at AT TIME ZONE 'UTC')::date AS sent_at_date,
  i.created_at::date AS created_at_date,
  je.id AS journal_entry_id,
  je.date AS journal_date,
  to_char(i.issue_date, 'YYYY-MM') AS issue_month,
  to_char(je.date, 'YYYY-MM') AS journal_month,
  to_char((i.sent_at AT TIME ZONE 'UTC')::date, 'YYYY-MM') AS sent_month,
  je.created_at AS journal_created_at
FROM invoices i
JOIN journal_entries je
  ON je.business_id = i.business_id
 AND je.reference_type = 'invoice'
 AND je.reference_id = i.id
WHERE i.deleted_at IS NULL
  AND i.issue_date IS NOT NULL
  AND i.sent_at IS NOT NULL
  AND to_char(i.issue_date, 'YYYY-MM') IS DISTINCT FROM to_char(je.date, 'YYYY-MM')
  AND je.date = (i.sent_at AT TIME ZONE 'UTC')::date
ORDER BY i.business_id, i.issue_date DESC, i.invoice_number;
