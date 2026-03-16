-- ============================================================================
-- FLASH SALE RACE CONDITION — DIAGNOSTIC SQL
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER the flash-sale-race Vitest test.
--
-- INSTRUCTIONS:
-- Replace the three UUIDs in the params CTE below with your test run values:
--   - business_id: from the test (create business step)
--   - product_id:  from the test (create product step)
--   - store_id:    from the test (create store step)
-- You can find the most recent test business: SELECT id, name FROM businesses
--   WHERE name LIKE 'Flash Sale Race Test%' ORDER BY created_at DESC LIMIT 1;
-- ============================================================================

WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS business_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS product_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS store_id
)

-- ============================================================================
-- 1) SALES COUNT (expect 5)
-- ============================================================================
SELECT
  COUNT(*) AS sales_count,
  'Expect 5' AS expected
FROM sales s
CROSS JOIN params p
WHERE s.business_id = p.business_id
  AND s.created_at > NOW() - INTERVAL '2 hours';

-- ============================================================================
-- 2) PARTIAL JOURNALS CHECK (expect 0 rows - no Sale without Ledger)
-- ============================================================================
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS business_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS product_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS store_id
)
SELECT
  s.id AS sale_id,
  s.amount,
  s.created_at,
  'PARTIAL: Sale has no journal entry' AS finding
FROM sales s
CROSS JOIN params p
LEFT JOIN journal_entries je
  ON je.reference_type = 'sale'
  AND je.reference_id = s.id
  AND je.business_id = s.business_id
WHERE je.id IS NULL
  AND s.business_id = p.business_id
  AND s.created_at > NOW() - INTERVAL '2 hours';
-- Success: 0 rows.

-- ============================================================================
-- 3) LEDGER: TRIAL BALANCE TOTAL = 0 (Debits = Credits)
-- ============================================================================
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS business_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS product_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS store_id
),
period AS (
  SELECT ap.id
  FROM accounting_periods ap
  CROSS JOIN params p
  WHERE ap.business_id = p.business_id
    AND ap.period_start <= CURRENT_DATE
    AND ap.period_end >= CURRENT_DATE
  LIMIT 1
),
tb AS (
  SELECT *
  FROM get_trial_balance_from_snapshot((SELECT id FROM period))
)
SELECT
  COALESCE(SUM(debit_total), 0)   AS total_debits,
  COALESCE(SUM(credit_total), 0)   AS total_credits,
  COALESCE(SUM(debit_total), 0) - COALESCE(SUM(credit_total), 0) AS difference
FROM tb;
-- Success: difference = 0 (or |difference| < 0.01).

-- ============================================================================
-- 4) STOCK CHECK: products_stock = 0 (never negative)
-- ============================================================================
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS business_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS product_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS store_id
)
SELECT
  ps.product_id,
  ps.store_id,
  COALESCE(ps.stock_quantity, ps.stock, 0) AS stock,
  'Expect 0' AS expected
FROM products_stock ps
CROSS JOIN params p
WHERE ps.product_id = p.product_id
  AND ps.store_id = p.store_id
  AND ps.variant_id IS NULL;
-- Success: stock = 0. Failure: stock < 0 (e.g. -5).

-- ============================================================================
-- 5) SUMMARY: Sales with their Journal Entries (integrity overview)
-- ============================================================================
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS business_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS product_id,
    '00000000-0000-0000-0000-000000000000'::uuid AS store_id
)
SELECT
  s.id AS sale_id,
  s.amount,
  s.created_at,
  je.id AS journal_entry_id
FROM sales s
CROSS JOIN params p
LEFT JOIN journal_entries je
  ON je.reference_type = 'sale'
  AND je.reference_id = s.id
  AND je.business_id = s.business_id
WHERE s.business_id = p.business_id
  AND s.created_at > NOW() - INTERVAL '2 hours'
ORDER BY s.created_at;
