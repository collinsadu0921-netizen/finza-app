-- Invitation-only Retail onboarding. Raw tokens are never stored.
-- Acceptance, business insert, membership insert, and invitation consumption
-- run in accept_retail_invitation(), one transaction.

CREATE TABLE IF NOT EXISTS public.retail_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  business_name text NOT NULL,
  token_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users (id),
  accepted_business_id uuid REFERENCES public.businesses (id),
  revoked_at timestamptz,
  internal_note text,
  last_email_provider_status text
    CHECK (last_email_provider_status IS NULL OR last_email_provider_status IN ('accepted', 'rejected', 'not_attempted')),
  last_email_provider_id text,
  last_email_error text,
  last_email_attempted_at timestamptz,
  CONSTRAINT retail_invitations_email_normalized_chk
    CHECK (email_normalized = lower(email_normalized) AND position('@' in email_normalized) > 1),
  CONSTRAINT retail_invitations_business_name_chk
    CHECK (char_length(btrim(business_name)) BETWEEN 1 AND 200),
  CONSTRAINT retail_invitations_token_hash_chk
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retail_invitations_token_version_chk
    CHECK (token_version >= 1),
  CONSTRAINT retail_invitations_accepted_fields_chk
    CHECK (
      status <> 'accepted'
      OR (
        accepted_at IS NOT NULL
        AND accepted_by_user_id IS NOT NULL
        AND accepted_business_id IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS retail_invitations_token_hash_uidx
  ON public.retail_invitations (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS retail_invitations_one_pending_email_uidx
  ON public.retail_invitations (email_normalized)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS retail_invitations_status_created_idx
  ON public.retail_invitations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS retail_invitations_pending_expires_idx
  ON public.retail_invitations (expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.retail_onboarding_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL
    CHECK (action IN (
      'invitation_created',
      'invitation_email_requested',
      'invitation_rotated',
      'invitation_revoked',
      'invitation_expired',
      'invitation_accepted',
      'retail_business_created'
    )),
  invitation_id uuid,
  business_id uuid,
  reason text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retail_onboarding_audit_metadata_object_chk
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS retail_onboarding_audit_invitation_idx
  ON public.retail_onboarding_audit_events (invitation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS retail_onboarding_audit_business_idx
  ON public.retail_onboarding_audit_events (business_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.finza_retail_onboarding_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'retail onboarding audit events are append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_onboarding_audit_append_only ON public.retail_onboarding_audit_events;
CREATE TRIGGER trg_retail_onboarding_audit_append_only
  BEFORE UPDATE OR DELETE ON public.retail_onboarding_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_retail_onboarding_audit_append_only();

CREATE OR REPLACE FUNCTION public.finza_retail_invitations_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_invitations_updated_at ON public.retail_invitations;
CREATE TRIGGER trg_retail_invitations_updated_at
  BEFORE UPDATE ON public.retail_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_retail_invitations_set_updated_at();

ALTER TABLE public.retail_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.retail_onboarding_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_onboarding_audit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retail_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.retail_invitations FROM anon;
REVOKE ALL ON TABLE public.retail_invitations FROM authenticated;
REVOKE ALL ON TABLE public.retail_onboarding_audit_events FROM PUBLIC;
REVOKE ALL ON TABLE public.retail_onboarding_audit_events FROM anon;
REVOKE ALL ON TABLE public.retail_onboarding_audit_events FROM authenticated;

GRANT ALL ON TABLE public.retail_invitations TO service_role;
GRANT ALL ON TABLE public.retail_onboarding_audit_events TO service_role;

CREATE OR REPLACE FUNCTION public.accept_retail_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email_normalized text,
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.retail_invitations%ROWTYPE;
  v_business_id uuid;
  v_email text;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'retail_invitation_forbidden' USING ERRCODE = '42501';
  END IF;

  v_email := lower(btrim(coalesce(p_email_normalized, '')));
  IF p_user_id IS NULL OR v_email = '' OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'retail_invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_inv
  FROM public.retail_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'retail_invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.status = 'pending' AND v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'retail_invitation_expired' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'retail_invitation_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.email_normalized <> v_email THEN
    RAISE EXCEPTION 'retail_invitation_email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.businesses (
    owner_id,
    name,
    industry,
    onboarding_step,
    service_subscription_status,
    trial_started_at,
    trial_ends_at,
    subscription_started_at,
    current_period_ends_at,
    subscription_grace_until,
    billing_exempt,
    billing_exempt_reason
  ) VALUES (
    p_user_id,
    v_inv.business_name,
    'retail',
    'business_profile',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    false,
    NULL
  )
  RETURNING id INTO v_business_id;

  INSERT INTO public.business_users (
    business_id,
    user_id,
    role,
    email,
    invited_by,
    invited_at
  ) VALUES (
    v_business_id,
    p_user_id,
    'admin',
    v_email,
    v_inv.invited_by_user_id,
    now()
  );

  UPDATE public.retail_invitations
  SET
    status = 'accepted',
    accepted_at = now(),
    accepted_by_user_id = p_user_id,
    accepted_business_id = v_business_id
  WHERE id = v_inv.id
    AND status = 'pending'
    AND token_hash = p_token_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'retail_invitation_race' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.retail_onboarding_audit_events (
    actor_user_id, action, invitation_id, business_id, request_id, metadata
  ) VALUES (
    p_user_id,
    'retail_business_created',
    v_inv.id,
    v_business_id,
    NULLIF(btrim(coalesce(p_request_id, '')), ''),
    jsonb_build_object('industry', 'retail', 'token_version', v_inv.token_version)
  );

  INSERT INTO public.retail_onboarding_audit_events (
    actor_user_id, action, invitation_id, business_id, request_id, metadata
  ) VALUES (
    p_user_id,
    'invitation_accepted',
    v_inv.id,
    v_business_id,
    NULLIF(btrim(coalesce(p_request_id, '')), ''),
    jsonb_build_object('token_version', v_inv.token_version)
  );

  RETURN v_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_retail_invitation(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_retail_invitation(text, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.accept_retail_invitation(text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.accept_retail_invitation(text, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.accept_retail_invitation(text, uuid, text, text) IS
  'Atomically accepts one pending Retail invitation. Locks the invitation row. Creates one retail business and one admin membership, or rolls all of it back.';

COMMENT ON TABLE public.retail_invitations IS
  'Finza-issued Retail owner invitations. Browser roles have no privileges. token_hash is SHA-256 of the raw token.';
