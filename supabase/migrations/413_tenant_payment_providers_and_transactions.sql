-- Phase 1 (tenant payments redesign): canonical provider config + external transaction tracking.
-- Coexists with businesses.momo_settings / hubtel_settings until legacy cutover (no data migration here).

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- business_payment_providers: tenant-owned payment configuration (one row per business + type + environment)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN (
    'manual_wallet',
    'mtn_momo_direct',
    'telecel_cash_direct',
    'at_money_direct',
    'hubtel',
    'paystack_tenant'
  )),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  validation_status TEXT NOT NULL DEFAULT 'unvalidated' CHECK (validation_status IN (
    'unvalidated',
    'valid',
    'invalid'
  )),
  validated_at TIMESTAMPTZ,
  last_validation_message TEXT,
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- App-layer encrypted payload (ciphertext); never store raw secrets in public_config.
  secret_config_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_payment_providers_business_provider_env_unique
    UNIQUE (business_id, provider_type, environment)
);

COMMENT ON TABLE public.business_payment_providers IS
  'Tenant payment provider configuration. Replaces reliance on businesses JSON columns after cutover. Secrets in secret_config_encrypted only.';

COMMENT ON COLUMN public.business_payment_providers.public_config IS
  'Non-secret JSON: wallet labels, instructions, display fields, non-sensitive provider options.';

COMMENT ON COLUMN public.business_payment_providers.secret_config_encrypted IS
  'Application-encrypted secret bundle; decrypt only on server.';

-- At most one default provider per business per environment (test vs live).
CREATE UNIQUE INDEX IF NOT EXISTS business_payment_providers_one_default_per_business_env
  ON public.business_payment_providers (business_id, environment)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS business_payment_providers_business_id_idx
  ON public.business_payment_providers (business_id);

CREATE INDEX IF NOT EXISTS business_payment_providers_provider_type_idx
  ON public.business_payment_providers (provider_type);

-- -----------------------------------------------------------------------------
-- payment_provider_transactions: reference -> business / invoice / sale / payment mapping + idempotency support
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_provider_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN (
    'manual_wallet',
    'mtn_momo_direct',
    'telecel_cash_direct',
    'at_money_direct',
    'hubtel',
    'paystack_tenant'
  )),
  workspace TEXT NOT NULL CHECK (workspace IN ('service', 'retail')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  provider_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated',
    'pending',
    'requires_action',
    'successful',
    'failed',
    'cancelled'
  )),
  amount_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  request_payload JSONB,
  response_payload JSONB,
  last_event_payload JSONB,
  idempotency_key TEXT,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_provider_transactions_business_provider_reference_unique
    UNIQUE (business_id, provider_type, reference)
);

COMMENT ON TABLE public.payment_provider_transactions IS
  'Canonical mapping for provider reference -> business and invoice/sale; webhook/verify idempotency.';

CREATE INDEX IF NOT EXISTS payment_provider_transactions_reference_idx
  ON public.payment_provider_transactions (reference);

CREATE INDEX IF NOT EXISTS payment_provider_transactions_business_id_idx
  ON public.payment_provider_transactions (business_id);

CREATE INDEX IF NOT EXISTS payment_provider_transactions_invoice_id_idx
  ON public.payment_provider_transactions (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_provider_transactions_sale_id_idx
  ON public.payment_provider_transactions (sale_id)
  WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_provider_transactions_payment_id_idx
  ON public.payment_provider_transactions (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_transactions_idempotency_key_unique
  ON public.payment_provider_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Optional: one row per external provider id when present (best-effort dedupe)
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_transactions_provider_tx_unique
  ON public.payment_provider_transactions (business_id, provider_type, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS business_payment_providers_updated_at ON public.business_payment_providers;
CREATE TRIGGER business_payment_providers_updated_at
  BEFORE UPDATE ON public.business_payment_providers
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

DROP TRIGGER IF EXISTS payment_provider_transactions_updated_at ON public.payment_provider_transactions;
CREATE TRIGGER payment_provider_transactions_updated_at
  BEFORE UPDATE ON public.payment_provider_transactions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- RLS: business owner or business_users member (same helper as payroll / team RLS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.business_payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_payment_providers_select"
  ON public.business_payment_providers FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "business_payment_providers_insert"
  ON public.business_payment_providers FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "business_payment_providers_update"
  ON public.business_payment_providers FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "business_payment_providers_delete"
  ON public.business_payment_providers FOR DELETE
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "payment_provider_transactions_select"
  ON public.payment_provider_transactions FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "payment_provider_transactions_insert"
  ON public.payment_provider_transactions FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "payment_provider_transactions_update"
  ON public.payment_provider_transactions FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "payment_provider_transactions_delete"
  ON public.payment_provider_transactions FOR DELETE
  USING (public.finza_user_can_access_business(business_id));
