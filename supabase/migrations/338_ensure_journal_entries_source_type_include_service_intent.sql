-- ============================================================================
-- Ensure journal_entries_source_type_check allows 'service_intent'
-- ============================================================================
-- post_service_intent_to_ledger inserts with source_type = 'service_intent'.
-- If migration 304 was skipped or applied in a different order, the constraint
-- may still only allow ('proposal', 'adjustment', 'manual_draft', 'opening_balance').
-- This migration forces the constraint to the full list so all code paths succeed.
-- ============================================================================

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (
    source_type IS NULL
    OR source_type IN (
      'proposal',
      'adjustment',
      'manual_draft',
      'opening_balance',
      'service_intent'
    )
  );
