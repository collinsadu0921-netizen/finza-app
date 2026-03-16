-- ============================================================================
-- Financial Integrity Audit — Service workspace (read-only diagnostics)
-- Run in Supabase SQL Editor. DO NOT FIX — report only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ORPHANED DOCUMENTS: Invoices/expenses with status paid/sent but NO journal_entry
-- ----------------------------------------------------------------------------
-- 1a. Invoices: status IN ('sent','paid','partially_paid') with no JE
SELECT '1a_orphan_invoices' AS diagnostic, id, business_id, invoice_number, status, sent_at, total
FROM invoices i
WHERE i.status IN ('sent', 'paid', 'partially_paid')
  AND i.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.reference_type = 'invoice' AND je.reference_id = i.id
  )
ORDER BY i.created_at DESC;

-- 1b. Expenses: no status filter (expenses post on INSERT); find any expense with no JE
SELECT '1b_orphan_expenses' AS diagnostic, id, business_id, amount, total, date, created_at
FROM expenses e
WHERE e.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.reference_type = 'expense' AND je.reference_id = e.id
  )
ORDER BY e.created_at DESC;

-- ----------------------------------------------------------------------------
-- 2. UNBALANCED JOURNALS: journal_entry_id where SUM(debit) != SUM(credit)
-- ----------------------------------------------------------------------------
SELECT '2_unbalanced_journals' AS diagnostic, jel.journal_entry_id,
  SUM(jel.debit) AS total_debit,
  SUM(jel.credit) AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS imbalance
FROM journal_entry_lines jel
GROUP BY jel.journal_entry_id
HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) > 0.001
ORDER BY jel.journal_entry_id;

-- ----------------------------------------------------------------------------
-- Counts summary (for quick health check)
-- ----------------------------------------------------------------------------
SELECT 'summary_orphan_invoice_count' AS metric, COUNT(*) AS value
FROM invoices i
WHERE i.status IN ('sent', 'paid', 'partially_paid')
  AND i.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.reference_type = 'invoice' AND je.reference_id = i.id)
UNION ALL
SELECT 'summary_orphan_expense_count', COUNT(*)
FROM expenses e
WHERE e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.reference_type = 'expense' AND je.reference_id = e.id)
UNION ALL
SELECT 'summary_unbalanced_je_count', COUNT(*)
FROM (
  SELECT jel.journal_entry_id
  FROM journal_entry_lines jel
  GROUP BY jel.journal_entry_id
  HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) > 0.001
) u;
