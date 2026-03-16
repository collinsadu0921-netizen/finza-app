-- ============================================================================
-- MIGRATION: Manual Journal Drafts — Owner-Mode (No Firm Required)
-- ============================================================================
-- DATABASE ONLY. No API, RPC, or UI changes.
--
-- 1) Make accounting_firm_id nullable so drafts can exist without a firm.
-- 2) Add owner-mode RLS policies (owner only; firm policies unchanged).
-- 3) Ensure RLS remains enabled.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: SCHEMA — Make accounting_firm_id nullable
-- ----------------------------------------------------------------------------
-- Keep FK; only remove NOT NULL.
ALTER TABLE manual_journal_drafts
  ALTER COLUMN accounting_firm_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- STEP 2: Ensure RLS is enabled
-- ----------------------------------------------------------------------------
ALTER TABLE manual_journal_drafts ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- STEP 3: Owner-Mode RLS Policies (ADD ONLY — existing firm policies unchanged)
-- ----------------------------------------------------------------------------
-- Owner-mode: accounting_firm_id IS NULL.
-- Owner authority: businesses.owner_id = auth.uid() for client_business_id.
-- No DELETE policy for owner-mode. No business_users roles; owner only.
-- ----------------------------------------------------------------------------

-- A) Owner-mode SELECT
CREATE POLICY "Owner can view own business manual journal drafts"
  ON manual_journal_drafts FOR SELECT
  USING (
    manual_journal_drafts.accounting_firm_id IS NULL
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = manual_journal_drafts.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- B) Owner-mode INSERT
CREATE POLICY "Owner can create manual journal drafts for own business"
  ON manual_journal_drafts FOR INSERT
  WITH CHECK (
    manual_journal_drafts.accounting_firm_id IS NULL
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = manual_journal_drafts.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- C) Owner-mode UPDATE
CREATE POLICY "Owner can update own business manual journal drafts"
  ON manual_journal_drafts FOR UPDATE
  USING (
    manual_journal_drafts.accounting_firm_id IS NULL
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = manual_journal_drafts.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    manual_journal_drafts.accounting_firm_id IS NULL
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = manual_journal_drafts.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  );
