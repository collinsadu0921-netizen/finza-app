-- ============================================================================
-- FINZA FORENSIC ACCOUNTING VERIFICATION
-- READ ONLY — DO NOT MODIFY DATABASE OR CODE
-- Run in Supabase SQL Editor. Results are per-business where applicable.
-- ============================================================================

-- ============================================================================
-- SECTION 1 — DOCUMENT IDENTITY INTEGRITY
-- ============================================================================

-- 1.1 Duplicate Invoice Numbers (per business)
SELECT '1.1_duplicate_invoice_numbers' AS check_id, business_id, invoice_number, COUNT(*) AS cnt,
  array_agg(id ORDER BY created_at) AS invoice_ids
FROM invoices
WHERE deleted_at IS NULL
GROUP BY business_id, invoice_number
HAVING COUNT(*) > 1;

-- 1.2 Payment → Invoice Link Validation (orphan payments)
SELECT '1.2_orphan_payments' AS check_id, p.id AS payment_id, p.invoice_id, p.business_id
FROM payments p
LEFT JOIN invoices i ON i.id = p.invoice_id
WHERE i.id IS NULL;

-- 1.3 Paid Invoice Payment Equality (mismatches: sum(payments) <> invoice.total)
SELECT '1.3_paid_invoice_payment_mismatch' AS check_id, i.business_id, i.id AS invoice_id,
  i.total AS invoice_total, COALESCE(SUM(p.amount), 0) AS payments_total,
  (i.total - COALESCE(SUM(p.amount), 0)) AS discrepancy
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
WHERE i.status = 'paid' AND i.deleted_at IS NULL
GROUP BY i.id, i.business_id, i.total
HAVING COALESCE(SUM(p.amount), 0) <> i.total;

-- ============================================================================
-- SECTION 2 — LEDGER POSTING COMPLETENESS
-- ============================================================================

-- 2.1 Invoices with no ledger posting (invoice JE)
SELECT '2.1_invoice_missing_ledger' AS check_id, i.business_id, i.id AS invoice_id
FROM invoices i
LEFT JOIN journal_entries je ON je.reference_id = i.id AND je.reference_type = 'invoice'
WHERE je.id IS NULL AND i.deleted_at IS NULL;

-- 2.2 Payments with no ledger posting (payment JE)
SELECT '2.2_payment_missing_ledger' AS check_id, p.business_id, p.id AS payment_id
FROM payments p
LEFT JOIN journal_entries je ON je.reference_id = p.id AND je.reference_type = 'payment'
WHERE je.id IS NULL;

-- 2.3 Journal entries where SUM(debit) <> SUM(credit)
SELECT '2.3_je_imbalanced' AS check_id, je.business_id, jel.journal_entry_id,
  SUM(jel.debit) AS total_debit, SUM(jel.credit) AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS difference
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
GROUP BY je.business_id, jel.journal_entry_id
HAVING SUM(jel.debit) <> SUM(jel.credit);

-- ============================================================================
-- SECTION 3 — ACCOUNT INTEGRITY (DEDUP SIDE EFFECT DETECTION)
-- ============================================================================

-- 3.1 Ledger lines referencing missing accounts (orphan account_id)
SELECT '3.1_orphan_ledger_lines' AS check_id, COUNT(*) AS orphan_lines
FROM journal_entry_lines jel
LEFT JOIN accounts a ON a.id = jel.account_id
WHERE a.id IS NULL;

-- 3.2 Ledger lines referencing deleted accounts
SELECT '3.2_ledger_lines_deleted_account' AS check_id, jel.account_id, a.code, a.deleted_at
FROM journal_entry_lines jel
JOIN accounts a ON a.id = jel.account_id
WHERE a.deleted_at IS NOT NULL;

-- ============================================================================
-- SECTION 4 — SNAPSHOT COVERAGE VALIDATION
-- ============================================================================

-- 4.1 Ledger monthly totals (per business)
SELECT '4.1_ledger_monthly' AS check_id, je.business_id,
  DATE_TRUNC('month', je.date)::date AS period_month,
  SUM(jel.debit) AS total_debit, SUM(jel.credit) AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS net
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
GROUP BY je.business_id, DATE_TRUNC('month', je.date)
ORDER BY je.business_id, period_month;

-- 4.2 Snapshot monthly totals (per business via period)
SELECT '4.2_snapshot_monthly' AS check_id, ap.business_id, tbs.period_id,
  ap.period_start, ap.period_end,
  SUM((line->>'debit_total')::numeric) AS total_debit,
  SUM((line->>'credit_total')::numeric) AS total_credit
FROM trial_balance_snapshots tbs
JOIN accounting_periods ap ON ap.id = tbs.period_id
, LATERAL jsonb_array_elements(tbs.snapshot_data) AS line
GROUP BY ap.business_id, tbs.period_id, ap.period_start, ap.period_end
ORDER BY ap.business_id, ap.period_start;

-- ============================================================================
-- SECTION 5 — CONTROL ACCOUNT RECONCILIATION
-- ============================================================================

-- 5.1 AR (1100): Ledger balance vs sum of unpaid invoice balances (per business)
WITH ar_ledger AS (
  SELECT je.business_id,
    SUM(jel.debit) - SUM(jel.credit) AS ledger_balance
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id AND a.business_id = je.business_id
  WHERE a.code = '1100' AND a.deleted_at IS NULL
  GROUP BY je.business_id
),
ar_invoices AS (
  SELECT i.business_id,
    SUM(i.total - COALESCE(p.paid, 0)) AS unpaid_total
  FROM invoices i
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id
  ) p ON p.invoice_id = i.id
  WHERE i.status NOT IN ('paid', 'cancelled') AND i.deleted_at IS NULL
  GROUP BY i.business_id
)
SELECT '5.1_ar_recon' AS check_id, COALESCE(l.business_id, inv.business_id) AS business_id,
  l.ledger_balance, inv.unpaid_total,
  COALESCE(l.ledger_balance, 0) - COALESCE(inv.unpaid_total, 0) AS discrepancy
FROM ar_ledger l
FULL OUTER JOIN ar_invoices inv ON inv.business_id = l.business_id
WHERE COALESCE(l.ledger_balance, 0) <> COALESCE(inv.unpaid_total, 0);

-- 5.2 Cash (1000): Ledger balance vs (payments - expenses) simplified (per business)
WITH cash_ledger AS (
  SELECT je.business_id, SUM(jel.debit) - SUM(jel.credit) AS ledger_cash
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id AND a.business_id = je.business_id
  WHERE a.code = '1000' AND a.deleted_at IS NULL
  GROUP BY je.business_id
),
pay_tot AS (SELECT business_id, SUM(amount) AS total_payments FROM payments GROUP BY business_id),
exp_tot AS (SELECT business_id, SUM(total) AS total_expenses FROM expenses WHERE deleted_at IS NULL GROUP BY business_id),
cash_ops AS (
  SELECT COALESCE(p.business_id, e.business_id) AS business_id,
    COALESCE(p.total_payments, 0) - COALESCE(e.total_expenses, 0) AS net_cash_ops
  FROM pay_tot p
  FULL OUTER JOIN exp_tot e ON e.business_id = p.business_id
)
SELECT '5.2_cash_recon' AS check_id, COALESCE(cl.business_id, co.business_id) AS business_id,
  cl.ledger_cash, co.net_cash_ops,
  COALESCE(cl.ledger_cash, 0) - COALESCE(co.net_cash_ops, 0) AS discrepancy
FROM cash_ledger cl
FULL OUTER JOIN cash_ops co ON co.business_id = cl.business_id
WHERE COALESCE(cl.ledger_cash, 0) <> COALESCE(co.net_cash_ops, 0);

-- 5.3 VAT (2100): Ledger balance (per business, as of latest date in data)
WITH vat_ledger AS (
  SELECT je.business_id,
    SUM(jel.credit) - SUM(jel.debit) AS vat_balance_ledger
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id AND a.business_id = je.business_id
  WHERE a.code = '2100' AND a.deleted_at IS NULL
  GROUP BY je.business_id
)
SELECT '5.3_vat_ledger' AS check_id, business_id, vat_balance_ledger
FROM vat_ledger;

-- ============================================================================
-- SECTION 6 — PERIOD CUT-OFF VALIDATION
-- ============================================================================

-- 6.1 Invoice: issue_date, sent_at vs journal_entries.date (expect COALESCE(sent_at::date, issue_date))
SELECT '6.1_invoice_je_date_mismatch' AS check_id, i.business_id, i.id AS invoice_id,
  i.issue_date, i.sent_at,
  (COALESCE((i.sent_at AT TIME ZONE 'UTC')::date, i.issue_date)) AS expected_je_date,
  je.date AS actual_je_date
FROM invoices i
JOIN journal_entries je ON je.reference_id = i.id AND je.reference_type = 'invoice'
WHERE je.date IS DISTINCT FROM (COALESCE((i.sent_at AT TIME ZONE 'UTC')::date, i.issue_date))
  AND i.deleted_at IS NULL;

-- 6.2 Payment: payment.date vs journal_entries.date
SELECT '6.2_payment_je_date_mismatch' AS check_id, p.business_id, p.id AS payment_id,
  p.date AS payment_date, je.date AS je_date
FROM payments p
JOIN journal_entries je ON je.reference_id = p.id AND je.reference_type = 'payment'
WHERE je.date IS DISTINCT FROM p.date;

-- ============================================================================
-- SECTION 7 — VAT SOURCE CONSISTENCY
-- ============================================================================

-- 7.1 VAT Ledger totals by business and month (account 2100)
SELECT '7.1_vat_ledger_monthly' AS check_id, je.business_id,
  DATE_TRUNC('month', je.date)::date AS period_month,
  SUM(jel.credit) AS output_vat_credits, SUM(jel.debit) AS input_vat_debits
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id
JOIN accounts a ON a.id = jel.account_id AND a.business_id = je.business_id
WHERE a.code = '2100' AND a.deleted_at IS NULL
GROUP BY je.business_id, DATE_TRUNC('month', je.date)
ORDER BY je.business_id, period_month;

-- 7.2 VAT from operational tables by business and month (invoices + expenses + bills)
SELECT '7.2_vat_returns_monthly' AS check_id, business_id, period_month,
  SUM(output_vat) AS output_vat, SUM(input_vat) AS input_vat,
  SUM(output_vat) - SUM(input_vat) AS net_vat
FROM (
  SELECT business_id, DATE_TRUNC('month', issue_date)::date AS period_month,
    SUM(COALESCE(vat, 0)) AS output_vat, 0::numeric AS input_vat
  FROM invoices WHERE deleted_at IS NULL AND status = 'paid'
  GROUP BY business_id, DATE_TRUNC('month', issue_date)
  UNION ALL
  SELECT business_id, DATE_TRUNC('month', date)::date, 0::numeric, SUM(COALESCE(vat, 0))
  FROM expenses WHERE deleted_at IS NULL GROUP BY business_id, DATE_TRUNC('month', date)
  UNION ALL
  SELECT business_id, DATE_TRUNC('month', issue_date)::date, 0::numeric, SUM(COALESCE(vat, 0))
  FROM bills WHERE deleted_at IS NULL GROUP BY business_id, DATE_TRUNC('month', issue_date)
) u
GROUP BY business_id, period_month
ORDER BY business_id, period_month;

-- ============================================================================
-- SECTION 8 — SYSTEM ACCOUNTING INVARIANT (per business, latest snapshot)
-- ============================================================================

-- 8.1 Latest snapshot per business: is_balanced (debits = credits)
SELECT '8.1_snapshot_balanced' AS check_id, ap.business_id, tbs.period_id,
  ap.period_start, ap.period_end, tbs.is_balanced, tbs.balance_difference,
  tbs.total_debits, tbs.total_credits
FROM trial_balance_snapshots tbs
JOIN accounting_periods ap ON ap.id = tbs.period_id
WHERE (ap.business_id, ap.period_start) IN (
  SELECT business_id, MAX(period_start) FROM accounting_periods GROUP BY business_id
)
ORDER BY ap.business_id;

-- 8.2 Assets = Liabilities + Equity from snapshot_data (latest snapshot per business)
WITH latest_snapshot AS (
  SELECT tbs.period_id, tbs.snapshot_data, ap.business_id
  FROM trial_balance_snapshots tbs
  JOIN accounting_periods ap ON ap.id = tbs.period_id
  WHERE (ap.business_id, ap.period_start) IN (
    SELECT business_id, MAX(period_start) FROM accounting_periods GROUP BY business_id
  )
),
by_type AS (
  SELECT business_id, line->>'account_type' AS account_type,
    SUM((line->>'closing_balance')::numeric) AS total
  FROM latest_snapshot ls, LATERAL jsonb_array_elements(ls.snapshot_data) AS line
  GROUP BY business_id, line->>'account_type'
),
totals AS (
  SELECT business_id,
    COALESCE(MAX(CASE WHEN account_type = 'asset' THEN total END), 0) AS assets,
    COALESCE(MAX(CASE WHEN account_type = 'liability' THEN total END), 0) AS liabilities,
    COALESCE(MAX(CASE WHEN account_type = 'equity' THEN total END), 0) AS equity
  FROM by_type
  GROUP BY business_id
)
SELECT '8.2_assets_liab_equity' AS check_id, business_id, assets, liabilities, equity,
  (liabilities + equity) AS liab_plus_equity, assets - (liabilities + equity) AS discrepancy
FROM totals
WHERE ABS(assets - (liabilities + equity)) > 0.01;
