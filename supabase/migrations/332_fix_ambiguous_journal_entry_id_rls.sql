-- ============================================================================
-- Migration 332: Fix ambiguous journal_entry_id in RLS policy
-- ============================================================================
-- Policy "Firm users can view journal entry lines for engaged clients" can
-- cause "column reference journal_entry_id is ambiguous" when RLS is inlined
-- into queries that alias journal_entry_lines. Recreate policy with same logic
-- from migration 279; ensure journal_entry_lines.journal_entry_id is fully
-- qualified in the WHERE clause.
-- ============================================================================

DROP POLICY IF EXISTS "Firm users can view journal entry lines for engaged clients" ON journal_entry_lines;

CREATE POLICY "Firm users can view journal entry lines for engaged clients"
  ON journal_entry_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM journal_entries je
      INNER JOIN accounting_firm_users afu ON afu.user_id = auth.uid()
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = je.business_id
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE je.id = journal_entry_lines.journal_entry_id
    )
  );
