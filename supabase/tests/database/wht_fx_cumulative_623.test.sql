-- ============================================================================
-- FX-aware WHT remittance and stored WHT evidence (migration 623)
-- Runs inside one transaction and rolls back all data.
--
-- Covers F-10 (foreign-currency WHT cleared in GHS with source evidence) and
-- F-19 (stored WHT validated against rate/base before remittance).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_bill UUID;
  v_bad_wht UUID;
  v_missing_fx UUID;
  v_missing_rate UUID;
  v_remittance JSONB;
  v_retry JSONB;
  v_remittance_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC;
  v_source_amount NUMERIC;
  v_source_currency TEXT;
  v_fx NUMERIC;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_debit_2150 NUMERIC;
  v_credit_1010 NUMERIC;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need an auth.users row';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (
    id, name, address_country, default_currency, industry, owner_id,
    service_subscription_tier, service_subscription_status, billing_exempt,
    created_at, updated_at
  ) VALUES (
    v_biz, '623 FX WHT Remittance Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
    'open'
  );

  IF NOT EXISTS (SELECT 1 FROM public.wht_rates WHERE code = 'GH_SVC_5') THEN
    INSERT INTO public.wht_rates (code, name, rate, effective_from, active)
    VALUES ('GH_SVC_5', 'Professional services (historical)', 0.05, DATE '2000-01-01', TRUE);
  END IF;

  ALTER TABLE public.bills DISABLE TRIGGER USER;

  -- USD bill: 100 USD base, 5 USD WHT at 5%, fx_rate 10 -> 50 GHS.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_rate_code,
    wht_amount, bill_type, tax_lines, currency_code, fx_rate,
    home_currency_total
  ) VALUES (
    v_biz, '623 FX Supplier', 'TEST-WHT-623-FX', CURRENT_DATE, CURRENT_DATE, 'open',
    100, 0, 100, TRUE, 0.05, 'GH_SVC_5', 5, 'standard', '[]'::jsonb,
    'USD', 10, 1000
  ) RETURNING id INTO v_bill;

  -- Stored WHT that does not match rate * base.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_rate_code,
    wht_amount, bill_type, tax_lines
  ) VALUES (
    v_biz, '623 Bad WHT Supplier', 'TEST-WHT-623-BAD', CURRENT_DATE, CURRENT_DATE, 'open',
    100, 0, 100, TRUE, 0.05, 'GH_SVC_5', 7, 'standard', '[]'::jsonb
  ) RETURNING id INTO v_bad_wht;

  -- Foreign bill without an exchange rate.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_rate_code,
    wht_amount, bill_type, tax_lines, currency_code, fx_rate
  ) VALUES (
    v_biz, '623 Missing FX Supplier', 'TEST-WHT-623-NOFX', CURRENT_DATE, CURRENT_DATE, 'open',
    100, 0, 100, TRUE, 0.05, 'GH_SVC_5', 5, 'standard', '[]'::jsonb,
    'USD', NULL
  ) RETURNING id INTO v_missing_fx;

  -- Missing rate evidence.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_rate_code,
    wht_amount, bill_type, tax_lines
  ) VALUES (
    v_biz, '623 Missing Rate Supplier', 'TEST-WHT-623-NORATE', CURRENT_DATE, CURRENT_DATE, 'open',
    100, 0, 100, TRUE, NULL, NULL, 5, 'standard', '[]'::jsonb
  ) RETURNING id INTO v_missing_rate;

  ALTER TABLE public.bills ENABLE TRIGGER USER;

  -- Stored WHT evidence is validated before remittance.
  BEGIN
    PERFORM public.create_wht_remittance_atomic(
      v_biz, ARRAY[v_bad_wht], CURRENT_DATE, 'TEST-WHT-623-BAD', NULL, '1010'
    );
    RAISE EXCEPTION 'TEST_FAILED: mismatched stored WHT was remitted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_REMITTANCE_BILL_WHT_MISMATCH%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_wht_remittance_atomic(
      v_biz, ARRAY[v_missing_fx], CURRENT_DATE, 'TEST-WHT-623-NOFX', NULL, '1010'
    );
    RAISE EXCEPTION 'TEST_FAILED: foreign bill without FX was remitted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_REMITTANCE_BILL_FX_MISSING%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.create_wht_remittance_atomic(
      v_biz, ARRAY[v_missing_rate], CURRENT_DATE, 'TEST-WHT-623-NORATE', NULL, '1010'
    );
    RAISE EXCEPTION 'TEST_FAILED: bill without rate evidence was remitted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_REMITTANCE_BILL_WHT_EVIDENCE_MISSING%' THEN
        RAISE;
      END IF;
  END;

  -- FX remittance clears the GHS liability and preserves source evidence.
  v_remittance := public.create_wht_remittance_atomic(
    v_biz, ARRAY[v_bill], CURRENT_DATE, 'TEST-WHT-623-FX', 'FX WHT', '1010'
  );

  IF (v_remittance ->> 'reused')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAILED: first FX WHT remittance was not a new posting';
  END IF;

  v_remittance_id := (v_remittance ->> 'remittance_id')::UUID;
  v_journal_id := (v_remittance ->> 'journal_entry_id')::UUID;

  SELECT amount INTO v_amount
  FROM public.wht_remittances WHERE id = v_remittance_id;
  IF v_amount <> 50 THEN
    RAISE EXCEPTION 'TEST_FAILED: FX remittance amount is %, expected 50 GHS', v_amount;
  END IF;

  SELECT wht_amount, source_wht_amount, source_currency_code, fx_rate
  INTO v_amount, v_source_amount, v_source_currency, v_fx
  FROM public.wht_remittance_bills
  WHERE remittance_id = v_remittance_id AND bill_id = v_bill;

  IF v_amount <> 50 OR v_source_amount <> 5 OR v_source_currency <> 'USD' OR v_fx <> 10 THEN
    RAISE EXCEPTION 'TEST_FAILED: source WHT evidence is wrong (% / % / % / %)',
      v_amount, v_source_amount, v_source_currency, v_fx;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines WHERE journal_entry_id = v_journal_id;
  IF v_debit <> 50 OR v_credit <> 50 THEN
    RAISE EXCEPTION 'TEST_FAILED: FX WHT journal is not balanced (% / %)',
      v_debit, v_credit;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN a.code = '2150' THEN l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '1010' THEN l.credit ELSE 0 END), 0)
  INTO v_debit_2150, v_credit_1010
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal_id;

  IF v_debit_2150 <> 50 OR v_credit_1010 <> 50 THEN
    RAISE EXCEPTION 'TEST_FAILED: FX WHT journal did not clear 2150 and credit 1010 (% / %)',
      v_debit_2150, v_credit_1010;
  END IF;

  -- Retry is idempotent and returns the same GHS amount.
  v_retry := public.create_wht_remittance_atomic(
    v_biz, ARRAY[v_bill], CURRENT_DATE, 'TEST-WHT-623-FX', 'FX WHT', '1010'
  );
  IF (v_retry ->> 'reused')::BOOLEAN IS NOT TRUE
     OR (v_retry ->> 'remittance_id')::UUID <> v_remittance_id
     OR (v_retry ->> 'amount')::NUMERIC <> 50 THEN
    RAISE EXCEPTION 'TEST_FAILED: FX WHT retry was not idempotent';
  END IF;

  RAISE NOTICE 'PASS: FX-aware WHT remittance and stored WHT evidence (623)';
END $$;

ROLLBACK;
