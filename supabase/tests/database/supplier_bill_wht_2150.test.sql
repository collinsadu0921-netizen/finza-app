-- ============================================================================
-- Automated supplier-bill WHT posting to 2150 after the 599 hardening
-- Runs inside one transaction and rolls back all data.
--
-- This exercises the trigger-driven path used by the bill create/update flow,
-- not a direct post_bill_to_ledger() call. It intentionally uses a
-- Professional-tier tenant: migration 598 gates direct authenticated journal
-- posting at Business tier, but automated trigger-driven bill posting must
-- remain available and must still credit WHT Payable 2150.
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
  v_credit_2150 NUMERIC;
  v_credit_2000 NUMERIC;
  v_debit_5200 NUMERIC;
  v_debit NUMERIC;
  v_credit NUMERIC;
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
    v_biz, '599 Automated Bill WHT Test', 'Ghana', 'GHS', 'service', v_owner,
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

  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_amount,
    bill_type, tax_lines
  ) VALUES (
    v_biz, '599 Automated WHT Supplier', 'TEST-WHT-599-AUTO', CURRENT_DATE, CURRENT_DATE, 'draft',
    100, 0, 100, TRUE, 0.05, 5,
    'standard', '[]'::jsonb
  )
  RETURNING id INTO v_bill;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, account_id
  ) VALUES (
    v_bill, '599 automated WHT service', 1, 100, 0, 100, v_chart_5200
  );

  -- The bills page opens a bill after its items exist. This fires
  -- trigger_auto_post_bill -> post_bill_to_ledger().
  UPDATE public.bills SET status = 'open' WHERE id = v_bill;

  SELECT id INTO v_bill_je
  FROM public.journal_entries
  WHERE business_id = v_biz
    AND reference_type = 'bill'
    AND reference_id = v_bill
  LIMIT 1;

  IF v_bill_je IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: automated bill trigger did not post a journal';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN a.code = '2150' THEN l.credit - l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2000' THEN l.credit - l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '5200' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(l.debit), 0),
    COALESCE(SUM(l.credit), 0)
  INTO v_credit_2150, v_credit_2000, v_debit_5200, v_debit, v_credit
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_bill_je;

  IF v_credit_2150 <> 5 THEN
    RAISE EXCEPTION 'TEST_FAILED: automated supplier WHT did not credit 2150 by 5 (got %)', v_credit_2150;
  END IF;
  IF v_credit_2000 <> 95 THEN
    RAISE EXCEPTION 'TEST_FAILED: AP net of WHT was not 95 (got %)', v_credit_2000;
  END IF;
  IF v_debit_5200 <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: expense debit was not 100 (got %)', v_debit_5200;
  END IF;
  IF v_debit <> 100 OR v_credit <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: automated bill journal is not balanced (% / %)', v_debit, v_credit;
  END IF;

  -- Opening the bill again must not double-post.
  UPDATE public.bills SET status = 'open' WHERE id = v_bill;
  IF (SELECT COUNT(*) FROM public.journal_entries
      WHERE business_id = v_biz AND reference_type = 'bill' AND reference_id = v_bill) <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: automated bill posting is not idempotent';
  END IF;

  RAISE NOTICE 'PASS: automated supplier-bill WHT posting to 2150';
END $$;

ROLLBACK;
