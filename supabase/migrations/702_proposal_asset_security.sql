-- ============================================================================
-- Release 06: proposal asset tenant isolation and staff storage access
-- ============================================================================
-- This migration is intentionally standalone: staging has the proposal tables
-- but does not have migration 430 in its migration ledger, so it must not
-- assume that the bucket/storage policies from 430 exist.
--
-- Security properties:
--   * storage_path is server-generated and permanently bound to
--     business_id/proposal_id.
--   * business_id, proposal_id and storage_path are immutable after insert.
--   * authenticated clients cannot INSERT or change asset ownership columns.
--   * public/staff reads re-check the proposal and tenant association.
--   * the private bucket has tenant-scoped storage RLS policies.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Pending-upload state
-- ----------------------------------------------------------------------------
ALTER TABLE public.proposal_assets
  ADD COLUMN IF NOT EXISTS upload_state TEXT;

UPDATE public.proposal_assets
SET upload_state = 'ready'
WHERE upload_state IS NULL;

ALTER TABLE public.proposal_assets
  ALTER COLUMN upload_state SET DEFAULT 'ready',
  ALTER COLUMN upload_state SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.proposal_assets'::regclass
      AND conname = 'proposal_assets_upload_state_check'
  ) THEN
    ALTER TABLE public.proposal_assets
      ADD CONSTRAINT proposal_assets_upload_state_check
      CHECK (upload_state IN ('pending', 'ready'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_proposal_assets_pending_uploads
  ON public.proposal_assets (created_at)
  WHERE upload_state = 'pending';

-- ----------------------------------------------------------------------------
-- 2) Path validation helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_proposal_asset_path_is_valid(
  p_business_id UUID,
  p_proposal_id UUID,
  p_storage_path TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    p_storage_path IS NOT NULL
    AND p_storage_path = btrim(p_storage_path)
    AND p_storage_path LIKE p_business_id::text || '/' || p_proposal_id::text || '/%'
    AND p_storage_path !~ '(^|/)\.\.(/|$)'
    AND p_storage_path ~ (
      '^' || p_business_id::text || '/' || p_proposal_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$'
    );
$$;

COMMENT ON FUNCTION public.finza_proposal_asset_path_is_valid(UUID, UUID, TEXT) IS
  'True only for a clean storage path under the asset''s authoritative business/proposal prefix.';

-- Validate all existing rows before adding the constraint. Rows whose path is
-- invalid AND has no matching Storage object are legacy/orphan metadata (for
-- example a deliberately missing test photograph). Quarantine those rows as
-- pending so they are hidden and cleaned up. If an invalid path still has a
-- real object, abort for manual review rather than silently reassigning it.
UPDATE public.proposal_assets a
SET
  upload_state = 'pending',
  storage_path = a.business_id::text || '/' || a.proposal_id::text || '/' || a.id::text || '_quarantine'
WHERE NOT public.finza_proposal_asset_path_is_valid(a.business_id, a.proposal_id, a.storage_path)
  AND NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'proposal-assets'
      AND o.name = a.storage_path
  );

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT count(*) INTO bad_count
  FROM public.proposal_assets a
  WHERE NOT public.finza_proposal_asset_path_is_valid(a.business_id, a.proposal_id, a.storage_path);

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Release 06 aborted: % proposal_assets row(s) have a storage_path outside their business/proposal prefix and a matching Storage object; manual review required',
      bad_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.proposal_assets'::regclass
      AND conname = 'proposal_assets_storage_path_bound_check'
  ) THEN
    ALTER TABLE public.proposal_assets
      ADD CONSTRAINT proposal_assets_storage_path_bound_check
      CHECK (
        storage_path LIKE business_id::text || '/' || proposal_id::text || '/%'
        AND storage_path !~ '(^|/)\.\.(/|$)'
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Ownership/path immutability trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_proposal_assets_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
BEGIN
  SELECT p.business_id
  INTO v_business_id
  FROM public.proposals p
  WHERE p.id = NEW.proposal_id
    AND p.deleted_at IS NULL;

  IF v_business_id IS NULL OR v_business_id <> NEW.business_id THEN
    RAISE EXCEPTION
      'proposal asset proposal_id/business_id mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.finza_proposal_asset_path_is_valid(NEW.business_id, NEW.proposal_id, NEW.storage_path) THEN
    RAISE EXCEPTION
      'proposal asset storage_path is outside its business/proposal prefix'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
      RAISE EXCEPTION
        'proposal asset ownership and storage_path are immutable'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.upload_state = 'ready' AND NEW.upload_state = 'pending' THEN
      RAISE EXCEPTION
        'a ready proposal asset cannot return to pending'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposal_assets_guard ON public.proposal_assets;
CREATE TRIGGER proposal_assets_guard
  BEFORE INSERT OR UPDATE ON public.proposal_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_proposal_assets_guard();

-- ----------------------------------------------------------------------------
-- 4) RLS and column privileges
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update proposal_assets for their business" ON public.proposal_assets;
CREATE POLICY "Users can update proposal_assets for their business"
  ON public.proposal_assets FOR UPDATE
  TO authenticated
  USING (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1
      FROM public.proposals p
      WHERE p.id = proposal_assets.proposal_id
        AND p.business_id = proposal_assets.business_id
        AND p.deleted_at IS NULL
    )
  )
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1
      FROM public.proposals p
      WHERE p.id = proposal_assets.proposal_id
        AND p.business_id = proposal_assets.business_id
        AND p.deleted_at IS NULL
    )
  );

-- The application writes assets through authorized server routes using the
-- service role. Ordinary clients may only change presentation/visibility
-- fields; they cannot insert an asset row or redirect an existing one.
REVOKE INSERT, UPDATE ON public.proposal_assets FROM anon, authenticated;

GRANT UPDATE (
  visible_on_public,
  internal_only,
  role,
  sort_order,
  section_ref
) ON public.proposal_assets TO authenticated;

-- ----------------------------------------------------------------------------
-- 5) Storage path authorization helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_user_can_access_proposal_storage_path(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]*$'
    AND EXISTS (
      SELECT 1
      FROM public.proposals p
      WHERE p.id = split_part(p_name, '/', 2)::uuid
        AND p.business_id = split_part(p_name, '/', 1)::uuid
        AND p.deleted_at IS NULL
        AND public.finza_user_can_access_business(p.business_id)
    );
$$;

REVOKE ALL ON FUNCTION public.finza_user_can_access_proposal_storage_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finza_user_can_access_proposal_storage_path(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6) Private bucket and tenant-scoped storage policies
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proposal-assets',
  'proposal-assets',
  false,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "proposal_assets_bucket_insert" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proposal-assets'
    AND storage.extension(name) IN ('jpg', 'jpeg', 'png', 'webp', 'pdf')
    AND public.finza_user_can_access_proposal_storage_path(name)
  );

DROP POLICY IF EXISTS "proposal_assets_bucket_select" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proposal-assets'
    AND public.finza_user_can_access_proposal_storage_path(name)
  );

DROP POLICY IF EXISTS "proposal_assets_bucket_delete" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proposal-assets'
    AND public.finza_user_can_access_proposal_storage_path(name)
  );

-- The legacy policy allowed authenticated overwrites anywhere under the
-- business prefix. Signed uploads use upsert=false; remove this path entirely.
DROP POLICY IF EXISTS "proposal_assets_bucket_update" ON storage.objects;

COMMIT;

-- ----------------------------------------------------------------------------
-- Operational notes
-- ----------------------------------------------------------------------------
-- * upload_state = 'pending' rows are created by POST /assets/upload-intent
--   before the browser uploads directly to Storage. POST /assets/finalize
--   validates the object and changes the row to 'ready'.
-- * Pending rows older than the upload TTL are removed by the cleanup helper.
-- * Existing proposal assets default to 'ready' and remain usable.
-- * A rollback restores the prior, vulnerable policy and is not recommended
--   without an incident decision. See 702_proposal_asset_security.rollback.sql.
