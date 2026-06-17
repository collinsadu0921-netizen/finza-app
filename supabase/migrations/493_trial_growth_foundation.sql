-- Migration 493: Trial growth foundation — signup attribution, consent, activation events
-- Service workspace trial conversion only; nullable columns safe for existing businesses.

-- ---------------------------------------------------------------------------
-- 1. Signup / consent columns on businesses
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS signup_goal TEXT,
  ADD COLUMN IF NOT EXISTS signup_source TEXT,
  ADD COLUMN IF NOT EXISTS signup_utm_source TEXT,
  ADD COLUMN IF NOT EXISTS signup_utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS signup_utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS trial_contact_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_contact_consent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.businesses.signup_goal IS
  'Primary goal selected at business setup (e.g. send_invoices, track_payments).';
COMMENT ON COLUMN public.businesses.signup_source IS
  'Optional referral/source string from marketing URL (ref, source) or manual entry.';
COMMENT ON COLUMN public.businesses.signup_utm_source IS 'UTM source captured at signup.';
COMMENT ON COLUMN public.businesses.signup_utm_medium IS 'UTM medium captured at signup.';
COMMENT ON COLUMN public.businesses.signup_utm_campaign IS 'UTM campaign captured at signup.';
COMMENT ON COLUMN public.businesses.trial_contact_consent IS
  'User agreed Finza may contact them about onboarding, trial, and account support.';
COMMENT ON COLUMN public.businesses.trial_contact_consent_at IS
  'Timestamp when trial_contact_consent was recorded at business setup.';

-- ---------------------------------------------------------------------------
-- 2. Activation events (one row per business + event_name)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_activation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT business_activation_events_event_name_check CHECK (
    event_name IN (
      'business_created',
      'onboarding_started',
      'onboarding_completed',
      'customer_created',
      'invoice_created',
      'payment_recorded',
      'expense_created',
      'pricing_viewed',
      'trial_expired',
      'subscription_started'
    )
  ),
  CONSTRAINT business_activation_events_business_event_unique UNIQUE (business_id, event_name)
);

CREATE INDEX IF NOT EXISTS business_activation_events_business_id_idx
  ON public.business_activation_events (business_id);

CREATE INDEX IF NOT EXISTS business_activation_events_event_name_idx
  ON public.business_activation_events (event_name);

CREATE INDEX IF NOT EXISTS business_activation_events_event_at_idx
  ON public.business_activation_events (event_at DESC);

COMMENT ON TABLE public.business_activation_events IS
  'Lightweight activation funnel milestones for service trial conversion (deduped per business + event).';

ALTER TABLE public.business_activation_events ENABLE ROW LEVEL SECURITY;

-- Service role / admin writes only from server; owners may read their business events.
CREATE POLICY business_activation_events_select_owner
  ON public.business_activation_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_activation_events.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = business_activation_events.business_id
        AND bu.user_id = auth.uid()
    )
  );
