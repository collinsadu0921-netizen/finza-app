-- ============================================================================
-- Optional defensive DB uniqueness: partial unique index on reconciliation JEs.
-- Only applied when no historical duplicates exist (safe to enforce).
-- No schema change to columns; index only.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE reference_type = 'reconciliation'
    GROUP BY reference_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_reconciliation_reference
      ON journal_entries(reference_type, reference_id)
      WHERE reference_type = 'reconciliation';
  END IF;
END
$$;

COMMENT ON INDEX uniq_reconciliation_reference IS
'Defensive: one reference_id per reconciliation JE. Created only when no duplicates exist.';
