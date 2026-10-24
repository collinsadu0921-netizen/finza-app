-- ============================================================================
-- Migration 585: Service manual journal reversal linkage + duplicate guard
-- ============================================================================
-- Goals:
--   1. A generic General Ledger reversal and the Service manual-journal
--      reversal must be recognized as the same reversal.
--   2. Existing generic reversals that have reference_type='reversal' and
--      reference_id=original (but reverses_entry_id NULL) are recognized.
--   3. A second reversal of the same Service manual entry is blocked at the
--      database boundary, including concurrent inserts and retries.
--   4. The Service draft is linked to the reversal entry.
--
-- No existing ledger entry is rewritten. Historical generic reversals are
-- recognized by reference_id; a separate approved repair step is required to
-- update historical draft rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Serialize + reject a second reversal of the same Service manual entry
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_duplicate_service_manual_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original_id UUID;
  v_source_type TEXT;
BEGIN
  -- A reversal is identified by either linkage column. This covers the
  -- Service RPC form (reference_type='reversal' + reference_id +
  -- reverses_entry_id) and the legacy generic form (reference_id only).
  IF NEW.reverses_entry_id IS NULL
     AND NOT (NEW.reference_type = 'reversal' AND NEW.reference_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  v_original_id := COALESCE(NEW.reverses_entry_id, NEW.reference_id);

  SELECT je.source_type INTO v_source_type
  FROM public.journal_entries je
  WHERE je.id = v_original_id;

  IF v_source_type IS DISTINCT FROM 'service_manual' THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent reversal attempts for this original entry.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_original_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    WHERE je.reverses_entry_id = v_original_id
       OR (je.reference_type = 'reversal' AND je.reference_id = v_original_id)
  ) THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_ALREADY_REVERSED: this manual journal has already been reversed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prevent_duplicate_service_manual_reversal
  ON public.journal_entries;
CREATE TRIGGER trigger_prevent_duplicate_service_manual_reversal
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_service_manual_reversal();

COMMENT ON FUNCTION public.prevent_duplicate_service_manual_reversal() IS
  'Service manual journals: serialize reversal inserts by original id and reject a second reversal. Generic and Service reversal rows are both recognized.';

CREATE INDEX IF NOT EXISTS idx_journal_entries_reverses_entry_id
  ON public.journal_entries(reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) Link the Service draft to any reversal row (including legacy generic)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_service_manual_draft_reversal_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original_id UUID;
BEGIN
  v_original_id := COALESCE(
    NEW.reverses_entry_id,
    CASE WHEN NEW.reference_type = 'reversal' THEN NEW.reference_id END
  );

  IF v_original_id IS NOT NULL THEN
    UPDATE public.service_manual_journal_drafts
    SET
      status = 'reversed',
      reversal_journal_entry_id = NEW.id,
      updated_at = NOW()
    WHERE journal_entry_id = v_original_id
      AND status <> 'reversed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_link_service_manual_draft_reversal
  ON public.journal_entries;
CREATE TRIGGER trigger_link_service_manual_draft_reversal
  AFTER INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.link_service_manual_draft_reversal_on_insert();

COMMENT ON FUNCTION public.link_service_manual_draft_reversal_on_insert() IS
  'Links a Service manual-journal draft to the reversal row, regardless of whether the reversal came from the Service RPC or the generic GL reversal route.';

-- ----------------------------------------------------------------------------
-- 3) Service reversal RPC recognises reference-based generic reversals
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_service_manual_journal(
  p_journal_entry_id UUID,
  p_reversal_date DATE,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_original RECORD;
  v_existing_reversal UUID;
  v_period_id UUID;
  v_reversal_id UUID;
  v_line_count INTEGER;
BEGIN
  SELECT * INTO v_original
  FROM public.journal_entries
  WHERE id = p_journal_entry_id
    AND source_type = 'service_manual'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_JOURNAL_NOT_FOUND: posted manual journal not found';
  END IF;

  PERFORM public.service_manual_journal_actor_role(v_original.business_id, v_user_id);

  IF NOT public.finza_business_can_write_service_records(v_original.business_id) THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_SUBSCRIPTION_READ_ONLY: financial writes are locked for this business';
  END IF;

  IF NOT public.finza_business_has_service_min_tier(v_original.business_id, 'business') THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_TIER_REQUIRED: the Business plan or higher is required';
  END IF;

  -- Recognise both the Service-linked reversal and an existing generic GL
  -- reversal (reference_type='reversal', reference_id=original, no
  -- reverses_entry_id). Never create a second ledger entry.
  SELECT je.id INTO v_existing_reversal
  FROM public.journal_entries je
  WHERE je.reverses_entry_id = p_journal_entry_id
     OR (je.reference_type = 'reversal' AND je.reference_id = p_journal_entry_id)
  ORDER BY je.created_at
  LIMIT 1;

  IF v_existing_reversal IS NOT NULL THEN
    UPDATE public.service_manual_journal_drafts
    SET
      status = 'reversed',
      reversal_journal_entry_id = v_existing_reversal,
      updated_at = NOW()
    WHERE journal_entry_id = p_journal_entry_id
      AND status <> 'reversed';

    RETURN v_existing_reversal;
  END IF;

  IF p_reason IS NULL OR length(BTRIM(p_reason)) < 10 OR length(BTRIM(p_reason)) > 500 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_REASON_INVALID: reversal reason must be between 10 and 500 characters';
  END IF;

  IF p_reversal_date IS NULL OR p_reversal_date < v_original.date THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_REVERSAL_DATE_INVALID: reversal date must be on or after the original entry date';
  END IF;

  v_period_id := public.service_manual_journal_assert_open_period(v_original.business_id, p_reversal_date);

  SELECT count(*) INTO v_line_count
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_original.id;

  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'SERVICE_MANUAL_JOURNAL_INVALID: original journal has insufficient lines';
  END IF;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference,
    reference_type,
    reference_id,
    reverses_entry_id,
    source_type,
    source_id,
    period_id,
    currency,
    fx_rate,
    created_by,
    posted_by,
    posted_by_accountant_id,
    posting_source,
    is_adjustment,
    adjustment_reason
  ) VALUES (
    v_original.business_id,
    p_reversal_date,
    'Reversal of manual journal ' || left(v_original.id::text, 8) || ': ' || BTRIM(p_reason),
    v_original.reference,
    'reversal',
    v_original.id,
    v_original.id,
    'service_manual_reversal',
    v_original.id,
    v_period_id,
    v_original.currency,
    v_original.fx_rate,
    v_user_id,
    v_user_id,
    v_user_id,
    'service_manual',
    TRUE,
    BTRIM(p_reason)
  )
  RETURNING id INTO v_reversal_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    v_reversal_id,
    line.account_id,
    line.credit,
    line.debit,
    COALESCE(NULLIF(line.description, ''), 'Reversal')
  FROM public.journal_entry_lines line
  WHERE line.journal_entry_id = v_original.id;

  UPDATE public.service_manual_journal_drafts
  SET
    status = 'reversed',
    reversal_journal_entry_id = v_reversal_id,
    updated_at = NOW()
  WHERE journal_entry_id = v_original.id;

  RETURN v_reversal_id;
END;
$$;

COMMENT ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) IS
  'Service-only, idempotent. Recognises both linked and legacy reference-based reversals; never creates a second reversal; links the draft to the existing reversal.';
