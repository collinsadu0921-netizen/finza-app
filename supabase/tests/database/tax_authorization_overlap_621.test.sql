-- ============================================================================
-- Tax authorization and VAT overlap integrity (migration 621)
-- Runs inside one transaction and rolls back all data.
--
-- Covers F-05 (accounting-write authorization at the database boundary),
-- F-03/F-06 (legacy and concurrent overlap protection), and the paid-return
-- payment-journal guard.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_viewer UUID := gen_random_uuid();
  v_biz UUID := gen_random_uuid();
  v_period UUID := gen_random_uuid();
  v_ar UUID;
  v_bank UUID;
  v_vat UUID;
  v_return_a UUID;
  v_return_b UUID;
  v_journal UUID;
  v_count INT;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need an auth.users row';
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (v_viewer, 'viewer-621@example.invalid');
  INSERT INTO public.users (id, email)
  VALUES (v_viewer, 'viewer-621@example.invalid');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (
    id, name, address_country, default_currency, industry, owner_id,
    service_subscription_tier, service_subscription_status, billing_exempt,
    created_at, updated_at
  ) VALUES (
    v_biz, '621 Tax Authorization Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
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

  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id = v_biz AND code = '1100' AND deleted_at IS NULL;
  SELECT id INTO v_bank FROM public.accounts
  WHERE business_id = v_biz AND code = '1010' AND deleted_at IS NULL;
  SELECT id INTO v_vat FROM public.accounts
  WHERE business_id = v_biz AND code = '2100' AND deleted_at IS NULL;

  -- --------------------------------------------------------------------------
  -- 1) Authorization guard: anonymous, non-member, read-only accountant,
  --    service role and owner.
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.finza_assert_accounting_write_authorized(v_biz, 'professional');
    RAISE EXCEPTION 'TEST_FAILED: anonymous accounting write was authorized';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ACCOUNTING_WRITE_UNAUTHORIZED%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  BEGIN
    PERFORM public.finza_assert_accounting_write_authorized(v_biz, 'professional');
    RAISE EXCEPTION 'TEST_FAILED: non-member accounting write was authorized';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ACCOUNTING_WRITE_FORBIDDEN%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.business_users (
    business_id, user_id, role, accountant_readonly
  ) VALUES (
    v_biz, v_viewer, 'accountant', TRUE
  );

  BEGIN
    PERFORM public.finza_assert_accounting_write_authorized(v_biz, 'professional');
    RAISE EXCEPTION 'TEST_FAILED: read-only accountant accounting write was authorized';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ACCOUNTING_WRITE_READ_ONLY%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.finza_assert_accounting_write_authorized(v_biz, 'professional');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.finza_assert_accounting_write_authorized(v_biz, 'professional');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- --------------------------------------------------------------------------
  -- 2) Overlap protection for a normal insert.
  -- --------------------------------------------------------------------------
  INSERT INTO public.vat_returns (
    business_id, period_start_date, period_end_date, status
  ) VALUES (
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
    'draft'
  ) RETURNING id INTO v_return_a;

  BEGIN
    INSERT INTO public.vat_returns (
      business_id, period_start_date, period_end_date, status
    ) VALUES (
      v_biz,
      date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
      'draft'
    );
    RAISE EXCEPTION 'TEST_FAILED: overlapping VAT return was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_RETURN_PERIOD_OVERLAP%' THEN
        RAISE;
      END IF;
  END;

  -- --------------------------------------------------------------------------
  -- 3) Historical overlaps cannot both be submitted. Simulate legacy rows by
  --    inserting them with the overlap trigger disabled, then re-enable it.
  -- --------------------------------------------------------------------------
  ALTER TABLE public.vat_returns DISABLE TRIGGER trg_vat_returns_period_overlap;
  INSERT INTO public.vat_returns (
    business_id, period_start_date, period_end_date, status
  ) VALUES (
    v_biz,
    (date_trunc('month', CURRENT_DATE) - interval '15 days')::date,
    (date_trunc('month', CURRENT_DATE) + interval '14 days')::date,
    'draft'
  ) RETURNING id INTO v_return_b;
  ALTER TABLE public.vat_returns ENABLE TRIGGER trg_vat_returns_period_overlap;

  BEGIN
    UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return_a;
    RAISE EXCEPTION 'TEST_FAILED: legacy overlapping VAT return was submitted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_RETURN_PERIOD_OVERLAP%' THEN
        RAISE;
      END IF;
  END;

  DELETE FROM public.vat_returns WHERE id = v_return_b;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return_a;

  -- --------------------------------------------------------------------------
  -- 4) Payment authorization at the trigger boundary. The linked journal must
  --    be valid so the authorization guard is the rejecting control.
  -- --------------------------------------------------------------------------
  SELECT public.post_journal_entry(
    p_business_id => v_biz,
    p_date => CURRENT_DATE,
    p_description => '621 VAT payment journal fixture',
    p_reference_type => 'vat_return_payment',
    p_reference_id => v_return_a,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_vat, 'debit', 10),
      jsonb_build_object('account_id', v_bank, 'credit', 10)
    ),
    p_created_by => v_owner,
    p_posting_source => 'system'
  ) INTO v_journal;

  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  BEGIN
    UPDATE public.vat_returns
    SET status = 'paid', payment_journal_entry_id = v_journal
    WHERE id = v_return_a;
    RAISE EXCEPTION 'TEST_FAILED: non-member VAT payment transition was authorized';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ACCOUNTING_WRITE_%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  UPDATE public.vat_returns
  SET status = 'paid', payment_journal_entry_id = v_journal
  WHERE id = v_return_a;

  SELECT COUNT(*) INTO v_count
  FROM public.vat_returns
  WHERE id = v_return_a AND status = 'paid' AND payment_journal_entry_id = v_journal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: owner VAT payment transition did not complete';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5) WHT remittance insert authorization.
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  BEGIN
    INSERT INTO public.wht_remittances (
      business_id, remittance_date, amount, created_by
    ) VALUES (
      v_biz, CURRENT_DATE, 5, v_viewer
    );
    RAISE EXCEPTION 'TEST_FAILED: non-member WHT remittance insert was authorized';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ACCOUNTING_WRITE_%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  INSERT INTO public.wht_remittances (
    business_id, remittance_date, amount, created_by
  ) VALUES (
    v_biz, CURRENT_DATE, 5, v_owner
  );

  RAISE NOTICE 'PASS: tax authorization and VAT overlap integrity (621)';
END $$;

ROLLBACK;
