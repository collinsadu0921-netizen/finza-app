-- ============================================================================
-- Migration 617: Service intent idempotency for loan repayments
-- ============================================================================
-- Prevents duplicate loan repayments when the same request is submitted more
-- than once (double click, retry after a lost response, or concurrent calls).
--
-- The existing post_service_intent_to_ledger RPC remains unchanged. This
-- wrapper atomically claims (business_id, idempotency_key), posts once, and
-- returns the original journal entry on every subsequent retry.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_intent_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  journal_entry_id UUID NULL REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_intent_idempotency_key_length
    CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT service_intent_idempotency_business_key
    UNIQUE (business_id, idempotency_key)
);

ALTER TABLE public.service_intent_idempotency ENABLE ROW LEVEL SECURITY;

-- Only the SECURITY DEFINER wrapper below accesses this table.
REVOKE ALL ON TABLE public.service_intent_idempotency FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.service_intent_idempotency IS
  'Deduplicates service-ledger intent posts (currently loan repayments). One journal entry per business/idempotency key.';

CREATE OR REPLACE FUNCTION public.post_service_intent_to_ledger_idempotent(
  p_business_id UUID,
  p_entry_date DATE,
  p_intent JSONB,
  p_user_id UUID,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
  v_existing UUID;
  v_journal_entry_id UUID;
BEGIN
  IF v_key = '' OR length(v_key) > 128 THEN
    RAISE EXCEPTION 'Invalid idempotency key for service intent';
  END IF;

  -- The unique (business_id, idempotency_key) constraint makes concurrent
  -- submissions serialize here. The losing transaction waits for the winner,
  -- then reads the committed journal entry below.
  INSERT INTO public.service_intent_idempotency (business_id, idempotency_key)
  VALUES (p_business_id, v_key)
  ON CONFLICT (business_id, idempotency_key) DO NOTHING;

  SELECT journal_entry_id
  INTO v_existing
  FROM public.service_intent_idempotency
  WHERE business_id = p_business_id
    AND idempotency_key = v_key
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_journal_entry_id := public.post_service_intent_to_ledger(
    p_business_id,
    p_entry_date,
    p_intent,
    p_user_id
  );

  UPDATE public.service_intent_idempotency
  SET journal_entry_id = v_journal_entry_id
  WHERE business_id = p_business_id
    AND idempotency_key = v_key;

  RETURN v_journal_entry_id;
END;
$$;

COMMENT ON FUNCTION public.post_service_intent_to_ledger_idempotent(UUID, DATE, JSONB, UUID, TEXT) IS
  'Idempotent wrapper around post_service_intent_to_ledger. Reuses the original journal entry for repeated submissions with the same business/idempotency key.';

REVOKE ALL ON FUNCTION public.post_service_intent_to_ledger_idempotent(UUID, DATE, JSONB, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_service_intent_to_ledger_idempotent(UUID, DATE, JSONB, UUID, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
