-- ============================================================================
-- Bill effective-date tax and persisted tax-line ledger parity
-- Runs inside one transaction and rolls back all data.
--
-- Usage:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/bill_tax_lines_effective_date.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_period_2025 UUID := gen_random_uuid();
  v_period_2026 UUID := gen_random_uuid();
  v_chart_5200 UUID;
  v_bill_2025 UUID;
  v_bill_2026 UUID;
  v_je_2025 UUID;
  v_je_2026 UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_debit_5200 NUMERIC;
  v_debit_2100 NUMERIC;
  v_debit_2110 NUMERIC;
  v_debit_2120 NUMERIC;
  v_debit_2130 NUMERIC;
  v_credit_ap NUMERIC;
  v_credit_wht NUMERIC;
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
    v_biz, 'Bill Tax Lines Effective Date Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES
    (v_period_2025, v_biz, DATE '2025-12-01', DATE '2025-12-31', 'open'),
    (v_period_2026, v_biz, DATE '2026-01-01', DATE '2026-01-31', 'open');

  SELECT c.id INTO v_chart_5200
  FROM public.chart_of_accounts c
  WHERE c.business_id = v_biz AND c.account_code = '5200' AND c.is_active = TRUE
  LIMIT 1;

  IF v_chart_5200 IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: chart 5200 missing for new tenant';
  END IF;

  -- Pre-2026 bill: NHIL/GETFund/COVID are absorbed into 5200; VAT is input
  -- tax in 2100. No pre-2026 levy may touch 2110/2120/2130.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, nhil, getfund, covid, vat, total_tax, total,
    bill_type, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
  ) VALUES (
    v_biz, 'Pre-2026 Supplier', 'BILL-TAX-2025', DATE '2025-12-31', DATE '2025-12-31', 'draft',
    100, 2.5, 2.5, 1, 15.9, 21.9, 121.9,
    'standard',
    jsonb_build_object(
      'tax_lines', jsonb_build_array(
        jsonb_build_object('code', 'NHIL', 'amount', 2.5, 'ledger_account_code', '5200', 'ledger_side', 'debit', 'is_creditable_input', false, 'absorbed_to_cost', true),
        jsonb_build_object('code', 'GETFUND', 'amount', 2.5, 'ledger_account_code', '5200', 'ledger_side', 'debit', 'is_creditable_input', false, 'absorbed_to_cost', true),
        jsonb_build_object('code', 'COVID', 'amount', 1, 'ledger_account_code', '5200', 'ledger_side', 'debit', 'is_creditable_input', false, 'absorbed_to_cost', true),
        jsonb_build_object('code', 'VAT', 'amount', 15.9, 'ledger_account_code', '2100', 'ledger_side', 'debit', 'is_creditable_input', true, 'absorbed_to_cost', false)
      ),
      'subtotal_excl_tax', 100,
      'tax_total', 21.9,
      'total_incl_tax', 121.9
    ),
    'ghana', DATE '2025-12-31', 'GH'
  )
  RETURNING id INTO v_bill_2025;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, account_id
  ) VALUES (
    v_bill_2025, 'Pre-2026 service', 1, 100, 0, 100, v_chart_5200
  );

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_2025;

  SELECT id INTO v_je_2025
  FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'bill' AND reference_id = v_bill_2025
  LIMIT 1;

  IF v_je_2025 IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: pre-2026 bill did not post a journal';
  END IF;

  SELECT
    COALESCE(SUM(l.debit), 0),
    COALESCE(SUM(l.credit), 0),
    COALESCE(SUM(CASE WHEN a.code = '5200' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2100' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2110' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2120' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2130' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2000' THEN l.credit - l.debit ELSE 0 END), 0)
  INTO v_debit, v_credit, v_debit_5200, v_debit_2100, v_debit_2110, v_debit_2120, v_debit_2130, v_credit_ap
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_je_2025;

  IF v_debit <> 121.9 OR v_credit <> 121.9 THEN
    RAISE EXCEPTION 'TEST_FAILED: pre-2026 bill journal is not balanced (% / %)', v_debit, v_credit;
  END IF;
  IF v_debit_5200 <> 106 THEN
    RAISE EXCEPTION 'TEST_FAILED: pre-2026 absorbed levies expected 6 in 5200, got %', v_debit_5200 - 100;
  END IF;
  IF v_debit_2100 <> 15.9 THEN
    RAISE EXCEPTION 'TEST_FAILED: pre-2026 VAT input expected 15.9, got %', v_debit_2100;
  END IF;
  IF v_debit_2110 <> 0 OR v_debit_2120 <> 0 OR v_debit_2130 <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: pre-2026 levies were posted to tax control accounts';
  END IF;
  IF v_credit_ap <> 121.9 THEN
    RAISE EXCEPTION 'TEST_FAILED: pre-2026 AP credit expected 121.9, got %', v_credit_ap;
  END IF;

  -- Post-2026 bill: all input tax is creditable; WHT reduces AP and credits 2150.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, nhil, getfund, covid, vat, total_tax, total,
    wht_applicable, wht_rate, wht_amount,
    bill_type, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
  ) VALUES (
    v_biz, 'Post-2026 Supplier', 'BILL-TAX-2026', DATE '2026-01-01', DATE '2026-01-01', 'draft',
    100, 2.5, 2.5, 0, 15, 20, 120,
    TRUE, 0.075, 7.5,
    'standard',
    jsonb_build_object(
      'tax_lines', jsonb_build_array(
        jsonb_build_object('code', 'NHIL', 'amount', 2.5, 'ledger_account_code', '2110', 'ledger_side', 'debit', 'is_creditable_input', true, 'absorbed_to_cost', false),
        jsonb_build_object('code', 'GETFUND', 'amount', 2.5, 'ledger_account_code', '2120', 'ledger_side', 'debit', 'is_creditable_input', true, 'absorbed_to_cost', false),
        jsonb_build_object('code', 'VAT', 'amount', 15, 'ledger_account_code', '2100', 'ledger_side', 'debit', 'is_creditable_input', true, 'absorbed_to_cost', false)
      ),
      'subtotal_excl_tax', 100,
      'tax_total', 20,
      'total_incl_tax', 120
    ),
    'ghana', DATE '2026-01-01', 'GH'
  )
  RETURNING id INTO v_bill_2026;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, account_id
  ) VALUES (
    v_bill_2026, 'Post-2026 service', 1, 100, 0, 100, v_chart_5200
  );

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_2026;

  SELECT id INTO v_je_2026
  FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'bill' AND reference_id = v_bill_2026
  LIMIT 1;

  IF v_je_2026 IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: post-2026 bill did not post a journal';
  END IF;

  SELECT
    COALESCE(SUM(l.debit), 0),
    COALESCE(SUM(l.credit), 0),
    COALESCE(SUM(CASE WHEN a.code = '5200' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2100' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2110' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2120' THEN l.debit - l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2000' THEN l.credit - l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2150' THEN l.credit - l.debit ELSE 0 END), 0)
  INTO v_debit, v_credit, v_debit_5200, v_debit_2100, v_debit_2110, v_debit_2120, v_credit_ap, v_credit_wht
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_je_2026;

  IF v_debit <> 120 OR v_credit <> 120 THEN
    RAISE EXCEPTION 'TEST_FAILED: post-2026 bill journal is not balanced (% / %)', v_debit, v_credit;
  END IF;
  IF v_debit_5200 <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: post-2026 expense expected 100, got %', v_debit_5200;
  END IF;
  IF v_debit_2100 <> 15 OR v_debit_2110 <> 2.5 OR v_debit_2120 <> 2.5 THEN
    RAISE EXCEPTION 'TEST_FAILED: post-2026 input tax control accounts are wrong (% / % / %)',
      v_debit_2100, v_debit_2110, v_debit_2120;
  END IF;
  IF v_credit_ap <> 112.5 OR v_credit_wht <> 7.5 THEN
    RAISE EXCEPTION 'TEST_FAILED: post-2026 AP/WHT split is wrong (% / %)', v_credit_ap, v_credit_wht;
  END IF;

  RAISE NOTICE 'PASS: bill effective-date tax and tax-line ledger parity';
END $$;

ROLLBACK;
