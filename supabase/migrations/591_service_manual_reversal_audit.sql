-- ============================================================================
-- Migration 591: Atomic audit event for journal reversals
--
-- Why:
--   - The Service manual-journal reversal RPC created a reversal journal entry
--     but wrote no audit row.
--   - The generic accounting reversal route wrote its audit row after posting
--     as a best-effort API call. A failure there could leave a reversal with no
--     audit event.
--
-- This migration writes the audit row in the same transaction as the reversal
-- journal entry. It covers both reversal paths:
--   1) Service manual journals -> reverse_service_manual_journal()
--   2) General Journal Entries -> post_journal_entry(reference_type='reversal')
--
-- Guarantees:
--   - exactly one audit row per newly inserted reversal journal entry
--   - no audit row when an existing reversal is reused
--   - no duplicate audit row for retries/concurrent attempts, because only the
--     transaction that successfully inserts the reversal fires AFTER INSERT
--   - Service manual reversals use action_type 'manual_journal.reversed'
--   - other reversals use action_type 'reversal'
--
-- No historical rows are backfilled or rewritten. No journal balances change.
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
    NULL,
    NULL,
    v_reason
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.audit_journal_reversal_changes() IS
  'Writes exactly one business-scoped audit row in the reversal transaction. Service manual reversals use manual_journal.reversed; other reversals use reversal.';

REVOKE ALL ON FUNCTION public.audit_journal_reversal_changes()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_journal_reversal_changes()
  TO postgres;

DROP TRIGGER IF EXISTS trigger_audit_journal_reversal
  ON public.journal_entries;
CREATE TRIGGER trigger_audit_journal_reversal
  AFTER INSERT ON public.journal_entries
  FOR EACH ROW
  WHEN (NEW.reference_type = 'reversal')
  EXECUTE FUNCTION public.audit_journal_reversal_changes();
