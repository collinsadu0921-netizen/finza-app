-- ============================================================================
-- Migration 592: Capture server-derived request metadata on reversal audits
--
-- Pre-591 reversal audits were written by logAudit() from the HTTP route and
-- carried x-forwarded-for / x-real-ip and user-agent. Migration 591 moved the
-- audit into the reversal transaction, but the trigger could not see request
-- metadata.
--
-- This migration keeps the atomic trigger audit and reads request headers from
-- PostgREST's server-side `request.headers` setting. Values are never taken
-- from the request body. Direct SQL/database reversals have no HTTP request
-- headers and therefore keep NULL metadata while still producing the audit row.
--
-- Exactly-once behaviour is unchanged: one audit per inserted reversal JE,
-- none on reuse/retry, and the audit shares the reversal transaction.
-- ============================================================================

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
  v_headers JSONB;
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

  -- PostgREST exposes the inbound request headers to the database transaction.
  -- Direct database sessions legitimately have no such setting.
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  v_request_ip := NULLIF(
    BTRIM(split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1)),
    ''
  );
  IF v_request_ip IS NULL THEN
    v_request_ip := NULLIF(BTRIM(v_headers ->> 'x-real-ip'), '');
  END IF;
  v_user_agent := NULLIF(BTRIM(v_headers ->> 'user-agent'), '');

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
  'Writes exactly one business-scoped audit row in the reversal transaction. Service manual reversals use manual_journal.reversed; other reversals use reversal. Captures PostgREST request IP/user-agent when available; direct database reversals keep NULL metadata.';

REVOKE ALL ON FUNCTION public.audit_journal_reversal_changes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_journal_reversal_changes()
  TO postgres;
