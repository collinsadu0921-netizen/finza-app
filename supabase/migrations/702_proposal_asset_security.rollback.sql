-- ============================================================================
-- EMERGENCY ROLLBACK for 702_proposal_asset_security
-- ============================================================================
-- WARNING: This restores the previous, vulnerable policy shape. Use only for a
-- controlled incident rollback after an explicit security decision. Do not run
-- this automatically with normal migrations.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "proposal_assets_bucket_delete" ON storage.objects;
DROP POLICY IF EXISTS "proposal_assets_bucket_select" ON storage.objects;
DROP POLICY IF EXISTS "proposal_assets_bucket_insert" ON storage.objects;

DROP FUNCTION IF EXISTS public.finza_user_can_access_proposal_storage_path(TEXT);

DROP TRIGGER IF EXISTS proposal_assets_guard ON public.proposal_assets;
DROP FUNCTION IF EXISTS public.finza_proposal_assets_guard();

ALTER TABLE public.proposal_assets
  DROP CONSTRAINT IF EXISTS proposal_assets_storage_path_bound_check;
ALTER TABLE public.proposal_assets
  DROP CONSTRAINT IF EXISTS proposal_assets_upload_state_check;

DROP INDEX IF EXISTS public.idx_proposal_assets_pending_uploads;
ALTER TABLE public.proposal_assets DROP COLUMN IF EXISTS upload_state;

DROP FUNCTION IF EXISTS public.finza_proposal_asset_path_is_valid(UUID, UUID, TEXT);

DROP POLICY IF EXISTS "Users can update proposal_assets for their business" ON public.proposal_assets;
CREATE POLICY "Users can update proposal_assets for their business"
  ON public.proposal_assets FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

REVOKE UPDATE (
  visible_on_public,
  internal_only,
  role,
  sort_order,
  section_ref
) ON public.proposal_assets FROM authenticated;

GRANT INSERT, UPDATE ON public.proposal_assets TO anon, authenticated;

COMMIT;
