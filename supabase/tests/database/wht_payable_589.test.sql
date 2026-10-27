-- ============================================================================
-- Database tests for migration 589 - WHT Payable (2150)
-- Runs inside one transaction and rolls back all data.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/wht_payable_589.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_account_id UUID;
  v_account_id_retry UUID;
  v_chart_5200 UUID;
  v_bill UUID;
  v_bill_je UUID;
  v_invoice UUID;
  v_payment UUID;
  v_payment_je UUID;
  v_count INT;
  v_amount NUMERIC;
  v_credit_2150 NUMERIC;
  v_credit_2000 NUMERIC;
  v_debit_5200 NUMERIC;
  v_debit_2155 NUMERIC;
  v_debit_cash NUMERIC;
  v_credit_ar NUMERIC;
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
    v_biz, '589 WHT Payable Test', 'Ghana', 'GHS', 'service', v_owner,
    -- Direct post_bill_to_ledger() calls now require Business tier (598).
    -- Automated trigger-driven bill posting is covered by the dedicated
    -- supplier_bill_wht_2150 test for Professional tenants.
    'business', 'active', TRUE, NOW(), NOW()
  );

  -- New-tenant bootstrap must create 2150 in accounts and chart_of_accounts.
  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  SELECT a.id INTO v_account_id
  FROM public.accounts a
  WHERE a.business_id = v_biz AND a.code = '2150' AND a.deleted_at IS NULL;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: new tenant has no accounts row 2150';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.chart_of_accounts c
  WHERE c.business_id = v_biz
    AND c.account_code = '2150'
    AND c.is_active = TRUE
    AND c.account_type = 'liability';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: new tenant chart 2150 active count = %', v_count;
  END IF;

  -- Regression guard: preserve the 566/469 account provisioning while adding 2150.
  SELECT COUNT(*) INTO v_count
  FROM public.accounts a
  WHERE a.business_id = v_biz
    AND a.code IN ('5610', '2231', '2232', '2241');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'TEST_FAILED: 566/469 system accounts regressed (found % of 4)', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.accounts a
  WHERE a.business_id = v_biz
    AND a.code = '2300'
    AND a.sub_type = 'loan';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: 2300 loan sub_type regressed';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.accounts a
  WHERE a.business_id = v_biz
    AND a.code = '2150'
    AND a.sub_type = 'tax_payable';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: 2150 tax_payable sub_type missing';
  END IF;

  -- Repair helper is idempotent and does not duplicate.
  v_account_id_retry := public.ensure_wht_payable_account_id(v_biz);
  IF v_account_id_retry <> v_account_id THEN
    RAISE EXCEPTION 'TEST_FAILED: ensure 2150 returned a different account id';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.accounts a
  WHERE a.business_id = v_biz AND a.code = '2150';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: duplicate 2150 accounts: %', v_count;
  END IF;

  -- Simulate a legacy affected tenant: remove 2150 rows, then repair twice.
  DELETE FROM public.chart_of_accounts
  WHERE business_id = v_biz AND account_code = '2150';
  DELETE FROM public.accounts
  WHERE business_id = v_biz AND code = '2150';

  v_account_id := public.ensure_wht_payable_account_id(v_biz);
  v_account_id_retry := public.ensure_wht_payable_account_id(v_biz);
  IF v_account_id IS NULL OR v_account_id_retry <> v_account_id THEN
    RAISE EXCEPTION 'TEST_FAILED: 2150 repair is not repeatable';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.accounts a
  WHERE a.business_id = v_biz AND a.code = '2150' AND a.deleted_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: repair did not produce exactly one active 2150 account';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.chart_of_accounts c
  WHERE c.business_id = v_biz AND c.account_code = '2150' AND c.is_active = TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: repair did not produce exactly one active 2150 chart row';
  END IF;

  -- Service supplier bill with WHT posts to 2150.
  SELECT c.id INTO v_chart_5200
  FROM public.chart_of_accounts c
  WHERE c.business_id = v_biz AND c.account_code = '5200' AND c.is_active = TRUE;

  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, wht_applicable, wht_rate, wht_amount,
    bill_type, tax_lines
  ) VALUES (
    v_biz, '589 WHT Supplier', 'TEST-WHT-589', CURRENT_DATE, CURRENT_DATE, 'draft',
    100, 0, 100, TRUE, 0.05, 5,
    'standard', '[]'::jsonb
  )
  RETURNING id INTO v_bill;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, account_id
  ) VALUES (
    v_bill, '589 WHT service', 1, 100, 0, 100, v_chart_5200
  );

  v_bill_je := public.post_bill_to_ledger(v_bill);

  SELECT
    COALESCE(SUM(CASE WHEN a.code = '2150' THEN l.credit - l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2000' THEN l.credit - l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '5200' THEN l.debit - l.credit ELSE 0 END), 0)
  INTO v_credit_2150, v_credit_2000, v_debit_5200
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_bill_je;

  IF v_credit_2150 <> 5 THEN
    RAISE EXCEPTION 'TEST_FAILED: supplier WHT did not credit 2150 by 5 (got %)', v_credit_2150;
  END IF;
  IF v_credit_2000 <> 95 THEN
    RAISE EXCEPTION 'TEST_FAILED: AP net of WHT was not 95 (got %)', v_credit_2000;
  END IF;
  IF v_debit_5200 <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: expense debit was not 100 (got %)', v_debit_5200;
  END IF;

  SELECT COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0)
  INTO v_amount, v_credit_2150
  FROM public.journal_entry_lines l
  WHERE l.journal_entry_id = v_bill_je;
  IF v_amount <> 100 OR v_credit_2150 <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: supplier bill journal is not balanced (% / %)',
      v_amount, v_credit_2150;
  END IF;

  -- Customer WHT continues to use 2155, not 2150.
  INSERT INTO public.invoices (
    business_id, invoice_number, issue_date, due_date, status,
    subtotal, total_tax, total,
    wht_receivable_applicable, wht_receivable_rate, wht_receivable_amount
  ) VALUES (
    v_biz, 'TEST-WHT-589-INV', CURRENT_DATE, CURRENT_DATE, 'sent',
    100, 0, 100,
    TRUE, 0.05, 5
  )
  RETURNING id INTO v_invoice;

  INSERT INTO public.payments (
    business_id, invoice_id, amount, date, method, wht_amount
  ) VALUES (
    v_biz, v_invoice, 100, CURRENT_DATE, 'cash', 5
  )
  RETURNING id INTO v_payment;

  SELECT id INTO v_payment_je
  FROM public.journal_entries
  WHERE reference_type = 'payment' AND reference_id = v_payment;

  IF v_payment_je IS NULL THEN
    v_payment_je := public.post_invoice_payment_to_ledger(v_payment);
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN a.code = '2155' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '1000' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '1100' THEN l.credit - l.debit ELSE 0 END), 0)
  INTO v_debit_2155, v_debit_cash, v_credit_ar
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_payment_je;

  IF v_debit_2155 <> 5 THEN
    RAISE EXCEPTION 'TEST_FAILED: customer WHT did not debit 2155 by 5 (got %)', v_debit_2155;
  END IF;
  IF v_debit_cash <> 95 THEN
    RAISE EXCEPTION 'TEST_FAILED: cash received net of WHT was not 95 (got %)', v_debit_cash;
  END IF;
  IF v_credit_ar <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: AR cleared was not 100 (got %)', v_credit_ar;
  END IF;

  RAISE NOTICE 'WHT Payable 2150 tests passed';
END;
$$;

ROLLBACK;
