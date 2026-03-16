-- ============================================================================
-- Drop permissive allow_all_* RLS policies on ledger + expenses
-- ============================================================================
-- These policies (USING(true) / WITH CHECK(true)) were created in 051 and
-- bypass RLS. journal_entries/journal_entry_lines rely on 043 owner-based
-- policies; expenses rely on 230 business members policies. RLS stays enabled.
-- Idempotent: DROP POLICY IF EXISTS.
-- ============================================================================

-- journal_entries (043 retains owner-based SELECT/INSERT; 222 REVOKE handles UPDATE/DELETE)
DROP POLICY IF EXISTS "allow_all_select_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_insert_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_update_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_delete_journal_entries" ON journal_entries;

-- journal_entry_lines (043 retains owner-based SELECT/INSERT; 222 REVOKE handles UPDATE/DELETE)
DROP POLICY IF EXISTS "allow_all_select_journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "allow_all_insert_journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "allow_all_update_journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "allow_all_delete_journal_entry_lines" ON journal_entry_lines;

-- expenses (230 retains "business members can *" SELECT/INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "allow_all_select_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_insert_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_update_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_delete_expenses" ON expenses;
