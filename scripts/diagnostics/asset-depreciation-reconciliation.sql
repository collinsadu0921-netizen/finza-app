-- Read-only asset depreciation reconciliation diagnostic
-- Staging project: adonhhtooawkeemdqqeo only
-- Run in Supabase SQL Editor or: psql "$STAGING_DATABASE_URL" -f scripts/diagnostics/asset-depreciation-reconciliation.sql
-- Does NOT modify data.

-- Optional: scope to one business
-- \set business_id '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'

-- 1) Incomplete entries (status posted/adjusted but no journal)
SELECT
  'incomplete_entry' AS issue_type,
  de.id AS depreciation_entry_id,
  de.asset_id,
  de.business_id,
  de.date,
  de.amount,
  de.status
FROM public.depreciation_entries de
WHERE de.deleted_at IS NULL
  AND de.journal_entry_id IS NULL
  AND de.status IN ('posted', 'adjusted')
ORDER BY de.business_id, de.asset_id, de.date;

-- 2) Register accumulated depreciation vs sum of valid posted entries
SELECT
  'register_accum_mismatch' AS issue_type,
  a.id AS asset_id,
  a.business_id,
  a.accumulated_depreciation AS register_accumulated_depreciation,
  COALESCE(SUM(de.amount), 0) AS entries_sum,
  ROUND(a.accumulated_depreciation - COALESCE(SUM(de.amount), 0), 2) AS difference
FROM public.assets a
LEFT JOIN public.depreciation_entries de
  ON de.asset_id = a.id
 AND de.deleted_at IS NULL
 AND de.status IN ('posted', 'adjusted')
WHERE a.deleted_at IS NULL
GROUP BY a.id, a.business_id, a.accumulated_depreciation
HAVING ABS(a.accumulated_depreciation - COALESCE(SUM(de.amount), 0)) > 0.01
ORDER BY a.business_id, a.id;

-- 3) Carrying value vs purchase - valid accumulated - salvage
SELECT
  'carrying_value_mismatch' AS issue_type,
  a.id AS asset_id,
  a.business_id,
  a.current_value AS register_current_value,
  GREATEST(
    COALESCE(a.salvage_value, 0),
    ROUND(a.purchase_amount - public.finza_asset_valid_posted_depreciation_total(a.id), 2)
  ) AS expected_current_value,
  ROUND(
    a.current_value - GREATEST(
      COALESCE(a.salvage_value, 0),
      ROUND(a.purchase_amount - public.finza_asset_valid_posted_depreciation_total(a.id), 2)
    ),
  2) AS difference
FROM public.assets a
WHERE a.deleted_at IS NULL
  AND ABS(
    a.current_value - GREATEST(
      COALESCE(a.salvage_value, 0),
      ROUND(a.purchase_amount - public.finza_asset_valid_posted_depreciation_total(a.id), 2)
    )
  ) > 0.01
ORDER BY a.business_id, a.id;

-- 4) Journal DR/CR vs entry amount
SELECT
  'journal_amount_mismatch' AS issue_type,
  de.id AS depreciation_entry_id,
  de.asset_id,
  de.business_id,
  de.amount AS entry_amount,
  de.journal_entry_id,
  COALESCE(SUM(jel.debit), 0) AS journal_debit,
  COALESCE(SUM(jel.credit), 0) AS journal_credit
FROM public.depreciation_entries de
JOIN public.journal_entry_lines jel ON jel.journal_entry_id = de.journal_entry_id
WHERE de.deleted_at IS NULL
  AND de.journal_entry_id IS NOT NULL
  AND de.status IN ('posted', 'adjusted')
GROUP BY de.id, de.asset_id, de.business_id, de.amount, de.journal_entry_id
HAVING ABS(de.amount - COALESCE(SUM(jel.debit), 0)) > 0.01
    OR ABS(de.amount - COALESCE(SUM(jel.credit), 0)) > 0.01
ORDER BY de.business_id, de.asset_id;

-- RPC wrapper (after migration 527):
-- SELECT public.finza_diagnose_asset_depreciation_reconciliation('4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid);
