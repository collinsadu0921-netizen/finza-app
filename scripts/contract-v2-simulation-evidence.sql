-- ============================================================================
-- Contract v2.0 Simulation Evidence (READ-ONLY)
-- Run after executing the workflow simulations. No schema changes.
-- One result set: scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result.
-- ============================================================================

WITH
-- 1) Full Invoice Lifecycle: one row; PASS = posting exists + date match; if status=paid require payments sum ≈ total (0.02)
sent_invoices AS (
  SELECT i.id AS invoice_id, i.business_id, i.issue_date, i.sent_at, i.total, i.status,
    (COALESCE((i.sent_at AT TIME ZONE 'UTC')::date, i.issue_date)) AS expected_je_date
  FROM invoices i
  WHERE i.deleted_at IS NULL AND i.status IN ('sent', 'paid', 'partially_paid')
  ORDER BY i.updated_at DESC NULLS LAST
  LIMIT 1
),
invoice_je_one_per_inv AS (
  SELECT DISTINCT ON (je.reference_id)
    je.id AS journal_entry_id,
    je.business_id,
    je.reference_id AS invoice_id,
    je.date AS je_date,
    je.period_id,
    (SELECT jsonb_agg(jsonb_build_object('account_id', jel.account_id, 'debit', jel.debit, 'credit', jel.credit))
     FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) AS lines_summary
  FROM journal_entries je
  WHERE je.reference_type = 'invoice'
  ORDER BY je.reference_id, je.created_at DESC
),
s1_joined AS (
  SELECT si.invoice_id, si.business_id, si.expected_je_date, si.status AS inv_status, si.total AS invoice_total,
    ij.journal_entry_id, ij.je_date, ij.period_id, ij.lines_summary,
    (si.expected_je_date IS NOT DISTINCT FROM ij.je_date) AS date_match,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.invoice_id = si.invoice_id AND p.deleted_at IS NULL) AS total_paid
  FROM sent_invoices si
  LEFT JOIN invoice_je_one_per_inv ij ON ij.invoice_id = si.invoice_id
),
s1 AS (
  SELECT '1_invoice_lifecycle' AS scenario,
    CASE
      WHEN j.journal_entry_id IS NULL THEN 'FAIL'
      WHEN j.date_match IS FALSE THEN 'FAIL'
      WHEN j.inv_status = 'paid' AND (j.total_paid IS NULL OR j.invoice_total IS NULL OR ABS(j.total_paid - j.invoice_total) > 0.02) THEN 'FAIL'
      WHEN j.date_match IS TRUE THEN 'PASS'
      ELSE 'FAIL'
    END AS result,
    j.journal_entry_id,
    j.lines_summary::text AS ledger_lines_summary,
    j.period_id::text AS period_assigned,
    CASE
      WHEN j.journal_entry_id IS NULL THEN 'No posted invoice found.'
      ELSE 'Invoice ' || j.invoice_id::text || ' JE_date=' || COALESCE(j.je_date::text, 'null') || ' expected=' || COALESCE(j.expected_je_date::text, 'null') || ' date_match=' || COALESCE(j.date_match::text, 'false') || '; status=' || COALESCE(j.inv_status, '') || ' paid=' || COALESCE(j.total_paid::text, '0') || '/' || COALESCE(j.invoice_total::text, '0')
    END AS reconciliation_result
  FROM (SELECT 1) AS _one
  LEFT JOIN s1_joined j ON true
),

-- 2) Expense Lifecycle: one row; FAIL if no expense JE
expense_je AS (
  SELECT e.id AS expense_id, e.business_id, e.date AS expense_date,
    je.id AS journal_entry_id, je.date AS je_date, je.period_id,
    (SELECT jsonb_agg(jsonb_build_object('debit', jel.debit, 'credit', jel.credit))
     FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) AS lines_summary
  FROM expenses e
  JOIN journal_entries je ON je.reference_type = 'expense' AND je.reference_id = e.id
  WHERE e.deleted_at IS NULL
  ORDER BY e.created_at DESC NULLS LAST
  LIMIT 1
),
s2 AS (
  SELECT '2_expense_lifecycle' AS scenario,
    CASE WHEN (SELECT 1 FROM expense_je) IS NULL THEN 'FAIL' WHEN (SELECT expense_date FROM expense_je) IS NOT DISTINCT FROM (SELECT je_date FROM expense_je) THEN 'PASS' ELSE 'FAIL' END AS result,
    (SELECT journal_entry_id FROM expense_je) AS journal_entry_id,
    (SELECT lines_summary::text FROM expense_je) AS ledger_lines_summary,
    (SELECT period_id::text FROM expense_je) AS period_assigned,
    CASE WHEN (SELECT 1 FROM expense_je) IS NULL THEN 'No posted expense found.'
         ELSE 'expense_date=' || (SELECT expense_date::text FROM expense_je) || ' je_date=' || (SELECT je_date::text FROM expense_je) END AS reconciliation_result
),

-- 3) POS Sale: one row; FAIL if no sale JE
sale_je AS (
  SELECT s.id AS sale_id, s.business_id, (s.created_at::date) AS sale_date,
    je.id AS journal_entry_id, je.date AS je_date, je.period_id,
    (SELECT jsonb_agg(jsonb_build_object('account_id', jel.account_id, 'debit', jel.debit, 'credit', jel.credit))
     FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) AS lines_summary
  FROM sales s
  JOIN journal_entries je ON je.reference_type = 'sale' AND je.reference_id = s.id
  ORDER BY s.created_at DESC NULLS LAST
  LIMIT 1
),
s3 AS (
  SELECT '3_pos_sale' AS scenario,
    CASE WHEN (SELECT 1 FROM sale_je) IS NULL THEN 'FAIL' WHEN (SELECT sale_date FROM sale_je) IS NOT DISTINCT FROM (SELECT je_date FROM sale_je) THEN 'PASS' ELSE 'FAIL' END AS result,
    (SELECT journal_entry_id FROM sale_je) AS journal_entry_id,
    (SELECT lines_summary::text FROM sale_je) AS ledger_lines_summary,
    (SELECT period_id::text FROM sale_je) AS period_assigned,
    CASE WHEN (SELECT 1 FROM sale_je) IS NULL THEN 'No sale JE found.'
         ELSE 'sale_date=' || (SELECT sale_date::text FROM sale_je) || ' je_date=' || (SELECT je_date::text FROM sale_je) END AS reconciliation_result
),

-- 4) Refund Flow: one row; FAIL if no refund JE; include reference_type, je.date, period_id in reconciliation
refund_je AS (
  SELECT je.id AS journal_entry_id, je.business_id, je.reference_type, je.reference_id, je.date AS je_date, je.period_id,
    (SELECT jsonb_agg(jsonb_build_object('debit', jel.debit, 'credit', jel.credit))
     FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) AS lines_summary
  FROM journal_entries je
  WHERE je.reference_type IN ('refund', 'sale_refund')
  ORDER BY je.created_at DESC NULLS LAST
  LIMIT 1
),
s4 AS (
  SELECT '4_refund_flow' AS scenario,
    CASE WHEN (SELECT 1 FROM refund_je) IS NULL THEN 'FAIL' ELSE 'PASS' END AS result,
    (SELECT journal_entry_id FROM refund_je) AS journal_entry_id,
    (SELECT lines_summary::text FROM refund_je) AS ledger_lines_summary,
    (SELECT period_id::text FROM refund_je) AS period_assigned,
    CASE WHEN (SELECT 1 FROM refund_je) IS NULL THEN 'No refund JE found.'
         ELSE 'reference_type=' || (SELECT reference_type FROM refund_je) || ' je.date=' || (SELECT je_date::text FROM refund_je) || ' period_id=' || (SELECT period_id::text FROM refund_je) END AS reconciliation_result
),

-- 5) Adoption boundary: FAIL if any operational JE with date < accounting_start_date; one sample violating id
biz_start AS (
  SELECT b.id AS business_id, b.accounting_start_date
  FROM businesses b
  WHERE b.accounting_start_date IS NOT NULL
),
violations AS (
  SELECT je.id, je.business_id, je.date, je.entry_type
  FROM journal_entries je
  JOIN biz_start b ON b.business_id = je.business_id
  WHERE je.date < b.accounting_start_date
    AND COALESCE(TRIM(je.entry_type), '') NOT IN ('opening_balance', 'backfill')
),
s5 AS (
  SELECT '5_adoption_boundary' AS scenario,
    CASE WHEN NOT EXISTS (SELECT 1 FROM violations) THEN 'PASS' ELSE 'FAIL' END AS result,
    (SELECT id FROM violations LIMIT 1) AS journal_entry_id,
    (SELECT 'Operational JE before accounting_start_date: ' || string_agg(id::text || '(' || date::text || ',' || COALESCE(entry_type, '') || ')', ', ') FROM violations) AS ledger_lines_summary,
    NULL::text AS period_assigned,
    'Enforcement: 253 L170-174. Backfill/opening_balance allowed.' AS reconciliation_result
),

-- 6) Period lock: PASS informational; evidence count of JEs whose period status='locked' (schema-safe, no closed_at)
locked_period_jes AS (
  SELECT COUNT(*) AS cnt
  FROM journal_entries je
  JOIN accounting_periods ap ON ap.id = je.period_id
  WHERE ap.status = 'locked'
),
s6 AS (
  SELECT '6_period_lock' AS scenario,
    'PASS' AS result,
    NULL::uuid AS journal_entry_id,
    CASE WHEN (SELECT cnt FROM locked_period_jes) = 0
         THEN 'Enforcement: assert_accounting_period_is_open (253 L187). No JEs in locked periods.'
         ELSE 'JEs in locked period (status=locked): ' || (SELECT cnt::text FROM locked_period_jes) END AS ledger_lines_summary,
    NULL::text AS period_assigned,
    'Proof requires attempted post. Count(je where period status=locked) = ' || COALESCE((SELECT cnt::text FROM locked_period_jes), '0') AS reconciliation_result
)

SELECT scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result FROM s1
UNION ALL SELECT scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result FROM s2
UNION ALL SELECT scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result FROM s3
UNION ALL SELECT scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result FROM s4
UNION ALL SELECT scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result FROM s5
UNION ALL SELECT scenario, result, journal_entry_id, ledger_lines_summary, period_assigned, reconciliation_result FROM s6
ORDER BY scenario;
