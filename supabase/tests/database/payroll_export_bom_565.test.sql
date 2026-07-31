-- ============================================================================
-- Database tests for migration 565 — UTF-8 BOM download-event hash alignment
-- Runs inside a single transaction ending with ROLLBACK.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_run UUID := gen_random_uuid();
  v_month DATE := DATE '2026-08-01';
  v_snap UUID := gen_random_uuid();
  v_rendered TEXT := '(3) TIN,(2) Employee Name,(1) Serial Number' || E'\n' || 'C0000000001,Test Employee,1';
  v_rendered_hash TEXT;
  v_source_payload JSONB;
  v_source_hash TEXT;
  v_bom BYTEA := decode('efbbbf', 'hex');
  v_delivered_hash TEXT;
  v_delivered_len BIGINT;
  v_event_id UUID;
  v_err TEXT;
  v_fn_count INT;
  v_prosecdef BOOLEAN;
  v_reversed_run UUID := gen_random_uuid();
  v_reversed_snap UUID := gen_random_uuid();
  v_corrupt_snap UUID := gen_random_uuid();
  v_corrupt_run UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_owner FROM auth.users LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'TEST_SETUP: need auth.users row'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- -------------------------------------------------------------------------
  -- Function identity (565 must preserve single nine-argument overload)
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'record_payroll_export_event';

  IF v_fn_count <> 1 THEN
    RAISE EXCEPTION '565 fn identity: expected 1 overload, got %', v_fn_count;
  END IF;

  SELECT p.prosecdef INTO v_prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'record_payroll_export_event';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '565 fn identity: expected SECURITY DEFINER';
  END IF;

  -- -------------------------------------------------------------------------
  -- BOM byte correctness (actual bytes, not display)
  -- -------------------------------------------------------------------------
  IF encode(v_bom, 'hex') <> 'efbbbf' THEN
    RAISE EXCEPTION '565 bom: expected efbbbf, got %', encode(v_bom, 'hex');
  END IF;

  v_rendered_hash := public.payroll_sha256_hex(v_rendered);
  v_delivered_hash := encode(
    digest(v_bom || convert_to(v_rendered, 'UTF8'), 'sha256'),
    'hex'
  );
  v_delivered_len := octet_length(v_bom || convert_to(v_rendered, 'UTF8'));

  IF v_delivered_len <> octet_length(v_bom) + octet_length(convert_to(v_rendered, 'UTF8')) THEN
    RAISE EXCEPTION '565 bom: delivered length mismatch';
  END IF;

  IF v_delivered_hash = v_rendered_hash THEN
    RAISE EXCEPTION '565 bom: delivered hash must differ from BOM-free snapshot hash';
  END IF;

  -- -------------------------------------------------------------------------
  -- Fixture: approved run + immutable DT107A snapshot
  -- -------------------------------------------------------------------------
  INSERT INTO public.businesses (id, name, address_country, owner_id, industry, created_at, updated_at)
  VALUES (v_biz, '565 Export BOM Test Biz', 'Ghana', v_owner, 'service', NOW(), NOW());

  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_biz, v_owner, 'admin', NOW()) ON CONFLICT DO NOTHING;

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run, v_biz, v_month, v_month, DATE '2026-08-31', 'approved', 'monthly',
    1000, 1000, 0, 110, 260, 100, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '565-bom-test'
  );

  v_source_payload := jsonb_build_object(
    'business', jsonb_build_object('tin', NULL),
    'run', jsonb_build_object('id', v_run)
  );
  v_source_hash := public.payroll_sha256_hex(v_source_payload::TEXT);

  INSERT INTO public.payroll_export_snapshots (
    id, business_id, payroll_run_id, export_type, snapshot_schema_version, renderer_version,
    template_version, template_reference, source_run_status, source_payload, source_payload_sha256,
    row_count, control_totals, rendered_content, rendered_content_sha256, content_type, filename,
    materialized_at, created_by
  ) VALUES (
    v_snap, v_biz, v_run, 'gra_dt107a', 'gra-dt107a-schema-v2', 'gra-dt107a-renderer-v2',
    NULL, NULL, 'approved',
    v_source_payload,
    v_source_hash,
    1, '{}'::jsonb, v_rendered, v_rendered_hash, 'text/csv', 'gra-dt107a-test.csv',
    NOW(), v_owner
  );

  -- -------------------------------------------------------------------------
  -- Success: DT107A preparation accepts BOM-inclusive delivered hash/length
  -- -------------------------------------------------------------------------
  v_event_id := public.record_payroll_export_event(
    v_biz, v_run, v_snap, 'gra_dt107a', 'preparation',
    v_delivered_hash, 'gra-dt107a-test.csv', 'gra-dt107a-renderer-v2', v_delivered_len
  );

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION '565 success: expected event id';
  END IF;

  -- Snapshot hash must remain BOM-free
  PERFORM 1 FROM public.payroll_export_snapshots
  WHERE id = v_snap
    AND rendered_content_sha256 = v_rendered_hash
    AND rendered_content = v_rendered
    AND left(encode(convert_to(rendered_content, 'UTF8'), 'hex'), 6) <> 'efbbbf';

  IF NOT FOUND THEN
    RAISE EXCEPTION '565 success: snapshot hash/content mutated or BOM present in stored content';
  END IF;

  -- -------------------------------------------------------------------------
  -- Tamper: wrong DT107A preparation hash (559-era snapshot hash without BOM)
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_run, v_snap, 'gra_dt107a', 'preparation',
      v_rendered_hash, 'gra-dt107a-test.csv', 'gra-dt107a-renderer-v2', v_delivered_len
    );
    RAISE EXCEPTION '565 tamper hash: expected failure for snapshot hash without BOM';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%565%' AND v_err NOT ILIKE '%hash%' AND v_err NOT ILIKE '%PAYROLL_EXPORT%' THEN
        RAISE EXCEPTION '565 tamper hash: unexpected error: %', v_err;
      END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Tamper: wrong DT107A preparation length
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_run, v_snap, 'gra_dt107a', 'preparation',
      v_delivered_hash, 'gra-dt107a-test.csv', 'gra-dt107a-renderer-v2', v_delivered_len - 1
    );
    RAISE EXCEPTION '565 tamper length: expected failure';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%length%' AND v_err NOT ILIKE '%PAYROLL_EXPORT%' THEN
        RAISE EXCEPTION '565 tamper length: unexpected error: %', v_err;
      END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Tamper: wrong renderer version
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_run, v_snap, 'gra_dt107a', 'preparation',
      v_delivered_hash, 'gra-dt107a-test.csv', 'gra-dt107a-renderer-v1', v_delivered_len
    );
    RAISE EXCEPTION '565 tamper renderer: expected failure';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%renderer%' AND v_err NOT ILIKE '%PAYROLL_EXPORT%' THEN
        RAISE EXCEPTION '565 tamper renderer: unexpected error: %', v_err;
      END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Tamper: wrong export type for snapshot
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_run, v_snap, 'payroll_register', 'preparation',
      v_delivered_hash, 'gra-dt107a-test.csv', 'gra-dt107a-renderer-v2', v_delivered_len
    );
    RAISE EXCEPTION '565 tamper export type: expected failure';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%ownership%' AND v_err NOT ILIKE '%export-type%' AND v_err NOT ILIKE '%PAYROLL_EXPORT%' THEN
        RAISE EXCEPTION '565 tamper export type: unexpected error: %', v_err;
      END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Tamper: unsafe filename
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_run, v_snap, 'gra_dt107a', 'preparation',
      v_delivered_hash, '../evil.csv', 'gra-dt107a-renderer-v2', v_delivered_len
    );
    RAISE EXCEPTION '565 tamper filename: expected failure';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%filename%' AND v_err NOT ILIKE '%unsafe%' AND v_err NOT ILIKE '%PAYROLL_EXPORT%' THEN
        RAISE EXCEPTION '565 tamper filename: unexpected error: %', v_err;
      END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Tamper: reversed run blocks preparation export
  -- -------------------------------------------------------------------------
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_reversed_run, v_biz, v_month, v_month, DATE '2026-08-31', 'reversed', 'monthly',
    1000, 1000, 0, 110, 260, 100, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '565-bom-reversed'
  );

  INSERT INTO public.payroll_export_snapshots (
    id, business_id, payroll_run_id, export_type, snapshot_schema_version, renderer_version,
    template_version, template_reference, source_run_status, source_payload, source_payload_sha256,
    row_count, control_totals, rendered_content, rendered_content_sha256, content_type, filename,
    materialized_at, created_by
  ) VALUES (
    v_reversed_snap, v_biz, v_reversed_run, 'gra_dt107a', 'gra-dt107a-schema-v2', 'gra-dt107a-renderer-v2',
    NULL, NULL, 'approved',
    v_source_payload,
    v_source_hash,
    1, '{}'::jsonb, v_rendered, v_rendered_hash, 'text/csv', 'gra-dt107a-test.csv',
    NOW(), v_owner
  );

  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_reversed_run, v_reversed_snap, 'gra_dt107a', 'preparation',
      v_delivered_hash, 'gra-dt107a-test.csv', 'gra-dt107a-renderer-v2', v_delivered_len
    );
    RAISE EXCEPTION '565 tamper reversed: expected failure';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%reversed%' AND v_err NOT ILIKE '%PAYROLL_RUN_REVERSED%' THEN
        RAISE EXCEPTION '565 tamper reversed: unexpected error: %', v_err;
      END IF;
  END;

  -- -------------------------------------------------------------------------
  -- Tamper: corrupted immutable snapshot hash (inserted corrupt, not updated)
  -- -------------------------------------------------------------------------
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_corrupt_run, v_biz, v_month, v_month, DATE '2026-08-31', 'approved', 'monthly',
    1000, 1000, 0, 110, 260, 100, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '565-bom-corrupt'
  );

  INSERT INTO public.payroll_export_snapshots (
    id, business_id, payroll_run_id, export_type, snapshot_schema_version, renderer_version,
    template_version, template_reference, source_run_status, source_payload, source_payload_sha256,
    row_count, control_totals, rendered_content, rendered_content_sha256, content_type, filename,
    materialized_at, created_by
  ) VALUES (
    v_corrupt_snap, v_biz, v_corrupt_run, 'gra_dt107a', 'gra-dt107a-schema-v2', 'gra-dt107a-renderer-v2',
    NULL, NULL, 'approved',
    v_source_payload,
    v_source_hash,
    1, '{}'::jsonb, v_rendered, repeat('0', 64), 'text/csv', 'gra-dt107a-corrupt.csv',
    NOW(), v_owner
  );

  BEGIN
    PERFORM public.record_payroll_export_event(
      v_biz, v_corrupt_run, v_corrupt_snap, 'gra_dt107a', 'preparation',
      v_delivered_hash, 'gra-dt107a-corrupt.csv', 'gra-dt107a-renderer-v2', v_delivered_len
    );
    RAISE EXCEPTION '565 tamper corrupted snapshot: expected failure';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err NOT ILIKE '%corrupt%' AND v_err NOT ILIKE '%hash%' AND v_err NOT ILIKE '%PAYROLL_EXPORT%' THEN
        RAISE EXCEPTION '565 tamper corrupted snapshot: unexpected error: %', v_err;
      END IF;
  END;

  RAISE NOTICE '565 export BOM tests passed';
END $$;

ROLLBACK;
