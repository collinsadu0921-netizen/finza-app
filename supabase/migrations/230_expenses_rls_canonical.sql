-- ============================================================================
-- Expenses RLS: business members can insert/read/update/delete expenses.
-- Fixes 403 Unauthorized when no INSERT policy exists.
-- Matches invoice RLS model; does not touch ledger or immutability.
-- ============================================================================

-- 1. Enable RLS (idempotent)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies (legacy names and canonical names)
DROP POLICY IF EXISTS "Users can view expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can insert expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can update expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can delete expenses for their business" ON expenses;
DROP POLICY IF EXISTS "business members can insert expenses" ON expenses;
DROP POLICY IF EXISTS "business members can read expenses" ON expenses;
DROP POLICY IF EXISTS "business members can update expenses" ON expenses;
DROP POLICY IF EXISTS "business members can delete expenses" ON expenses;

-- 2. INSERT — WITH CHECK (no existing row on INSERT)
CREATE POLICY "business members can insert expenses"
ON expenses
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);

-- 3. SELECT — business members can read expenses
CREATE POLICY "business members can read expenses"
ON expenses
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);

-- 4. UPDATE — business members can update expenses
CREATE POLICY "business members can update expenses"
ON expenses
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);

-- 5. DELETE — business members can delete expenses
CREATE POLICY "business members can delete expenses"
ON expenses
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);
