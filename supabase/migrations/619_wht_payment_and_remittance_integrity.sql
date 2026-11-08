-- ============================================================================
-- Migration 619: WHT payment validation and atomic remittance
-- ============================================================================
-- Scope:
--   * Constrain payments.wht_amount so it cannot be negative or exceed the
--     gross payment amount.
--   * Prevent a bill from being linked to more than one WHT remittance.
--   * Replace the multi-step remittance API workflow with one atomic RPC that
--     records the remittance, links source bills, marks them remitted, and
--     posts the journal through the existing posting infrastructure.
--
-- Existing rows are not rewritten. The payment checks are added NOT VALID so
-- historical data cannot block the migration; PostgreSQL still enforces them
-- for every new or updated row. The unique bill index is safe because the
-- production snapshot has no duplicate bill links.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Payment WHT bounds
-- ----------------------------------------------------------------------------
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_wht_amount_nonnegative,
  DROP CONSTRAINT IF EXISTS payments_wht_amount_not_above_amount;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_wht_amount_nonnegative
    CHECK (COALESCE(wht_amount, 0) >= 0) NOT VALID,
  ADD CONSTRAINT payments_wht_amount_not_above_amount
    CHECK (COALESCE(wht_amount, 0) <= amount + 0.01) NOT VALID;

COMMENT ON CONSTRAINT payments_wht_amount_nonnegative ON public.payments IS
  'WHT deducted by a customer cannot be negative. Enforced for new/updated rows; existing rows are preserved.';
COMMENT ON CONSTRAINT payments_wht_amount_not_above_amount ON public.payments IS
  'WHT deducted by a customer cannot exceed the gross payment amount. Enforced for new/updated rows; existing rows are preserved.';

-- ----------------------------------------------------------------------------
-- 2) One remittance per bill
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_wht_remittance_bills_bill_id
  ON public.wht_remittance_bills(bill_id);

COMMENT ON INDEX public.ux_wht_remittance_bills_bill_id IS
  'A bill''s WHT can be remitted only once. Retries reuse the existing remittance instead of creating another.';

-- ----------------------------------------------------------------------------
-- 3) Atomic, idempotent WHT remittance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_wht_remittance_atomic(
  p_business_id UUID,
  p_bill_ids UUID[],
  p_remittance_date DATE,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_payment_account_code TEXT DEFAULT '1010'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ids UUID[];
  v_bill RECORD;
  v_found_count INTEGER := 0;
  v_total NUMERIC := 0;
  v_remittance_id UUID;
  v_journal_id UUID;
  v_existing_remittance_id UUID;
  v_existing_link_count INTEGER := 0;
  v_existing_journal_id UUID;
  v_existing_amount NUMERIC;
  v_existing_reference TEXT;
  v_account_id UUID;
  v_reference TEXT;
  v_notes TEXT;
  v_original_role TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_NOT_AUTHORIZED: You must be signed in to remit withholding tax.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_business_id IS NULL THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_INVALID_BUSINESS: business_id is required.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_NOT_AUTHORIZED: You do not have access to this business.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'accounting.view') THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_NOT_AUTHORIZED: Accounting authority is required to remit withholding tax.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_remittance_date IS NULL THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_INVALID_DATE: Remittance date is required.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT ARRAY_AGG(DISTINCT bill_id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_bill_ids, ARRAY[]::UUID[])) AS bill_id
  WHERE bill_id IS NOT NULL;

  IF v_ids IS NULL OR ARRAY_LENGTH(v_ids, 1) = 0 THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_NO_BILLS: Select at least one bill to remit.'
      USING ERRCODE = 'P0001';
  END IF;

  v_reference := NULLIF(BTRIM(COALESCE(p_reference, '')), '');
  v_notes := NULLIF(BTRIM(COALESCE(p_notes, '')), '');

  IF v_reference IS NOT NULL AND LENGTH(v_reference) > 200 THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_INVALID_REFERENCE: Reference must be 200 characters or fewer.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock every source bill for the duration of the transaction. Concurrent
  -- retries serialize here; the second request sees the remitted state.
  FOR v_bill IN
    SELECT b.id, b.issue_date, b.status, b.wht_applicable, b.wht_amount,
           b.wht_remitted_at
    FROM public.bills b
    WHERE b.id = ANY(v_ids)
      AND b.business_id = p_business_id
      AND b.deleted_at IS NULL
    ORDER BY b.id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;

    IF v_bill.wht_remitted_at IS NOT NULL THEN
      CONTINUE;
    END IF;

    IF v_bill.status = 'draft' THEN
      RAISE EXCEPTION
        'WHT_REMITTANCE_BILL_NOT_POSTED: Draft bills cannot be remitted. Post the bill first.'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('bill_id', v_bill.id)::TEXT;
    END IF;

    IF v_bill.wht_applicable IS NOT TRUE OR COALESCE(v_bill.wht_amount, 0) <= 0 THEN
      RAISE EXCEPTION
        'WHT_REMITTANCE_BILL_NOT_ELIGIBLE: Bill % has no positive withholding tax to remit.',
        v_bill.id
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('bill_id', v_bill.id)::TEXT;
    END IF;

    v_total := ROUND(v_total + COALESCE(v_bill.wht_amount, 0), 2);
  END LOOP;

  IF v_found_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_BILL_NOT_FOUND: One or more bills were not found for this business.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total <= 0 THEN
    -- Every requested bill was already remitted. Return the existing
    -- remittance only when one remittance covers the entire request.
    SELECT COUNT(DISTINCT wrb.remittance_id)
    INTO v_existing_link_count
    FROM public.wht_remittance_bills wrb
    JOIN public.wht_remittances wr
      ON wr.id = wrb.remittance_id
    WHERE wrb.bill_id = ANY(v_ids)
      AND wr.business_id = p_business_id;

    IF v_existing_link_count = 1 THEN
      SELECT wrb.remittance_id
      INTO v_existing_remittance_id
      FROM public.wht_remittance_bills wrb
      JOIN public.wht_remittances wr
        ON wr.id = wrb.remittance_id
      WHERE wrb.bill_id = ANY(v_ids)
        AND wr.business_id = p_business_id
      LIMIT 1;

      SELECT wr.journal_entry_id, wr.amount, wr.reference
      INTO v_existing_journal_id, v_existing_amount, v_existing_reference
      FROM public.wht_remittances wr
      WHERE wr.id = v_existing_remittance_id;

      IF v_existing_journal_id IS NULL THEN
        RAISE EXCEPTION
          'WHT_REMITTANCE_LEGACY_WITHOUT_JOURNAL: These bills are linked to a remittance without a journal. Review the remittance before retrying.'
          USING ERRCODE = 'P0001',
                DETAIL = jsonb_build_object('remittance_id', v_existing_remittance_id)::TEXT;
      END IF;

      RETURN jsonb_build_object(
        'reused', TRUE,
        'remittance_id', v_existing_remittance_id,
        'journal_entry_id', v_existing_journal_id,
        'amount', v_existing_amount,
        'reference', v_existing_reference,
        'bill_ids', v_ids
      );
    END IF;

    RAISE EXCEPTION
      'WHT_REMITTANCE_ALREADY_REMITTED: The selected bills have already been remitted.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Partial retry: some requested bills are already linked to another
  -- remittance. Reject rather than silently remitting only part of the request.
  IF v_found_count <> (
    SELECT COUNT(*)::INTEGER
    FROM public.bills b
    WHERE b.id = ANY(v_ids)
      AND b.business_id = p_business_id
      AND b.deleted_at IS NULL
      AND b.wht_remitted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_PARTIAL_ALREADY_REMITTED: Some selected bills have already been remitted. Remove them and retry.'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(p_business_id, p_remittance_date);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION
        'WHT_REMITTANCE_PERIOD_LOCKED: %', SQLERRM
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('remittance_date', p_remittance_date)::TEXT;
  END;

  SELECT a.id
  INTO v_account_id
  FROM public.accounts a
  WHERE a.business_id = p_business_id
    AND a.code = p_payment_account_code
    AND a.deleted_at IS NULL
    AND a.type = 'asset'
    AND (
      COALESCE(LOWER(a.sub_type), '') IN ('cash', 'bank', 'momo', 'mobile_money')
      OR a.code IN ('1000', '1010', '1020')
    )
  LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_INVALID_ACCOUNT: Payment account % is invalid for this business. Choose an active cash, bank, or mobile-money asset account.',
      p_payment_account_code
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.wht_remittances (
    business_id,
    remittance_date,
    amount,
    reference,
    notes,
    created_by
  )
  VALUES (
    p_business_id,
    p_remittance_date,
    v_total,
    v_reference,
    v_notes,
    v_user_id
  )
  RETURNING id INTO v_remittance_id;

  FOR v_bill IN
    SELECT b.id, b.wht_amount
    FROM public.bills b
    WHERE b.id = ANY(v_ids)
      AND b.business_id = p_business_id
      AND b.deleted_at IS NULL
      AND b.wht_remitted_at IS NULL
    ORDER BY b.id
    FOR UPDATE
  LOOP
    INSERT INTO public.wht_remittance_bills (
      remittance_id,
      bill_id,
      wht_amount
    )
    VALUES (
      v_remittance_id,
      v_bill.id,
      ROUND(COALESCE(v_bill.wht_amount, 0), 2)
    );

    UPDATE public.bills
    SET wht_remitted_at = NOW(),
        wht_remittance_ref = v_reference
    WHERE id = v_bill.id
      AND business_id = p_business_id;
  END LOOP;

  -- post_journal_entry() blocks direct authenticated callers below the
  -- Business tier. This SECURITY DEFINER RPC has already checked business
  -- access, accounting authority, source bills and the period lock, so it
  -- posts as the trusted system source for the duration of the call.
  v_original_role := current_setting('request.jwt.claim.role', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    SELECT public.post_wht_remittance_to_ledger(
      v_remittance_id,
      p_payment_account_code
    )
    INTO v_journal_id;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config(
        'request.jwt.claim.role',
        COALESCE(v_original_role, ''),
        true
      );
      RAISE;
  END;
  PERFORM set_config(
    'request.jwt.claim.role',
    COALESCE(v_original_role, ''),
    true
  );

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_LEDGER_FAILED: The remittance journal was not posted. Nothing was committed.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'reused', FALSE,
    'remittance_id', v_remittance_id,
    'journal_entry_id', v_journal_id,
    'amount', v_total,
    'reference', v_reference,
    'bill_ids', v_ids
  );
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent request may have linked one of these bills first. Return
    -- the existing remittance only when it covers every requested bill.
    SELECT COUNT(DISTINCT wrb.remittance_id), COUNT(*)
    INTO v_existing_link_count, v_found_count
    FROM public.wht_remittance_bills wrb
    JOIN public.wht_remittances wr
      ON wr.id = wrb.remittance_id
    WHERE wrb.bill_id = ANY(v_ids)
      AND wr.business_id = p_business_id;

    IF v_existing_link_count = 1 AND v_found_count = ARRAY_LENGTH(v_ids, 1) THEN
      SELECT wrb.remittance_id
      INTO v_existing_remittance_id
      FROM public.wht_remittance_bills wrb
      JOIN public.wht_remittances wr
        ON wr.id = wrb.remittance_id
      WHERE wrb.bill_id = ANY(v_ids)
        AND wr.business_id = p_business_id
      LIMIT 1;

      SELECT wr.journal_entry_id, wr.amount, wr.reference
      INTO v_existing_journal_id, v_existing_amount, v_existing_reference
      FROM public.wht_remittances wr
      WHERE wr.id = v_existing_remittance_id;

      IF v_existing_journal_id IS NULL THEN
        RAISE EXCEPTION
          'WHT_REMITTANCE_LEGACY_WITHOUT_JOURNAL: These bills are linked to a remittance without a journal. Review the remittance before retrying.'
          USING ERRCODE = 'P0001',
                DETAIL = jsonb_build_object('remittance_id', v_existing_remittance_id)::TEXT;
      END IF;

      RETURN jsonb_build_object(
        'reused', TRUE,
        'remittance_id', v_existing_remittance_id,
        'journal_entry_id', v_existing_journal_id,
        'amount', v_existing_amount,
        'reference', v_existing_reference,
        'bill_ids', v_ids
      );
    END IF;

    RAISE;
END;
$$;

COMMENT ON FUNCTION public.create_wht_remittance_atomic(UUID, UUID[], DATE, TEXT, TEXT, TEXT) IS
  'Atomically records a WHT remittance, links and marks source bills, and posts the journal through post_journal_entry. Retries reuse the existing remittance; partial or duplicate remittances are rejected.';

REVOKE ALL ON FUNCTION public.create_wht_remittance_atomic(UUID, UUID[], DATE, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wht_remittance_atomic(UUID, UUID[], DATE, TEXT, TEXT, TEXT)
  TO authenticated;
