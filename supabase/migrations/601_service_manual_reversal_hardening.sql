-- ============================================================================
-- Production migration 601: Service manual-journal reversal hardening
-- ============================================================================
-- Rebased onto current main after production migration 598.
--
-- Final reversal rules for the Service manual-journal feature, combining the
-- staging 594 single-reversal guard with the staging 599 hardening:
--   * every reversal path rejects a business that differs from the original;
--   * existing-reversal lookups are scoped to the original business;
--   * one deterministic duplicate guard replaces the competing staging guards;
--   * the draft-link trigger is business-scoped and rejects mismatches;
--   * 2150 WHT Payable remains non-postable for manual journals.
--
-- Existing duplicate history is not rewritten. Only new inserts are guarded.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) WHT Payable 2150 is a control account
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_service_manual_control_account(
  p_code TEXT,
  p_is_system BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(p_is_system, FALSE)
    AND COALESCE(p_code, '') IN (
      '1100', '1200', '2000', '2100', '2110', '2120', '2130',
      '2150', -- WHT Payable
      '2155', '2200', '2210', '2220', '2230', '2231', '2232',
      '2240', '2241'
    );
$$;

COMMENT ON FUNCTION public.is_service_manual_control_account(TEXT, BOOLEAN) IS
  'Canonical control-account classifier for Service manual journals. Includes WHT Payable 2150.';

UPDATE public.accounts
SET is_postable = FALSE
WHERE public.is_service_manual_control_account(code, is_system)
  AND is_postable IS DISTINCT FROM FALSE;

-- ----------------------------------------------------------------------------
-- 2) One deterministic reversal guard, business-scoped
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_single_journal_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original_id UUID;
  v_original_business UUID;
  v_original_source TEXT;
  v_existing_reversal UUID;
BEGIN
  IF NEW.reverses_entry_id IS NULL
     AND NOT (NEW.reference_type = 'reversal' AND NEW.reference_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  v_original_id := COALESCE(NEW.reverses_entry_id, NEW.reference_id);

  SELECT je.business_id, je.source_type
  INTO v_original_business, v_original_source
  FROM public.journal_entries je
  WHERE je.id = v_original_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.business_id IS DISTINCT FROM v_original_business THEN
    RAISE EXCEPTION 'REVERSAL_BUSINESS_MISMATCH: reversal business % does not match original business %',
      NEW.business_id, v_original_business
      USING ERRCODE = '42501';
  END IF;

  SELECT je.id INTO v_existing_reversal
  FROM public.journal_entries je
  WHERE je.business_id = v_original_business
    AND (
      je.reverses_entry_id = v_original_id
      OR (je.reference_type = 'reversal' AND je.reference_id = v_original_id)
    )
  ORDER BY je.created_at, je.id
  LIMIT 1;

  IF v_existing_reversal IS NOT NULL AND v_existing_reversal <> NEW.id THEN
    IF v_original_source = 'service_manual' THEN
      RAISE EXCEPTION 'SERVICE_MANUAL_ALREADY_REVERSED: this manual journal has already been reversed'
        USING ERRCODE = '23505',
              DETAIL = v_existing_reversal::text;
    ELSE
      RAISE EXCEPTION 'REVERSAL_ALREADY_EXISTS: journal entry % already has reversal %',
        v_original_id, v_existing_reversal
        USING ERRCODE = '23505',
              DETAIL = v_existing_reversal::text;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prevent_duplicate_service_manual_reversal
  ON public.journal_entries;
DROP TRIGGER IF EXISTS trigger_enforce_single_journal_reversal
  ON public.journal_entries;
CREATE TRIGGER trigger_enforce_single_journal_reversal
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_journal_reversal();

-- ----------------------------------------------------------------------------
-- 3) Draft linkage only within the original journal's business
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_service_manual_draft_reversal_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_original_id UUID;
  v_original_business UUID;
BEGIN
  v_original_id := COALESCE(
    NEW.reverses_entry_id,
    CASE WHEN NEW.reference_type = 'reversal' THEN NEW.reference_id END
  );

  IF v_original_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT je.business_id INTO v_original_business
  FROM public.journal_entries je
  WHERE je.id = v_original_id;

  IF v_original_business IS NULL THEN
    RETURN NEW;
  END IF;

  -- Defense in depth: the BEFORE guard already rejects this. If the guard is
  -- ever disabled, the linkage trigger still refuses to touch another
  -- business's draft.
  IF NEW.business_id IS DISTINCT FROM v_original_business THEN
    RAISE EXCEPTION 'REVERSAL_BUSINESS_MISMATCH: reversal business % does not match original business %',
      NEW.business_id, v_original_business
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.service_manual_journal_drafts
  SET
    status = 'reversed',
    reversal_journal_entry_id = NEW.id,
    updated_at = NOW()
  WHERE journal_entry_id = v_original_id
    AND business_id = v_original_business
    AND status <> 'reversed';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_link_service_manual_draft_reversal
  ON public.journal_entries;
CREATE TRIGGER trigger_link_service_manual_draft_reversal
  AFTER INSERT ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.link_service_manual_draft_reversal_on_insert();

-- ----------------------------------------------------------------------------
-- 4) Service reversal RPC: business-scoped existing lookup and draft update
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

  SELECT je.id INTO v_existing_reversal
  FROM public.journal_entries je
  WHERE je.business_id = v_original.business_id
    AND (
      je.reverses_entry_id = p_journal_entry_id
      OR (je.reference_type = 'reversal' AND je.reference_id = p_journal_entry_id)
    )
  ORDER BY je.created_at
  LIMIT 1;

  IF v_existing_reversal IS NOT NULL THEN
    UPDATE public.service_manual_journal_drafts
    SET
      status = 'reversed',
      reversal_journal_entry_id = v_existing_reversal,
      updated_at = NOW()
    WHERE journal_entry_id = p_journal_entry_id
      AND business_id = v_original.business_id
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
    business_id, date, description, reference, reference_type, reference_id,
    reverses_entry_id, source_type, source_id, period_id, currency, fx_rate,
    created_by, posted_by, posted_by_accountant_id, posting_source,
    is_adjustment, adjustment_reason
  ) VALUES (
    v_original.business_id, p_reversal_date,
    'Reversal of manual journal ' || left(v_original.id::text, 8) || ': ' || BTRIM(p_reason),
    v_original.reference, 'reversal', v_original.id, v_original.id,
    'service_manual_reversal', v_original.id, v_period_id,
    v_original.currency, v_original.fx_rate,
    v_user_id, v_user_id, v_user_id, 'service_manual',
    TRUE, BTRIM(p_reason)
  )
  RETURNING id INTO v_reversal_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  )
  SELECT
    v_reversal_id, line.account_id, line.credit, line.debit,
    COALESCE(NULLIF(line.description, ''), 'Reversal')
  FROM public.journal_entry_lines line
  WHERE line.journal_entry_id = v_original.id;

  UPDATE public.service_manual_journal_drafts
  SET
    status = 'reversed',
    reversal_journal_entry_id = v_reversal_id,
    updated_at = NOW()
  WHERE journal_entry_id = v_original.id
    AND business_id = v_original.business_id;

  RETURN v_reversal_id;
END;
$$;

COMMENT ON FUNCTION public.reverse_service_manual_journal(UUID, DATE, TEXT) IS
  'Service-only, idempotent reversal. Existing reversals are business-scoped; cross-business reversal inserts are rejected.';
