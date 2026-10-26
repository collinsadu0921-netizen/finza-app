-- ============================================================================
-- Migration 594: Enforce one reversal journal per original journal
--
-- Why:
--   Migration 593 made reversal audit metadata trusted, but the general
--   reversal route still had a pre-check/insert race. Two simultaneous
--   requests could both pass the pre-check and insert two reversal journal
--   entries for the same original. Each reversal had exactly one audit row,
--   but the original was reversed twice.
--
-- This migration:
--   1) Serializes reversal inserts on the original journal row.
--   2) Rejects any new second reversal at the database boundary.
--   3) Makes the service-role reversal wrapper return the existing reversal
--      ID instead of inserting another one.
--
-- Historical duplicates are intentionally left untouched. The new trigger
-- only guards future inserts, so applying this migration does not require
-- deleting or modifying existing accounting records.
--
-- Service manual-journal reversal behavior is unchanged: its RPC still locks
-- the original, recognises an existing generic reversal, and uses its own
-- unique index for service_manual_reversal rows. The audit trigger from
-- migrations 591-593 remains the single atomic audit writer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Idempotent service-role reversal wrapper
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
DECLARE
  v_original_id UUID;
  v_existing_reversal UUID;
BEGIN
  IF p_reference_type = 'reversal' THEN
    v_original_id := COALESCE(p_reverses_entry_id, p_reference_id);

    IF v_original_id IS NOT NULL THEN
      -- Serialize concurrent reversal attempts for this original. The second
      -- transaction waits here, then sees the first transaction's committed
      -- reversal and returns it instead of inserting another journal.
      PERFORM 1
      FROM public.journal_entries
      WHERE id = v_original_id
        AND business_id = p_business_id
      FOR UPDATE;

      IF FOUND THEN
        SELECT je.id INTO v_existing_reversal
        FROM public.journal_entries je
        WHERE je.business_id = p_business_id
          AND je.reference_type = 'reversal'
          AND (
            je.reverses_entry_id = v_original_id
            OR je.reference_id = v_original_id
          )
        ORDER BY je.created_at, je.id
        LIMIT 1;

        IF v_existing_reversal IS NOT NULL THEN
          RETURN v_existing_reversal;
        END IF;
      END IF;
    END IF;
  END IF;

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
) IS 'Service-role-only wrapper carrying trusted request metadata into posting. For reversal postings it serializes on the original journal and returns any existing reversal ID without inserting a duplicate.';

REVOKE ALL ON FUNCTION public.post_journal_entry_with_request_metadata(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_journal_entry_with_request_metadata(
  UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Database-enforced guard for every reversal insert path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_single_journal_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original_id UUID;
  v_business_id UUID;
  v_existing_reversal UUID;
BEGIN
  IF NEW.reference_type IS DISTINCT FROM 'reversal' THEN
    RETURN NEW;
  END IF;

  v_original_id := COALESCE(NEW.reverses_entry_id, NEW.reference_id);
  IF v_original_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- This lock is the database-enforced concurrency boundary. It serializes
  -- all reversal inserts for the same original, including direct RPC and
  -- direct SQL callers that do not use the application wrapper.
  SELECT je.business_id INTO v_business_id
  FROM public.journal_entries je
  WHERE je.id = v_original_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT je.id INTO v_existing_reversal
  FROM public.journal_entries je
  WHERE je.business_id = v_business_id
    AND je.reference_type = 'reversal'
    AND (
      je.reverses_entry_id = v_original_id
      OR je.reference_id = v_original_id
    )
  ORDER BY je.created_at, je.id
  LIMIT 1;

  IF v_existing_reversal IS NOT NULL AND v_existing_reversal <> NEW.id THEN
    RAISE EXCEPTION
      'REVERSAL_ALREADY_EXISTS: journal entry % already has reversal %',
      v_original_id,
      v_existing_reversal
      USING ERRCODE = '23505',
            DETAIL = v_existing_reversal::text;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_single_journal_reversal() IS
  'Prevents a second reversal journal entry for the same original. Locks the original row to serialize concurrent inserts. Historical duplicate reversals are not modified.';

REVOKE ALL ON FUNCTION public.enforce_single_journal_reversal()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_single_journal_reversal()
  TO postgres;

DROP TRIGGER IF EXISTS trigger_enforce_single_journal_reversal
  ON public.journal_entries;
CREATE TRIGGER trigger_enforce_single_journal_reversal
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW
  WHEN (NEW.reference_type = 'reversal')
  EXECUTE FUNCTION public.enforce_single_journal_reversal();
