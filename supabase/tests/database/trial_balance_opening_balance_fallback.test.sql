-- ============================================================================
-- Database tests for migration 586 — Trial Balance opening-balance fallback
-- Runs inside one transaction and rolls back all data.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_prior_period UUID := gen_random_uuid();
  v_current_period UUID := gen_random_uuid();
  v_cash UUID := gen_random_uuid();
  v_revenue UUID := gen_random_uuid();
  v_expense UUID := gen_random_uuid();
  v_prior_entry UUID := gen_random_uuid();
  v_current_entry UUID := gen_random_uuid();
  v_tb JSONB;
  v_cash_row JSONB;
  v_revenue_row JSONB;
  v_expense_row JSONB;
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
    v_biz, '586 Opening Balance Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  INSERT INTO public.accounts (id, business_id, name, code, type, sub_type, is_system)
  VALUES
    (v_cash, v_biz, 'Cash', '1000', 'asset', NULL, TRUE),
    (v_revenue, v_biz, 'Service Revenue', '4000', 'income', NULL, TRUE),
    (v_expense, v_biz, 'Operating Expenses', '5100', 'expense', NULL, TRUE);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES
    (v_prior_period, v_biz, DATE '2026-09-01', DATE '2026-09-30', 'open'),
    (v_current_period, v_biz, DATE '2026-10-01', DATE '2026-10-31', 'open');

  INSERT INTO public.journal_entries (
    id, business_id, date, description, reference_type, period_id, currency, fx_rate,
    created_by, posted_by, posted_by_accountant_id, posting_source, is_adjustment
  ) VALUES
    (v_prior_entry, v_biz, DATE '2026-09-15', 'Prior revenue', NULL, v_prior_period, 'GHS', 1,
     v_owner, v_owner, v_owner, 'service_manual', FALSE),
    (v_current_entry, v_biz, DATE '2026-10-10', 'Current expense', NULL, v_current_period, 'GHS', 1,
     v_owner, v_owner, v_owner, 'service_manual', FALSE);

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit)
  VALUES
    (v_prior_entry, v_cash, 1000, 0),
    (v_prior_entry, v_revenue, 0, 1000),
    (v_current_entry, v_expense, 200, 0),
    (v_current_entry, v_cash, 0, 200);

  -- No period_opening_balances rows are inserted: exercise the ledger fallback.
  v_tb := public.generate_trial_balance(v_current_period, v_owner);

  SELECT value INTO v_cash_row
  FROM jsonb_array_elements(v_tb->'accounts') WHERE value->>'account_code' = '1000';
  SELECT value INTO v_revenue_row
  FROM jsonb_array_elements(v_tb->'accounts') WHERE value->>'account_code' = '4000';
  SELECT value INTO v_expense_row
  FROM jsonb_array_elements(v_tb->'accounts') WHERE value->>'account_code' = '5100';

  IF (v_cash_row->>'opening_balance')::numeric <> 1000 THEN
    RAISE EXCEPTION 'TEST_FAILED: cash opening balance %, expected 1000', v_cash_row->>'opening_balance';
  END IF;
  IF (v_cash_row->>'closing_balance')::numeric <> 800 THEN
    RAISE EXCEPTION 'TEST_FAILED: cash closing balance %, expected 800', v_cash_row->>'closing_balance';
  END IF;
  IF (v_revenue_row->>'opening_balance')::numeric <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: income opening balance %, expected 0', v_revenue_row->>'opening_balance';
  END IF;
  -- Prior-period income must not carry into the current period.
  IF (v_revenue_row->>'closing_balance')::numeric <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: income closing balance %, expected 0', v_revenue_row->>'closing_balance';
  END IF;
  IF (v_expense_row->>'opening_balance')::numeric <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: expense opening balance %, expected 0', v_expense_row->>'opening_balance';
  END IF;
  IF (v_expense_row->>'closing_balance')::numeric <> 200 THEN
    RAISE EXCEPTION 'TEST_FAILED: expense closing balance %, expected 200', v_expense_row->>'closing_balance';
  END IF;
  IF (v_tb->>'total_debits')::numeric <> 200 OR (v_tb->>'total_credits')::numeric <> 200 THEN
    RAISE EXCEPTION 'TEST_FAILED: period totals %, %', v_tb->>'total_debits', v_tb->>'total_credits';
  END IF;

  RAISE NOTICE 'PASS: 586 Trial Balance opening-balance fallback';
END $$;

ROLLBACK;
