-- ============================================================================
-- Database test for migration 718 — proposals soft-delete RLS fix
-- Guards against re-introducing `deleted_at IS NULL` in the proposals SELECT
-- policy, which makes `UPDATE ... SET deleted_at = now()` fail with 42501.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/proposals_soft_delete_rls.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_qual text;
  v_check text;
BEGIN
  -- SELECT policy must be tenant-scoped only, never filtered by deleted_at.
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'proposals'
    AND cmd = 'SELECT'
    AND policyname = 'Users can select proposals for their business';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'proposals SELECT policy is missing';
  END IF;
  IF v_qual ILIKE '%deleted_at%' THEN
    RAISE EXCEPTION 'proposals SELECT policy must not filter deleted_at (breaks soft delete): %', v_qual;
  END IF;
  IF v_qual NOT ILIKE '%finza_user_can_access_business%' THEN
    RAISE EXCEPTION 'proposals SELECT policy lost tenant scoping: %', v_qual;
  END IF;

  -- Only active rows may be updated, so soft-deleted proposals stay immutable.
  SELECT qual, with_check INTO v_qual, v_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'proposals'
    AND cmd = 'UPDATE'
    AND policyname = 'Users can update proposals for their business';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'proposals UPDATE policy is missing';
  END IF;
  IF v_qual NOT ILIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'proposals UPDATE USING must exclude soft-deleted rows: %', v_qual;
  END IF;
  IF v_check IS NULL OR v_check ILIKE '%deleted_at%' THEN
    RAISE EXCEPTION 'proposals UPDATE WITH CHECK must allow the soft-delete transition: %', v_check;
  END IF;
END $$;

ROLLBACK;
