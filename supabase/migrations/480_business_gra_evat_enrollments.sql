-- ============================================================================
-- Phase 3A: GRA E-VAT business enrollment foundation (eligibility / gating only)
-- No payload mapper, no HTTP submission, no invoice flow changes.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE public.business_gra_evat_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('test', 'live')),
  enrollment_status text NOT NULL DEFAULT 'not_started'
    CHECK (
      enrollment_status IN (
        'not_started',
        'draft',
        'pending_finza_review',
        'submitted_to_gra',
        'pending_gra',
        'approved',
        'rejected',
        'suspended',
        'revoked'
      )
    ),
  gra_business_reference text,
  taxpayer_evat_id text,
  vsdc_id text,
  credentials_ref text,
  -- Application-encrypted secret bundle when populated; never plaintext SECURITY_KEY/VSDC secrets.
  -- TODO: Prefer reads/writes via service-role RPC so anon/authenticated clients never SELECT this column.
  secret_config_encrypted text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  forms_received_at timestamptz,
  forms_submitted_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_gra_evat_enrollments_business_env_unique UNIQUE (business_id, environment),
  CONSTRAINT business_gra_evat_enrollments_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.business_gra_evat_enrollments IS
  'GRA E-VAT eligibility per business and environment (test/live). Controls whether invoice submission to E-VAT is allowed; does not store plaintext SECURITY_KEY/VSDC secrets.';

COMMENT ON COLUMN public.business_gra_evat_enrollments.enrollment_status IS
  'Only approved allows E-VAT invoice submission for the matching environment; all other values block submission.';

COMMENT ON COLUMN public.business_gra_evat_enrollments.credentials_ref IS
  'Opaque reference to external secret storage; no raw API keys in this table.';

COMMENT ON COLUMN public.business_gra_evat_enrollments.secret_config_encrypted IS
  'Optional ciphertext for VSDC/SECURITY_KEY material; decrypt only on trusted server. Do not expose via client Supabase reads — use service-role RPCs when wiring secrets.';

CREATE INDEX business_gra_evat_enrollments_business_id_idx
  ON public.business_gra_evat_enrollments (business_id);

CREATE INDEX business_gra_evat_enrollments_environment_idx
  ON public.business_gra_evat_enrollments (environment);

CREATE INDEX business_gra_evat_enrollments_enrollment_status_idx
  ON public.business_gra_evat_enrollments (enrollment_status);

CREATE INDEX business_gra_evat_enrollments_business_env_status_idx
  ON public.business_gra_evat_enrollments (business_id, environment, enrollment_status);

CREATE TRIGGER business_gra_evat_enrollments_updated_at
  BEFORE UPDATE ON public.business_gra_evat_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.business_gra_evat_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_gra_evat_enrollments_select
  ON public.business_gra_evat_enrollments FOR SELECT
  USING (public.finza_user_can_access_business (business_id));

CREATE POLICY business_gra_evat_enrollments_insert
  ON public.business_gra_evat_enrollments FOR INSERT
  WITH CHECK (public.finza_user_can_access_business (business_id));

CREATE POLICY business_gra_evat_enrollments_update
  ON public.business_gra_evat_enrollments FOR UPDATE
  USING (public.finza_user_can_access_business (business_id))
  WITH CHECK (public.finza_user_can_access_business (business_id));
