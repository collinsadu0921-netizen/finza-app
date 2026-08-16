-- ============================================================================
-- Migration 568: Backfill semantic sub_type on Finza system funding accounts
-- ============================================================================
-- Existing tenants may have system 1000/1010/1020 with sub_type NULL while
-- Loans/Assets pickers require cash / bank / mobile_money semantics.
-- New tenants already receive correct sub_types via create_system_accounts (566).
-- Does NOT modify migrations 566 or 567.
-- Does NOT touch custom accounts, non-null subtypes, or non-asset rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1000 — Cash
-- ---------------------------------------------------------------------------
UPDATE public.accounts AS a
SET sub_type = 'cash',
    updated_at = NOW()
WHERE a.code = '1000'
  AND a.type = 'asset'
  AND a.is_system = TRUE
  AND a.deleted_at IS NULL
  AND a.sub_type IS NULL
  AND (
    a.name IN ('Cash', 'Cash on hand')
    OR a.name ILIKE 'cash'
    OR a.description ILIKE '%cash on hand%'
  );

-- ---------------------------------------------------------------------------
-- 1010 — Bank
-- ---------------------------------------------------------------------------
UPDATE public.accounts AS a
SET sub_type = 'bank',
    updated_at = NOW()
WHERE a.code = '1010'
  AND a.type = 'asset'
  AND a.is_system = TRUE
  AND a.deleted_at IS NULL
  AND a.sub_type IS NULL
  AND (
    a.name IN ('Bank', 'Bank Account')
    OR a.name ILIKE 'bank'
    OR a.description ILIKE '%bank account%'
  );

-- ---------------------------------------------------------------------------
-- 1020 — Mobile Money
-- ---------------------------------------------------------------------------
UPDATE public.accounts AS a
SET sub_type = 'mobile_money',
    updated_at = NOW()
WHERE a.code = '1020'
  AND a.type = 'asset'
  AND a.is_system = TRUE
  AND a.deleted_at IS NULL
  AND a.sub_type IS NULL
  AND (
    a.name IN ('Mobile Money', 'Mobile money')
    OR a.name ILIKE '%mobile%money%'
    OR a.name ILIKE '%momo%'
    OR a.description ILIKE '%mobile money%'
  );
