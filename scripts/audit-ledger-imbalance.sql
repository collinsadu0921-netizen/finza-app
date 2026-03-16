-- ============================================================================
-- LEDGER IMBALANCE AUDIT (READ-ONLY)
-- ============================================================================
-- Use: Run against Supabase SQL Editor. No INSERT/UPDATE/DELETE.
-- Purpose: Find journal_entry_ids where sum(debit) != sum(credit), then
--          classify by legacy / tax_lines missing / interrupted / manual.
-- ============================================================================

WITH
imbalanced AS (
  SELECT
    je.id AS journal_entry_id,
    je.business_id,
    je.date,
    je.description,
    je.reference_type,
    je.reference_id,
    je.created_at,
    COALESCE(SUM(jel.debit), 0) AS total_debit,
    COALESCE(SUM(jel.credit), 0) AS total_credit,
    ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) AS imbalance_amount,
    COUNT(jel.id) AS line_count
  FROM journal_entries je
  LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  GROUP BY je.id, je.business_id, je.date, je.description, je.reference_type, je.reference_id, je.created_at
  HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) > 0.01
),
-- Link to invoices (reference_type = 'invoice')
inv AS (
  SELECT
    i.id AS invoice_id,
    i.created_at AS invoice_created_at,
    i.status AS invoice_status,
    i.tax_lines,
    i.total_tax,
    i.apply_taxes
  FROM invoices i
),
-- Link to payments (reference_type = 'payment')
pmt AS (
  SELECT
    p.id AS payment_id,
    p.created_at AS payment_created_at,
    p.amount
  FROM payments p
),
-- Heuristics for classification
classified AS (
  SELECT
    imb.journal_entry_id,
    imb.business_id,
    imb.date,
    imb.description,
    imb.reference_type,
    imb.reference_id,
    imb.created_at,
    imb.total_debit,
    imb.total_credit,
    imb.imbalance_amount,
    imb.line_count,
    inv.invoice_id,
    inv.invoice_created_at,
    inv.invoice_status,
    inv.tax_lines,
    inv.total_tax,
    inv.apply_taxes,
    pmt.payment_id,
    pmt.payment_created_at,
    -- Flags
    CASE WHEN imb.reference_type IN ('manual', 'adjustment') THEN 1 ELSE 0 END AS is_manual,
    CASE WHEN imb.line_count = 1 THEN 1 ELSE 0 END AS is_single_line,
    CASE WHEN imb.created_at < '2024-01-01'::timestamptz THEN 1 ELSE 0 END AS is_legacy_date,
    CASE
      WHEN imb.reference_type = 'invoice' AND inv.invoice_id IS NOT NULL
        AND (
          inv.tax_lines IS NULL
          OR (jsonb_typeof(inv.tax_lines) = 'object' AND (
            NOT (inv.tax_lines ? 'tax_lines')
            OR (jsonb_typeof(inv.tax_lines->'tax_lines') = 'array' AND jsonb_array_length(inv.tax_lines->'tax_lines') = 0)
          ))
          OR (jsonb_typeof(inv.tax_lines) = 'array' AND jsonb_array_length(inv.tax_lines) = 0)
        )
        AND (COALESCE(inv.total_tax, 0) > 0 OR COALESCE(inv.apply_taxes, false))
      THEN 1
      ELSE 0
    END AS is_invoice_tax_lines_missing
  FROM imbalanced imb
  LEFT JOIN inv ON imb.reference_type = 'invoice' AND inv.invoice_id = imb.reference_id
  LEFT JOIN pmt ON imb.reference_type = 'payment' AND pmt.payment_id = imb.reference_id
)
SELECT
  journal_entry_id,
  reference_type,
  reference_id,
  created_at,
  business_id,
  date,
  description,
  ROUND(total_debit::numeric, 2) AS total_debit,
  ROUND(total_credit::numeric, 2) AS total_credit,
  ROUND(imbalance_amount::numeric, 2) AS imbalance_amount,
  line_count,
  CASE
    WHEN is_single_line = 1 THEN 'interrupted posting'
    WHEN is_invoice_tax_lines_missing = 1 THEN 'tax_lines missing'
    WHEN is_legacy_date = 1 THEN 'legacy data'
    WHEN is_manual = 1 THEN 'manual entry'
    ELSE 'unknown'
  END AS root_cause_category
FROM classified
ORDER BY created_at ASC, journal_entry_id;

-- ============================================================================
-- OPTIONAL: Summary by root_cause_category (run separately)
-- ============================================================================
/*
WITH
imbalanced AS (
  SELECT je.id, je.reference_type, je.reference_id, je.created_at,
    COALESCE(SUM(jel.debit), 0) AS td, COALESCE(SUM(jel.credit), 0) AS tc,
    COUNT(jel.id) AS line_count
  FROM journal_entries je
  LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  GROUP BY je.id, je.reference_type, je.reference_id, je.created_at
  HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) > 0.01
),
inv AS ( SELECT id AS invoice_id, tax_lines, total_tax, apply_taxes FROM invoices ),
pmt AS ( SELECT id AS payment_id FROM payments ),
classified AS (
  SELECT imb.*,
    CASE WHEN imb.reference_type IN ('manual', 'adjustment') THEN 1 ELSE 0 END AS is_manual,
    CASE WHEN imb.line_count = 1 THEN 1 ELSE 0 END AS is_single_line,
    CASE WHEN imb.created_at < '2024-01-01'::timestamptz THEN 1 ELSE 0 END AS is_legacy_date,
    CASE WHEN imb.reference_type = 'invoice' AND inv.invoice_id IS NOT NULL
      AND (inv.tax_lines IS NULL OR (jsonb_typeof(inv.tax_lines) = 'object' AND (NOT (inv.tax_lines ? 'tax_lines')
        OR (jsonb_typeof(inv.tax_lines->'tax_lines') = 'array' AND jsonb_array_length(inv.tax_lines->'tax_lines') = 0)))
        OR (jsonb_typeof(inv.tax_lines) = 'array' AND jsonb_array_length(inv.tax_lines) = 0))
      AND (COALESCE(inv.total_tax, 0) > 0 OR COALESCE(inv.apply_taxes, false))
    THEN 1 ELSE 0 END AS is_invoice_tax_lines_missing
  FROM imbalanced imb
  LEFT JOIN inv ON imb.reference_type = 'invoice' AND inv.invoice_id = imb.reference_id
  LEFT JOIN pmt ON imb.reference_type = 'payment' AND pmt.payment_id = imb.reference_id
)
SELECT
  CASE WHEN is_single_line = 1 THEN 'interrupted posting'
       WHEN is_invoice_tax_lines_missing = 1 THEN 'tax_lines missing'
       WHEN is_legacy_date = 1 THEN 'legacy data'
       WHEN is_manual = 1 THEN 'manual entry'
       ELSE 'unknown' END AS root_cause_category,
  COUNT(*) AS entry_count,
  ROUND(SUM(ABS(td - tc))::numeric, 2) AS total_imbalance_amount
FROM classified
GROUP BY 1
ORDER BY 2 DESC;
*/
