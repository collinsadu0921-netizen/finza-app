-- Hubtel-first foundation (phase 1): tenant Hubtel connection records.
-- No raw API keys yet; credentials_ref reserved until Hubtel credential contract is confirmed.

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.tenant_hubtel_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'hubtel' CHECK (provider = 'hubtel'),
  merchant_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'connected', 'failed', 'disconnected')),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failed_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  CONSTRAINT tenant_hubtel_connections_business_env_unique
    UNIQUE (business_id, environment)
);

COMMENT ON TABLE public.tenant_hubtel_connections IS
  'Tenant-specific Hubtel onboarding state. credentials_ref points to future secure secret storage; no raw secrets stored here.';

CREATE INDEX IF NOT EXISTS tenant_hubtel_connections_business_id_idx
  ON public.tenant_hubtel_connections (business_id);

CREATE INDEX IF NOT EXISTS tenant_hubtel_connections_status_idx
  ON public.tenant_hubtel_connections (status);

CREATE INDEX IF NOT EXISTS tenant_hubtel_connections_environment_idx
  ON public.tenant_hubtel_connections (environment);

CREATE TRIGGER tenant_hubtel_connections_updated_at
  BEFORE UPDATE ON public.tenant_hubtel_connections
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.tenant_hubtel_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_hubtel_connections_select"
  ON public.tenant_hubtel_connections FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "tenant_hubtel_connections_insert"
  ON public.tenant_hubtel_connections FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "tenant_hubtel_connections_update"
  ON public.tenant_hubtel_connections FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

