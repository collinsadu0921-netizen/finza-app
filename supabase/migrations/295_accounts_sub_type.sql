-- ============================================================================
-- MIGRATION: Add sub_type to accounts for structured classification
-- ============================================================================
-- Supports structured filtering (e.g. bank/cash by sub_type) without relying
-- on name or code. No constraint or RLS changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Add column
-- ----------------------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS sub_type TEXT;

-- ----------------------------------------------------------------------------
-- STEP 2: Index for filtering by sub_type
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_accounts_sub_type
  ON accounts(sub_type);

-- ----------------------------------------------------------------------------
-- STEP 3: Backfill system accounts only (conservative code-based mapping)
-- ----------------------------------------------------------------------------
UPDATE accounts
SET sub_type = CASE
  WHEN type = 'asset'     AND code LIKE '10%' THEN 'bank'
  WHEN type = 'asset'     AND code LIKE '11%' THEN 'receivable'
  WHEN type = 'asset'     AND code LIKE '14%' THEN 'inventory'
  WHEN type = 'asset'     AND code LIKE '15%' THEN 'fixed_asset'
  WHEN type = 'liability' AND code LIKE '20%' THEN 'payable'
  WHEN type = 'liability' AND code LIKE '21%' THEN 'tax_payable'
  WHEN type = 'liability' AND code LIKE '23%' THEN 'loan'
  WHEN type = 'equity'    AND code LIKE '30%' THEN 'owner_capital'
  WHEN type = 'equity'    AND code LIKE '31%' THEN 'retained_earnings'
  WHEN type = 'income'    AND code LIKE '40%' THEN 'operating_revenue'
  WHEN type = 'income'    AND code LIKE '80%' THEN 'other_income'
  WHEN type = 'expense'   AND code LIKE '50%' THEN 'operating_expense'
  WHEN type = 'expense'   AND code LIKE '60%' THEN 'cost_of_goods_sold'
  ELSE NULL
END
WHERE is_system = true
  AND (sub_type IS NULL OR sub_type = '');

-- ----------------------------------------------------------------------------
-- STEP 4: Comment
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN accounts.sub_type IS
'Structured classification for filtering (e.g. bank, cash, receivable). Used with type for safe COA filtering without relying on name or code. NULL for unclassified accounts.';
