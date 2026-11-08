-- ============================================================================
-- WHT payment validation and atomic remittance (migration 619)
-- Runs inside one transaction and rolls back all data.
--
-- Usage:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/wht_remittance_619.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_period UUID := gen_random_uuid();
  v_chart_5200 UUID;
  v_bill UUID;
  v_bill_je UUID;
  v_draft_bill UUID;
  v_invoice UUID;
  v_remittance JSONB;
  v_remittance_id UUID;
  v_journal_id UUID;
  v_retry JSONB;
  v_count INT;
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

  -- Professional tier proves the atomic RPC can post through the canonical
  -- journal function without requiring the Business tier.
  INSERT INTO public.businesses (
    id, name, address_country, default_currency, industry, owner_id,
    service_subscription_tier, service_subscription_status, billing_exempt,
    created_at, updated_at
  ) VALUES (
    v_biz, '619 WHT Remittance Test', 'Ghana', 'GHS', 'service', v_owner,
    'professional', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES (
    v_period, v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
    'open'
  );

  SELECT c.id INTO v_chart_5200
  FROM public.chart_of_accounts c
  WHERE c.business_id = v_biz AND c.account_code = '5200' AND c.is_active = TRUE
  LIMIT 1;

  IF v_chart_5200 IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: chart 5200 missing for new tenant';
  END IF;

  -- Schema-only clones do not seed the WHT rate table. The remittance RPC now
  -- requires stored rate-code evidence on the source bill.
  IF NOT EXISTS (SELECT 1 FROM public.wht_rates WHERE code = 'GH_SVC_5') THEN
    INSERT INTO public.wht_rates (code, name, rate, effective_from, active)
    VALUES ('GH_SVC_5', 'Professional services (historical)', 0.05, DATE '2000-01-01', TRUE);
  END IF;

  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_rate_code, wht_amount,
    bill_type, tax_lines
  ) VALUES (
    v_biz, '619 WHT Supplier', 'TEST-WHT-619', CURRENT_DATE, CURRENT_DATE, 'draft',
    100, 0, 100, TRUE, 0.05, 'GH_SVC_5', 5,
    'standard', '[]'::jsonb
  )
  RETURNING id INTO v_bill;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, account_id
  ) VALUES (
    v_bill, '619 WHT service', 1, 100, 0, 100, v_chart_5200
  );

  UPDATE public.bills SET status = 'open' WHERE id = v_bill;

  SELECT id INTO v_bill_je
  FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'bill' AND reference_id = v_bill
  LIMIT 1;

  IF v_bill_je IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: bill WHT journal was not posted';
  END IF;

  -- A draft bill cannot be remitted.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_rate_code, wht_amount,
    bill_type, tax_lines
  ) VALUES (
    v_biz, '619 Draft WHT Supplier', 'TEST-WHT-619-DRAFT', CURRENT_DATE, CURRENT_DATE, 'draft',
    100, 0, 100, TRUE, 0.05, 'GH_SVC_5', 5,
    'standard', '[]'::jsonb
  )
  RETURNING id INTO v_draft_bill;

  BEGIN
    PERFORM public.create_wht_remittance_atomic(
      v_biz, ARRAY[v_draft_bill], CURRENT_DATE, 'TEST-DRAFT', NULL, '1010'
    );
    RAISE EXCEPTION 'TEST_FAILED: draft bill remittance was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_REMITTANCE_BILL_NOT_POSTED%' THEN
        RAISE;
      END IF;
  END;

  -- Atomic remittance posts the journal and links the bill.
  v_remittance := public.create_wht_remittance_atomic(
    v_biz, ARRAY[v_bill], CURRENT_DATE, 'TEST-WHT-REF', 'March WHT', '1010'
  );

  IF (v_remittance ->> 'reused')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAILED: first WHT remittance was not a new posting';
  END IF;

  v_remittance_id := (v_remittance ->> 'remittance_id')::UUID;
  v_journal_id := (v_remittance ->> 'journal_entry_id')::UUID;

  IF v_remittance_id IS NULL OR v_journal_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT remittance did not return a linked journal';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.bills
  WHERE id = v_bill AND wht_remitted_at IS NOT NULL AND wht_remittance_ref = 'TEST-WHT-REF';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: bill was not marked remitted';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.wht_remittance_bills
  WHERE remittance_id = v_remittance_id AND bill_id = v_bill AND wht_amount = 5;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: source bill link is missing or wrong';
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_journal_id;

  IF v_debit <> 5 OR v_credit <> 5 THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT remittance journal is not balanced (% / %)', v_debit, v_credit;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN a.code = '2150' THEN l.debit ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN a.code = '1010' THEN l.credit ELSE 0 END), 0)
  INTO v_debit_2150, v_credit_1010
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal_id;

  IF v_debit_2150 <> 5 OR v_credit_1010 <> 5 THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT journal did not clear 2150 and credit 1010';
  END IF;

  -- Retry is idempotent: same remittance and journal, no new rows.
  v_retry := public.create_wht_remittance_atomic(
    v_biz, ARRAY[v_bill], CURRENT_DATE, 'TEST-WHT-REF', 'March WHT', '1010'
  );

  IF (v_retry ->> 'reused')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT remittance retry was not idempotent';
  END IF;
  IF (v_retry ->> 'remittance_id')::UUID <> v_remittance_id THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT retry returned a different remittance';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.wht_remittances WHERE business_id = v_biz;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT retry created % remittances', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'wht_remittance' AND reference_id = v_remittance_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT retry created % journals', v_count;
  END IF;

  -- A bill cannot be linked to a second remittance.
  BEGIN
    INSERT INTO public.wht_remittance_bills (remittance_id, bill_id, wht_amount)
    VALUES (v_remittance_id, v_bill, 5);
    RAISE EXCEPTION 'TEST_FAILED: duplicate bill link was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  -- Unknown / cross-tenant bill ids are rejected.
  BEGIN
    PERFORM public.create_wht_remittance_atomic(
      v_biz, ARRAY[gen_random_uuid()], CURRENT_DATE, 'TEST-MISSING', NULL, '1010'
    );
    RAISE EXCEPTION 'TEST_FAILED: unknown bill remittance was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_REMITTANCE_BILL_NOT_FOUND%' THEN
        RAISE;
      END IF;
  END;

  -- Payment WHT bounds and cumulative entitlement are enforced at the
  -- database boundary. Ledger posting is unrelated to this guard, so the
  -- posting/status triggers are disabled for this fixture only.
  ALTER TABLE public.payments DISABLE TRIGGER trigger_auto_post_payment;
  ALTER TABLE public.payments DISABLE TRIGGER trigger_partial_payment_alert;
  ALTER TABLE public.payments DISABLE TRIGGER trigger_update_invoice_status;

  INSERT INTO public.invoices (
    business_id, wht_receivable_applicable, wht_receivable_amount
  ) VALUES (
    v_biz, TRUE, 5
  ) RETURNING id INTO v_invoice;

  BEGIN
    INSERT INTO public.payments (business_id, invoice_id, amount, date, method, wht_amount)
    VALUES (v_biz, v_invoice, 10, CURRENT_DATE, 'cash', 20);
    RAISE EXCEPTION 'TEST_FAILED: payment WHT above amount was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_PAYMENT_EXCEEDS_AMOUNT%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.payments (business_id, invoice_id, amount, date, method, wht_amount)
  VALUES (v_biz, v_invoice, 50, CURRENT_DATE, 'cash', 5);

  BEGIN
    INSERT INTO public.payments (business_id, invoice_id, amount, date, method, wht_amount)
    VALUES (v_biz, v_invoice, 10, CURRENT_DATE, 'cash', 1);
    RAISE EXCEPTION 'TEST_FAILED: cumulative payment WHT above invoice entitlement was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%WHT_PAYMENT_CUMULATIVE_EXCEEDED%' THEN
        RAISE;
      END IF;
  END;

  ALTER TABLE public.payments ENABLE TRIGGER trigger_auto_post_payment;
  ALTER TABLE public.payments ENABLE TRIGGER trigger_partial_payment_alert;
  ALTER TABLE public.payments ENABLE TRIGGER trigger_update_invoice_status;

  RAISE NOTICE 'PASS: WHT payment validation and atomic remittance (619)';
END $$;

ROLLBACK;
