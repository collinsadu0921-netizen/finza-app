-- ============================================================================
-- Migration 325: Drop 16-parameter post_journal_entry overload
-- ============================================================================
-- Ensures only the 17-parameter canonical post_journal_entry exists.
-- The 16-param version was a backward-compat wrapper that caused
-- "function post_journal_entry(...) is not unique" when calling with 16 args.
-- Safe to run even if the overload was already removed (IF EXISTS).
-- ============================================================================

DROP FUNCTION IF EXISTS public.post_journal_entry(
  UUID, DATE, TEXT, TEXT, UUID, JSONB,
  BOOLEAN, TEXT, TEXT, UUID,
  TEXT, TEXT, TEXT, UUID,
  TEXT, BOOLEAN
);

-- Verification (run manually if needed):
-- SELECT pg_get_function_identity_arguments(p.oid) AS args, p.pronargs
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'post_journal_entry';
-- Expected: one row, pronargs = 17
