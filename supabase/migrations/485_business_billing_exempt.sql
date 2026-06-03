-- ============================================================================
-- Migration 485: Internal / founder billing exemption (service workspace)
-- ============================================================================
-- When billing_exempt = true, subscription lifecycle (lock, grace, trial
-- downgrade, checkout) must not restrict access. Controlled via DB flag only —
-- never hardcode founder emails in application logic.
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS billing_exempt_reason TEXT;

COMMENT ON COLUMN public.businesses.billing_exempt IS
  'When true, service workspace has permanent Business-tier access without payment. Skips lock, grace, trial downgrade, and subscription checkout enforcement.';

COMMENT ON COLUMN public.businesses.billing_exempt_reason IS
  'Optional audit label for billing exemption (e.g. founder_internal_account). Not used for access decisions — only billing_exempt boolean gates behavior.';

CREATE INDEX IF NOT EXISTS idx_businesses_billing_exempt
  ON public.businesses (billing_exempt)
  WHERE billing_exempt = true AND archived_at IS NULL;
