-- Hubtel-first foundation (phase 1): platform payment configuration.
-- Added because no existing platform-level settings table safely stores global provider defaults/modes.

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.platform_payment_configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.platform_payment_configuration IS
  'Platform-scoped payment flags/defaults (e.g. default subscription provider, hubtel mode, tenant hubtel connection toggle).';

COMMENT ON COLUMN public.platform_payment_configuration.config_value IS
  'JSON payload for platform payment config. No tenant secrets should be stored here.';

CREATE TRIGGER platform_payment_configuration_updated_at
  BEFORE UPDATE ON public.platform_payment_configuration
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- Default row seeds (idempotent).
INSERT INTO public.platform_payment_configuration (config_key, config_value, description)
VALUES
  (
    'subscription_provider_defaults',
    jsonb_build_object(
      'default_subscription_provider', 'mock',
      'hubtel_mode', 'mock',
      'hubtel_enabled', false,
      'hubtel_webhook_processing_enabled', false,
      'tenant_hubtel_connections_enabled', true
    ),
    'Hubtel-first rollout defaults with safe mock-first posture.'
  )
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.platform_payment_configuration ENABLE ROW LEVEL SECURITY;

-- Intentionally no user-facing RLS policies.
-- Reads/writes should happen from trusted server contexts only (e.g. service-role).

