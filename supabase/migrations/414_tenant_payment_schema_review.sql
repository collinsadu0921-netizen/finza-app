-- Phase 1 review: tighten tenant payment schema for webhook/verify lookup and invariants.
-- Schema-only; no application code changes.

-- -----------------------------------------------------------------------------
-- 1) Reference uniqueness: (provider_type, reference) instead of (business_id, provider_type, reference)
--
-- Rationale vs global UNIQUE(reference) only:
--   - Different provider integrations may reuse the same opaque reference string shape;
--     scoping by provider_type avoids false uniqueness collisions across providers.
-- Rationale vs keeping business_id in the key:
--   - Verify/webhook handlers often receive (provider, reference) before business_id is known;
--     a single-row lookup on (provider_type, reference) is the target pattern.
-- Application obligation:
--   - Each provider_type must generate references that are unique across ALL businesses
--     (e.g. UUID, or prefix including business_id), or upserts/webhooks will conflict.
-- -----------------------------------------------------------------------------

ALTER TABLE public.payment_provider_transactions
  DROP CONSTRAINT IF EXISTS payment_provider_transactions_business_provider_reference_unique;

ALTER TABLE public.payment_provider_transactions
  ADD CONSTRAINT payment_provider_transactions_provider_type_reference_unique
  UNIQUE (provider_type, reference);

COMMENT ON CONSTRAINT payment_provider_transactions_provider_type_reference_unique
  ON public.payment_provider_transactions IS
  'Lookup key for webhook/verify: (provider_type, reference). References must be globally unique per provider_type across tenants.';

-- -----------------------------------------------------------------------------
-- 2) invoice_id vs sale_id: never both set; both NULL allowed
--
-- Rationale for allowing (NULL, NULL):
--   - Staged initiation before invoice/sale FK is attached, or internal-only tracking
--     where business_id + reference suffice until linkage; enforced at app layer for
--     settled integrated flows if desired.
-- -----------------------------------------------------------------------------

ALTER TABLE public.payment_provider_transactions
  ADD CONSTRAINT payment_provider_transactions_invoice_sale_exclusive_chk
  CHECK (
    NOT (invoice_id IS NOT NULL AND sale_id IS NOT NULL)
  );

-- -----------------------------------------------------------------------------
-- 3) At most one provider-transaction row per payment_id when linked
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.payment_provider_transactions_payment_id_idx;

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_transactions_payment_id_unique
  ON public.payment_provider_transactions (payment_id)
  WHERE payment_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4) public_config must be a JSON object (not array/scalar)
-- -----------------------------------------------------------------------------

ALTER TABLE public.business_payment_providers
  ADD CONSTRAINT business_payment_providers_public_config_object_chk
  CHECK (jsonb_typeof(public_config) = 'object');
