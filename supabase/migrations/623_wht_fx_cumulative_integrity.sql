-- ============================================================================
-- Migration 623: FX-aware WHT remittance and cumulative payment WHT guard
-- ============================================================================
-- Scope:
--   * Store remittance amounts in the business home currency while preserving
--     source-currency WHT evidence (F-10).
--   * Validate stored bill WHT against its rate/base before remittance (F-19).
--   * Enforce cumulative customer-payment WHT at the database boundary with
--     invoice-row locking (F-11).
--
-- Existing rows are not rewritten. Existing remittance links keep their
-- historical wht_amount; new links store both GHS and source-currency values.
-- ============================================================================

ALTER TABLE public.wht_remittance_bills
  ADD COLUMN IF NOT EXISTS source_wht_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS source_currency_code TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC;

COMMENT ON COLUMN public.wht_remittance_bills.wht_amount IS
  'WHT amount in the business home currency (GHS for Ghana tenants).';
COMMENT ON COLUMN public.wht_remittance_bills.source_wht_amount IS
  'WHT amount in the source bill currency. Equal to wht_amount for home-currency bills.';
COMMENT ON COLUMN public.wht_remittance_bills.source_currency_code IS
  'Source bill currency code, when the bill was recorded in a foreign currency.';
COMMENT ON COLUMN public.wht_remittance_bills.fx_rate IS
  'Bill FX rate used to convert source WHT to the home currency.';

-- ----------------------------------------------------------------------------
-- Cumulative customer-payment WHT guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_cumulative_payment_wht()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invoice RECORD;
  v_prior NUMERIC := 0;
BEGIN
  IF COALESCE(NEW.wht_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.invoice_id IS NULL OR NEW.business_id IS NULL THEN
    RAISE EXCEPTION
      'WHT_PAYMENT_INVOICE_REQUIRED: a WHT-bearing payment must reference an invoice'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT i.id, i.business_id, i.wht_receivable_applicable, i.wht_receivable_amount
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = NEW.invoice_id
    AND i.business_id = NEW.business_id
    AND i.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'WHT_PAYMENT_INVOICE_NOT_FOUND: the invoice does not belong to this business'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_invoice.wht_receivable_applicable IS NOT TRUE THEN
    RAISE EXCEPTION
      'WHT_PAYMENT_NOT_APPLICABLE: this invoice does not have customer withholding tax'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.wht_amount > COALESCE(NEW.amount, 0) + 0.01 THEN
    RAISE EXCEPTION
      'WHT_PAYMENT_EXCEEDS_AMOUNT: WHT cannot exceed the gross payment amount'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(p.wht_amount), 0)
  INTO v_prior
  FROM public.payments p
  WHERE p.invoice_id = NEW.invoice_id
    AND p.deleted_at IS NULL
    AND p.id <> NEW.id;

  IF ROUND(v_prior + NEW.wht_amount, 2) >
     ROUND(COALESCE(v_invoice.wht_receivable_amount, 0), 2) + 0.01 THEN
    RAISE EXCEPTION
      'WHT_PAYMENT_CUMULATIVE_EXCEEDED: cumulative WHT % exceeds the invoice entitlement %',
      ROUND(v_prior + NEW.wht_amount, 2),
      ROUND(COALESCE(v_invoice.wht_receivable_amount, 0), 2)
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'invoice_id', NEW.invoice_id,
              'prior_wht', ROUND(v_prior, 2),
              'requested_wht', ROUND(NEW.wht_amount, 2),
              'invoice_wht', ROUND(COALESCE(v_invoice.wht_receivable_amount, 0), 2)
            )::TEXT;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cumulative_payment_wht()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_cumulative_payment_wht()
  TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_cumulative_payment_wht ON public.payments;
CREATE TRIGGER trg_enforce_cumulative_payment_wht
  BEFORE INSERT OR UPDATE OF wht_amount, amount, invoice_id ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cumulative_payment_wht();

-- ----------------------------------------------------------------------------
-- FX-aware, WHT-evidence-aware remittance RPC
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
  v_home_currency TEXT;
  v_ids UUID[];
  v_bill RECORD;
  v_found_count INTEGER := 0;
  v_total NUMERIC := 0;
  v_bill_wht_ghs NUMERIC;
  v_expected_wht_doc NUMERIC;
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

  SELECT COALESCE(default_currency, 'GHS')
  INTO v_home_currency
  FROM public.businesses
  WHERE id = p_business_id;

  v_home_currency := COALESCE(v_home_currency, 'GHS');

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

  FOR v_bill IN
    SELECT b.id, b.issue_date, b.status, b.wht_applicable, b.wht_amount,
           b.wht_remitted_at, b.subtotal, b.wht_rate, b.wht_rate_code,
           b.currency_code, b.fx_rate
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

    IF v_bill.wht_rate IS NULL
       OR v_bill.wht_rate <= 0
       OR v_bill.subtotal IS NULL
       OR v_bill.wht_rate_code IS NULL THEN
      RAISE EXCEPTION
        'WHT_REMITTANCE_BILL_WHT_EVIDENCE_MISSING: Bill % has no rate/base evidence for its stored WHT.',
        v_bill.id
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('bill_id', v_bill.id)::TEXT;
    END IF;

    v_expected_wht_doc := ROUND(COALESCE(v_bill.subtotal, 0) * v_bill.wht_rate, 2);
    IF ABS(v_expected_wht_doc - COALESCE(v_bill.wht_amount, 0)) > 0.02 THEN
      RAISE EXCEPTION
        'WHT_REMITTANCE_BILL_WHT_MISMATCH: Bill % stored WHT % does not match rate % on base % (expected %).',
        v_bill.id, v_bill.wht_amount, v_bill.wht_rate, v_bill.subtotal, v_expected_wht_doc
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'bill_id', v_bill.id,
                'stored_wht', v_bill.wht_amount,
                'rate', v_bill.wht_rate,
                'base', v_bill.subtotal,
                'expected_wht', v_expected_wht_doc
              )::TEXT;
    END IF;

    IF v_bill.currency_code IS NOT NULL
       AND v_bill.currency_code <> v_home_currency
       AND COALESCE(v_bill.fx_rate, 0) <= 0 THEN
      RAISE EXCEPTION
        'WHT_REMITTANCE_BILL_FX_MISSING: Bill % is in % but has no valid exchange rate.',
        v_bill.id, v_bill.currency_code
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'bill_id', v_bill.id,
                'currency_code', v_bill.currency_code
              )::TEXT;
    END IF;

    v_bill_wht_ghs := CASE
      WHEN v_bill.currency_code IS NOT NULL AND COALESCE(v_bill.fx_rate, 0) > 0
        THEN ROUND(COALESCE(v_bill.wht_amount, 0) * v_bill.fx_rate, 2)
      ELSE ROUND(COALESCE(v_bill.wht_amount, 0), 2)
    END;

    v_total := ROUND(v_total + v_bill_wht_ghs, 2);
  END LOOP;

  IF v_found_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION
      'WHT_REMITTANCE_BILL_NOT_FOUND: One or more bills were not found for this business.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total <= 0 THEN
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
    SELECT b.id, b.wht_amount, b.currency_code, b.fx_rate
    FROM public.bills b
    WHERE b.id = ANY(v_ids)
      AND b.business_id = p_business_id
      AND b.deleted_at IS NULL
      AND b.wht_remitted_at IS NULL
    ORDER BY b.id
    FOR UPDATE
  LOOP
    v_bill_wht_ghs := CASE
      WHEN v_bill.currency_code IS NOT NULL AND COALESCE(v_bill.fx_rate, 0) > 0
        THEN ROUND(COALESCE(v_bill.wht_amount, 0) * v_bill.fx_rate, 2)
      ELSE ROUND(COALESCE(v_bill.wht_amount, 0), 2)
    END;

    INSERT INTO public.wht_remittance_bills (
      remittance_id,
      bill_id,
      wht_amount,
      source_wht_amount,
      source_currency_code,
      fx_rate
    )
    VALUES (
      v_remittance_id,
      v_bill.id,
      v_bill_wht_ghs,
      ROUND(COALESCE(v_bill.wht_amount, 0), 2),
      v_bill.currency_code,
      v_bill.fx_rate
    );

    UPDATE public.bills
    SET wht_remitted_at = NOW(),
        wht_remittance_ref = v_reference
    WHERE id = v_bill.id
      AND business_id = p_business_id;
  END LOOP;

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
  'Atomically records a GHS WHT remittance while preserving source-currency evidence, validates stored bill WHT against rate/base, links and marks source bills, and posts the journal. Retries reuse the existing remittance.';

REVOKE ALL ON FUNCTION public.create_wht_remittance_atomic(UUID, UUID[], DATE, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wht_remittance_atomic(UUID, UUID[], DATE, TEXT, TEXT, TEXT)
  TO authenticated;
