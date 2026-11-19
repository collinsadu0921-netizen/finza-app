-- 718_proposals_soft_delete_rls_fix.sql
-- Fix: staff could not soft-delete proposals.
--
-- Symptom (production, 42501):
--   new row violates row-level security policy for table "proposals"
--
-- Root cause:
--   430 created the SELECT policy with `deleted_at IS NULL`. PostgreSQL also
--   re-checks the SELECT policies against the *new* row version produced by an
--   UPDATE. The DELETE endpoint soft-deletes with
--   `UPDATE proposals SET deleted_at = now() ...`, so the new row no longer
--   satisfies the SELECT policy and Postgres rejects the whole UPDATE — even
--   though the UPDATE policy's WITH CHECK is satisfied and the caller is a
--   valid tenant member. Updating any other column (e.g. title) works, which
--   is why only delete failed.
--
-- Fix:
--   * Keep tenant scoping on SELECT, but stop hiding soft-deleted rows inside
--     RLS. Application reads already filter `.is("deleted_at", null)`
--     (list, detail, public-token routes), so behaviour is unchanged.
--   * Move `deleted_at IS NULL` into the UPDATE USING clause so a soft-deleted
--     proposal can still not be edited or re-deleted.
--
-- The same pattern is already used by public.estimates.
--
-- No data changes.

DROP POLICY IF EXISTS "Users can select proposals for their business" ON public.proposals;
CREATE POLICY "Users can select proposals for their business"
  ON public.proposals FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can update proposals for their business" ON public.proposals;
CREATE POLICY "Users can update proposals for their business"
  ON public.proposals FOR UPDATE
  USING (
    public.finza_user_can_access_business(business_id)
    AND deleted_at IS NULL
  )
  WITH CHECK (public.finza_user_can_access_business(business_id));
