-- Shop #1 staging fixes.
-- 1) accept_retail_invitation guarantees public.users for the invited auth user
--    before businesses.owner_id is written. businesses.owner_id references public.users.
-- 2) sales.payment_method may be 'split' when payment_lines hold the tenders.
-- Independent of the unapplied invoice-settings migrations.

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

  -- Same columns Service and Practice signup insert: id, email, full_name.
  -- Identity is the authenticated user id passed by the service-role caller.
  -- Existing profile for that id is left unchanged. A conflicting email owned
  -- by a different id fails closed without creating a business.
  BEGIN
    INSERT INTO public.users (id, email, full_name)
    VALUES (p_user_id, v_email, '')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'retail_invitation_profile_setup' USING ERRCODE = 'P0001';
  END;

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
  'Atomically accepts one pending Retail invitation. Ensures public.users for the invited auth user, then creates one retail business and one admin membership, or rolls all of it back.';

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash'::text, 'momo'::text, 'card'::text, 'bank'::text, 'split'::text]));
