-- ============================================================================
-- Migration 593: Trusted request metadata for reversal audit rows
--
-- Correction to migration 592:
--   PostgREST request.headers are the headers of the HTTP request received by
--   PostgREST, not the browser request. For application RPC calls that is the
--   Next.js/Supabase server request (user-agent: node, server IP). For direct
--   RPC calls those headers are entirely caller-controlled.
--
-- This migration:
--   1) Stops reading PostgREST request.headers in the reversal audit trigger.
--   2) Creates service-role-only wrappers that accept trusted metadata from
--      the authenticated Next.js route and set transaction-local settings.
--   3) Keeps the trigger audit atomic and exactly-once.
--
-- Direct calls to the existing reversal functions cannot set the trusted
-- settings, so they produce an audit row with NULL request metadata rather
-- than spoofable values.
--
-- No historical rows are backfilled. No journal balances change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Reversal audit trigger reads only transaction-local trusted metadata
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_journal_reversal_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original public.journal_entries%ROWTYPE;
  v_original_id UUID;
  v_business_id UUID;
  v_action_type TEXT;
  v_reason TEXT;
  v_new_values JSONB;
  v_request_ip TEXT;
  v_user_agent TEXT;
BEGIN
  IF NEW.reference_type IS DISTINCT FROM 'reversal' THEN
    RETURN NEW;
  END IF;

  v_original_id := COALESCE(NEW.reverses_entry_id, NEW.reference_id);
  IF v_original_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_original
  FROM public.journal_entries
  WHERE id = v_original_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Only the service-role wrappers below set these transaction-local values.
  -- Direct RPC and direct database reversals leave them unset -> NULL metadata.
  v_request_ip := NULLIF(BTRIM(current_setting('finza.request_ip', true)), '');
  v_user_agent := NULLIF(BTRIM(current_setting('finza.request_user_agent', true)), '');

  v_business_id := COALESCE(NEW.business_id, v_original.business_id);
  v_action_type := CASE
    WHEN v_original.source_type = 'service_manual'
      THEN 'manual_journal.reversed'
    ELSE 'reversal'
  END;

  v_reason := COALESCE(
    NULLIF(BTRIM(NEW.adjustment_reason), ''),
    NULLIF(BTRIM(NEW.description), ''),
    'Journal entry reversed'
  );

  v_new_values := jsonb_build_object(
    'original_journal_entry_id', v_original.id,
    'reversal_journal_entry_id', NEW.id,
    'business_id', v_business_id,
    'period_id', NEW.period_id,
    'source_type', v_original.source_type,
    'reference', v_original.reference,
    'original_description', v_original.description,
    'reason', v_reason
  );

  PERFORM public.create_audit_log(
    v_business_id,
    NEW.created_by,
    v_action_type,
    'journal_entry',
    v_original.id,
    NULL,
    v_new_values,
    v_request_ip,
    v_user_agent,
    v_reason
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.audit_journal_reversal_changes() IS
  'Writes exactly one business-scoped audit row in the reversal transaction. Service manual reversals use manual_journal.reversed; other reversals use reversal. Request metadata comes only from transaction-local settings set by service-role wrappers; direct callers get NULL metadata.';

REVOKE ALL ON FUNCTION public.audit_journal_reversal_changes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_journal_reversal_changes()
  TO postgres;

-- ---------------------------------------------------------------------------
-- 2) Service-role-only wrapper for the general reversal path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_entry_with_request_metadata(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN,
  p_adjustment_reason TEXT,
  p_adjustment_ref TEXT,
  p_created_by UUID,
  p_entry_type TEXT,
  p_backfill_reason TEXT,
  p_backfill_actor TEXT,
  p_posted_by_accountant_id UUID,
  p_posting_source TEXT,
  p_is_revenue_correction BOOLEAN,
  p_reverses_entry_id UUID,
  p_request_ip TEXT,
  p_request_user_agent TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_created_by IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', p_created_by::text, true);
  END IF;
  PERFORM set_config('finza.request_ip', COALESCE(BTRIM(p_request_ip), ''), true);
  PERFORM set_config('finza.request_user_agent', COALESCE(BTRIM(p_request_user_agent), ''), true);

  RETURN public.post_journal_entry(
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_lines,
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_created_by,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    p_posted_by_accountant_id,
    p_posting_source,
    p_is_revenue_correction,
    p_reverses_entry_id
  );
END;
$$;

COMMENT ON FUNCTION public.post_journal_entry_with_request_metadata(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT
) IS 'Service-role-only wrapper that carries trusted Next.js request metadata into the same posting transaction.';

REVOKE ALL ON FUNCTION public.post_journal_entry_with_request_metadata(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_journal_entry_with_request_metadata(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Service-role-only wrapper for the Service manual-journal reversal path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_service_manual_journal_with_request_metadata(
  p_journal_entry_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_actor_user_id UUID,
  p_request_ip TEXT,
  p_request_user_agent TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_UNAUTHORIZED: authenticated actor is required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('finza.request_ip', COALESCE(BTRIM(p_request_ip), ''), true);
  PERFORM set_config('finza.request_user_agent', COALESCE(BTRIM(p_request_user_agent), ''), true);

  RETURN public.reverse_service_manual_journal(
    p_journal_entry_id,
    p_reversal_date,
    p_reason
  );
END;
$$;

COMMENT ON FUNCTION public.reverse_service_manual_journal_with_request_metadata(
  UUID, DATE, TEXT, UUID, TEXT, TEXT
) IS 'Service-role-only wrapper carrying trusted Next.js request metadata into the atomic Service manual-journal reversal transaction.';

REVOKE ALL ON FUNCTION public.reverse_service_manual_journal_with_request_metadata(
  UUID, DATE, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_service_manual_journal_with_request_metadata(
  UUID, DATE, TEXT, UUID, TEXT, TEXT
) TO service_role;
