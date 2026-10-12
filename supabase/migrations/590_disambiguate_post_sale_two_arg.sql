-- ============================================================================
-- Migration 590: disambiguate the two-argument sale poster
-- ============================================================================
-- The two-argument post_sale_to_ledger(uuid, uuid) forwarded with four named
-- arguments. That call matches both the four-argument overload and the
-- five-argument overload, because the fifth argument has a default.
-- The ambiguity has existed since the five-argument function gained that
-- default. Migration 589 kept both signatures, so the call stayed ambiguous.
--
-- This replaces only the two-argument body. The public signature is unchanged.
-- p_posted_by_accountant_id stays unused, which is the existing wrapper
-- contract. The call goes to post_sale_to_ledger_pkgb_body4 by its unique
-- name, after the same live-journal check the four-argument wrapper uses.
-- The four-argument and five-argument functions are not replaced.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_sale_to_ledger(
  p_sale_id uuid,
  p_posted_by_accountant_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_existing uuid;
BEGIN
  SELECT s.business_id
  INTO v_business_id
  FROM public.sales s
  WHERE s.id = p_sale_id;

  IF v_business_id IS NOT NULL THEN
    v_existing := public.assert_one_live_source_journal(v_business_id, 'sale', p_sale_id);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN public.post_sale_to_ledger_pkgb_body4(
    p_sale_id,
    NULL::text,
    NULL::text,
    NULL::text
  );
END;
$$;

COMMENT ON FUNCTION public.post_sale_to_ledger(uuid, uuid) IS
  'Backward-compatible sale poster. The accountant id is not forwarded. Resolves to the four-argument financial body by name so the five-argument overload is not a candidate. Returns the live sale journal when one already exists.';

GRANT EXECUTE ON FUNCTION public.post_sale_to_ledger(uuid, uuid) TO PUBLIC, anon, authenticated, service_role;
