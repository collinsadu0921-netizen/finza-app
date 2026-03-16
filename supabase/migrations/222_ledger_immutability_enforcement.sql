-- ============================================================================
-- Migration: 222 — Ledger immutability enforcement (database layer)
-- ============================================================================
-- A) REVOKE UPDATE/DELETE from anon and authenticated (defense-in-depth).
--    Do not revoke INSERT/SELECT; do not revoke from service_role.
-- B) reconciliation_resolutions: append-only at DB layer via trigger.
-- C) No changes to posting logic, existing JE/JEL triggers, RLS, or schema.
-- ============================================================================

-- ============================================================================
-- A1) REVOKE UPDATE, DELETE — journal_entries, journal_entry_lines
-- ============================================================================
-- Triggers in 088/156 already block UPDATE/DELETE for all roles.
-- Revoking from anon/authenticated ensures app roles cannot attempt it.

REVOKE UPDATE, DELETE ON TABLE journal_entries FROM anon;
REVOKE UPDATE, DELETE ON TABLE journal_entries FROM authenticated;

REVOKE UPDATE, DELETE ON TABLE journal_entry_lines FROM anon;
REVOKE UPDATE, DELETE ON TABLE journal_entry_lines FROM authenticated;

-- ============================================================================
-- A2) REVOKE UPDATE, DELETE — trial_balance_snapshots
-- ============================================================================
-- trial_balance_snapshots cannot have an immutability trigger: the system
-- function generate_trial_balance() uses INSERT ... ON CONFLICT (period_id)
-- DO UPDATE to upsert snapshots. That path runs with service_role. We only
-- revoke UPDATE/DELETE from anon and authenticated so app users cannot
-- modify; service_role remains able to run generate_trial_balance().

REVOKE UPDATE, DELETE ON TABLE trial_balance_snapshots FROM anon;
REVOKE UPDATE, DELETE ON TABLE trial_balance_snapshots FROM authenticated;

-- ============================================================================
-- B) reconciliation_resolutions — append-only at DB layer
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_reconciliation_resolution_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'reconciliation_resolutions is append-only.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation_resolutions is append-only.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_reconciliation_resolution_modification ON reconciliation_resolutions;
CREATE TRIGGER trigger_prevent_reconciliation_resolution_modification
  BEFORE UPDATE OR DELETE ON reconciliation_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_reconciliation_resolution_modification();

REVOKE UPDATE, DELETE ON TABLE reconciliation_resolutions FROM anon;
REVOKE UPDATE, DELETE ON TABLE reconciliation_resolutions FROM authenticated;

-- ============================================================================
-- D) Verification (run manually; expect no UPDATE/DELETE for anon/authenticated,
--    and triggers present). Do not uncomment and run inside migration.
-- ============================================================================
/*
-- 1) table_privileges: no UPDATE/DELETE for anon or authenticated on these tables
SELECT grantee, table_name, privilege
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('journal_entries', 'journal_entry_lines', 'trial_balance_snapshots', 'reconciliation_resolutions')
  AND privilege IN ('UPDATE', 'DELETE')
ORDER BY table_name, grantee;
-- Expect: no rows for grantee IN ('anon', 'authenticated').

-- 2) trigger exists for reconciliation_resolutions
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgrelid = 'reconciliation_resolutions'::regclass
  AND tgname = 'trigger_prevent_reconciliation_resolution_modification';
-- Expect: 1 row.

-- 3) triggers exist for journal_entries and journal_entry_lines
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgrelid IN ('journal_entries'::regclass, 'journal_entry_lines'::regclass)
  AND tgname IN ('trigger_prevent_journal_entry_modification', 'trigger_prevent_journal_entry_line_modification');
-- Expect: 2 rows.
*/
