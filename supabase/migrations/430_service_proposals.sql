-- ============================================================================
-- Service proposals (v1) + proposal_assets + private storage bucket
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Storage bucket — proposal-assets (private; access via signed URLs / APIs)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proposal-assets',
  'proposal-assets',
  false,
  15728640, -- 15 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {business_id}/{proposal_id}/{uuid}_{filename}
-- First path segment must be a business the user can access.

DROP POLICY IF EXISTS "proposal_assets_bucket_insert" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proposal-assets'
    AND split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.finza_user_can_access_business(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS "proposal_assets_bucket_select" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proposal-assets'
    AND split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.finza_user_can_access_business(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS "proposal_assets_bucket_update" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'proposal-assets'
    AND split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.finza_user_can_access_business(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS "proposal_assets_bucket_delete" ON storage.objects;
CREATE POLICY "proposal_assets_bucket_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proposal-assets'
    AND split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.finza_user_can_access_business(split_part(name, '/', 1)::uuid)
  );

-- ----------------------------------------------------------------------------
-- 2) proposals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proposals (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id            UUID        REFERENCES public.customers(id) ON DELETE SET NULL,
  title                  TEXT        NOT NULL DEFAULT '',
  proposal_number        TEXT,
  status                 TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','accepted','rejected','expired','converted')),
  template_id            TEXT        NOT NULL DEFAULT 'standard_v1',
  sections               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  pricing_mode           TEXT        NOT NULL DEFAULT 'none'
    CHECK (pricing_mode IN ('none','fixed','line_items','custom')),
  pricing_payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  currency_code          TEXT,
  public_token           TEXT        NOT NULL UNIQUE DEFAULT public.generate_public_token(),
  expires_at             TIMESTAMPTZ,
  sent_at                TIMESTAMPTZ,
  viewed_at              TIMESTAMPTZ,
  created_by_user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposals_business_id_active
  ON public.proposals (business_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_public_token
  ON public.proposals (public_token)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_created_at
  ON public.proposals (business_id, created_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS proposals_set_updated_at ON public.proposals;
CREATE TRIGGER proposals_set_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.proposals IS 'Finza Service — client-facing proposals (structured sections, pricing snapshot, public token)';

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select proposals for their business" ON public.proposals;
CREATE POLICY "Users can select proposals for their business"
  ON public.proposals FOR SELECT
  USING (deleted_at IS NULL AND public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can insert proposals for their business" ON public.proposals;
CREATE POLICY "Users can insert proposals for their business"
  ON public.proposals FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can update proposals for their business" ON public.proposals;
CREATE POLICY "Users can update proposals for their business"
  ON public.proposals FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can delete proposals for their business" ON public.proposals;
CREATE POLICY "Users can delete proposals for their business"
  ON public.proposals FOR DELETE
  USING (public.finza_user_can_access_business(business_id));

-- ----------------------------------------------------------------------------
-- 3) proposal_assets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proposal_assets (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id        UUID        NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  business_id        UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind               TEXT        NOT NULL CHECK (kind IN ('image','pdf','file')),
  mime_type          TEXT        NOT NULL DEFAULT '',
  file_name          TEXT        NOT NULL CHECK (length(trim(file_name)) > 0),
  file_size          BIGINT      NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  storage_path       TEXT        NOT NULL CHECK (length(trim(storage_path)) > 0),
  role               TEXT        NOT NULL DEFAULT 'attachment'
    CHECK (role IN ('inline','attachment','gallery')),
  visible_on_public  BOOLEAN     NOT NULL DEFAULT TRUE,
  internal_only      BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order         INT         NOT NULL DEFAULT 0,
  section_ref        TEXT,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_assets_proposal_id ON public.proposal_assets (proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_assets_business_id ON public.proposal_assets (business_id);

COMMENT ON TABLE public.proposal_assets IS 'Media attached to a proposal — private storage path + visibility flags';

ALTER TABLE public.proposal_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select proposal_assets for their business" ON public.proposal_assets;
CREATE POLICY "Users can select proposal_assets for their business"
  ON public.proposal_assets FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can insert proposal_assets for their business" ON public.proposal_assets;
CREATE POLICY "Users can insert proposal_assets for their business"
  ON public.proposal_assets FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1 FROM public.proposals p
      WHERE p.id = proposal_id
        AND p.business_id = proposal_assets.business_id
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can update proposal_assets for their business" ON public.proposal_assets;
CREATE POLICY "Users can update proposal_assets for their business"
  ON public.proposal_assets FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can delete proposal_assets for their business" ON public.proposal_assets;
CREATE POLICY "Users can delete proposal_assets for their business"
  ON public.proposal_assets FOR DELETE
  USING (public.finza_user_can_access_business(business_id));
