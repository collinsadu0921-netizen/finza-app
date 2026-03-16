-- ============================================================================
-- MIGRATION: Phase 3.1 - Report Performance Indexes
-- ============================================================================
-- Adds performance indexes for Trial Balance and General Ledger reports
-- 
-- Scope: READ-ONLY hardening only (no posting, no edits, no mutations)
-- Mode: CONTROLLED BATCH (no drift)
-- 
-- Goal: Make TB/GL fast and safe for large datasets
-- ============================================================================

-- ============================================================================
-- PART 1: JOURNAL ENTRIES INDEXES
-- ============================================================================

-- Composite index for business + date filtering (used in all reports)
-- Covers: WHERE business_id = X AND date >= Y AND date <= Z
-- Order: business_id first (high selectivity), then date (range query)
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_date_id 
ON journal_entries(business_id, date, id);

-- Alternative: If reference_type filtering is common, add composite index
-- (Only if used in WHERE clauses - currently not used in report functions)
-- CREATE INDEX IF NOT EXISTS idx_journal_entries_business_reference_date
-- ON journal_entries(business_id, reference_type, date);

-- ============================================================================
-- PART 2: JOURNAL ENTRY LINES INDEXES
-- ============================================================================

-- Composite index for entry + account (used in Trial Balance aggregation)
-- Covers: JOIN on journal_entry_id AND filter/group by account_id
-- Order: journal_entry_id first (for join), then account_id (for grouping)
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry_account
ON journal_entry_lines(journal_entry_id, account_id);

-- Composite index for account + entry (used in General Ledger lookup)
-- Covers: WHERE account_id = X AND journal_entry_id IN (filtered entries)
-- Order: account_id first (high selectivity for single account), then journal_entry_id
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_entry
ON journal_entry_lines(account_id, journal_entry_id);

-- Note: The existing single-column indexes are still useful:
-- - idx_journal_entry_lines_journal_entry_id (for joins from journal_entries)
-- - idx_journal_entry_lines_account_id (for account lookups)
-- These composite indexes complement, not replace, them.

-- ============================================================================
-- PART 3: ACCOUNTS INDEXES (ENHANCEMENT)
-- ============================================================================

-- Composite index for business + code + deleted_at (for COA queries and joins)
-- Covers: WHERE business_id = X AND deleted_at IS NULL ORDER BY code
-- The existing idx_accounts_business_id is single-column; this is more selective
CREATE INDEX IF NOT EXISTS idx_accounts_business_code_deleted
ON accounts(business_id, code) WHERE deleted_at IS NULL;

-- Note: The existing single-column indexes are still useful:
-- - idx_accounts_business_id (general business lookups)
-- - idx_accounts_code (code lookups across businesses)
-- - idx_accounts_type (type filtering)
-- - idx_accounts_deleted_at (partial index for active accounts)

-- ============================================================================
-- PART 4: VERIFY INDEX CREATION
-- ============================================================================

-- Verify indexes were created successfully
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('journal_entries', 'journal_entry_lines', 'accounts')
    AND indexname IN (
      'idx_journal_entries_business_date_id',
      'idx_journal_entry_lines_entry_account',
      'idx_journal_entry_lines_account_entry',
      'idx_accounts_business_code_deleted'
    );

  IF index_count < 4 THEN
    RAISE NOTICE 'Warning: Expected 4 indexes, found %', index_count;
  ELSE
    RAISE NOTICE 'Successfully created % performance indexes', index_count;
  END IF;
END $$;

-- ============================================================================
-- PART 5: INDEX MAINTENANCE NOTES
-- ============================================================================

-- These indexes will be automatically maintained by PostgreSQL
-- Monitor index usage with:
-- SELECT * FROM pg_stat_user_indexes WHERE schemaname = 'public' AND tablename IN ('journal_entries', 'journal_entry_lines', 'accounts');
--
-- Monitor index size with:
-- SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) as index_size
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public' AND tablename IN ('journal_entries', 'journal_entry_lines', 'accounts')
-- ORDER BY pg_relation_size(indexrelid) DESC;

COMMENT ON INDEX idx_journal_entries_business_date_id IS 'Performance index for report date filtering: business_id + date + id. Used in Trial Balance, General Ledger, P&L, and Balance Sheet.';
COMMENT ON INDEX idx_journal_entry_lines_entry_account IS 'Performance index for Trial Balance aggregation: journal_entry_id + account_id. Supports efficient JOIN and GROUP BY operations.';
COMMENT ON INDEX idx_journal_entry_lines_account_entry IS 'Performance index for General Ledger lookup: account_id + journal_entry_id. Supports efficient account-specific queries with date filtering.';
COMMENT ON INDEX idx_accounts_business_code_deleted IS 'Performance index for COA queries: business_id + code with deleted_at filter. Supports efficient account lookups and joins with ordering.';
