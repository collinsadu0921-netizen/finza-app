-- ============================================================================
-- Migration 538: Harden Phase 1A return SQL tests + activation SQL tests
-- ============================================================================
-- Replaces test_service_job_material_usage_return() with dual-table setup checks.
-- Adds test_activate_service_material_accounts() for Classes A–E + idempotency.
-- Does not edit migration 536 in place.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.test_service_job_material_usage_return()
RETURNS TABLE (
  test_name TEXT,
  passed BOOLEAN,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id UUID;
  v_owner_id UUID;
  v_material_id UUID;
  v_job_id UUID;
  v_usage_alloc UUID;
  v_usage_cons UUID;
  v_usage_other UUID;
  v_qty_before NUMERIC;
  v_qty_after NUMERIC;
  v_result JSONB;
  v_result2 JSONB;
  v_mov_count INT;
  v_je_id UUID;
  v_rev_je_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_key TEXT;
  v_key2 TEXT;
  v_cancel_je UUID;
  v_job2 UUID;
  v_usage2 UUID;
  v_cancel2 UUID;
  v_acc_1450 BOOLEAN;
  v_coa_1450 BOOLEAN;
  v_coa_1450_active BOOLEAN;
  v_coa_1450_type TEXT;
  v_acc_5110 BOOLEAN;
  v_coa_5110 BOOLEAN;
  v_coa_5110_active BOOLEAN;
  v_coa_5110_type TEXT;
  v_acc_1450_type TEXT;
  v_acc_5110_type TEXT;
  v_setup_ok BOOLEAN := FALSE;
  v_setup_detail TEXT;
BEGIN
  -- Prefer a service business that is dual-table ready for 1450/5110
  SELECT b.id, b.owner_id INTO v_business_id, v_owner_id
  FROM businesses b
  WHERE b.industry = 'service'
    AND b.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = b.id AND a.code = '1450' AND a.deleted_at IS NULL AND a.type = 'asset'
    )
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = b.id AND a.code = '5110' AND a.deleted_at IS NULL AND a.type = 'expense'
    )
    AND EXISTS (
      SELECT 1 FROM chart_of_accounts c
      WHERE c.business_id = b.id AND c.account_code = '1450'
        AND c.is_active IS TRUE AND c.account_type = 'asset'
    )
    AND EXISTS (
      SELECT 1 FROM chart_of_accounts c
      WHERE c.business_id = b.id AND c.account_code = '5110'
        AND c.is_active IS TRUE AND c.account_type = 'expense'
    )
  ORDER BY b.created_at NULLS LAST
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE,
      'No active service business with dual-table ready 1450/5110 found'::TEXT;
    RETURN;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = v_business_id AND a.code = '1450' AND a.deleted_at IS NULL
    ),
    (SELECT a.type FROM accounts a
     WHERE a.business_id = v_business_id AND a.code = '1450' AND a.deleted_at IS NULL LIMIT 1),
    EXISTS (
      SELECT 1 FROM chart_of_accounts c
      WHERE c.business_id = v_business_id AND c.account_code = '1450'
    ),
    COALESCE((
      SELECT c.is_active FROM chart_of_accounts c
      WHERE c.business_id = v_business_id AND c.account_code = '1450' LIMIT 1
    ), FALSE),
    (SELECT c.account_type FROM chart_of_accounts c
     WHERE c.business_id = v_business_id AND c.account_code = '1450' LIMIT 1),
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = v_business_id AND a.code = '5110' AND a.deleted_at IS NULL
    ),
    (SELECT a.type FROM accounts a
     WHERE a.business_id = v_business_id AND a.code = '5110' AND a.deleted_at IS NULL LIMIT 1),
    EXISTS (
      SELECT 1 FROM chart_of_accounts c
      WHERE c.business_id = v_business_id AND c.account_code = '5110'
    ),
    COALESCE((
      SELECT c.is_active FROM chart_of_accounts c
      WHERE c.business_id = v_business_id AND c.account_code = '5110' LIMIT 1
    ), FALSE),
    (SELECT c.account_type FROM chart_of_accounts c
     WHERE c.business_id = v_business_id AND c.account_code = '5110' LIMIT 1)
  INTO
    v_acc_1450, v_acc_1450_type, v_coa_1450, v_coa_1450_active, v_coa_1450_type,
    v_acc_5110, v_acc_5110_type, v_coa_5110, v_coa_5110_active, v_coa_5110_type;

  IF NOT v_acc_1450 THEN
    v_setup_detail := 'Account 1450 is missing from accounts';
  ELSIF NOT v_coa_1450 THEN
    v_setup_detail := 'Account 1450 exists in accounts but is missing from chart_of_accounts';
  ELSIF NOT v_coa_1450_active THEN
    v_setup_detail := 'Account 1450 is inactive in chart_of_accounts';
  ELSIF v_acc_1450_type IS DISTINCT FROM 'asset' OR v_coa_1450_type IS DISTINCT FROM 'asset' THEN
    v_setup_detail := 'Account 1450 has incompatible account type';
  ELSIF NOT v_acc_5110 THEN
    v_setup_detail := 'Account 5110 is missing from accounts';
  ELSIF NOT v_coa_5110 THEN
    v_setup_detail := 'Account 5110 exists in accounts but is missing from chart_of_accounts';
  ELSIF NOT v_coa_5110_active THEN
    v_setup_detail := 'Account 5110 is inactive in chart_of_accounts';
  ELSIF v_acc_5110_type IS DISTINCT FROM 'expense' OR v_coa_5110_type IS DISTINCT FROM 'expense' THEN
    v_setup_detail := 'Account 5110 has incompatible account type';
  ELSE
    BEGIN
      PERFORM assert_account_exists(v_business_id, '1450');
      PERFORM assert_account_exists(v_business_id, '5110');
      v_setup_ok := TRUE;
      v_setup_detail := format(
        'business=%s dual-table ready; assert_account_exists(1450/5110) ok',
        v_business_id
      );
    EXCEPTION WHEN OTHERS THEN
      v_setup_ok := FALSE;
      v_setup_detail := format('assert_account_exists failed: %s', SQLERRM);
    END;
  END IF;

  RETURN QUERY SELECT 'setup_accounts'::TEXT, v_setup_ok, v_setup_detail;

  IF NOT v_setup_ok THEN
    RETURN QUERY SELECT 'setup_aborted_before_consumed'::TEXT, FALSE,
      'Journal-posting path cannot resolve 1450/5110; skipped remaining scenarios'::TEXT;
    RETURN;
  END IF;

  INSERT INTO service_material_inventory (
    business_id, name, unit, quantity_on_hand, average_cost, reorder_level, is_active
  ) VALUES (
    v_business_id,
    'SQL Return Test Mat ' || gen_random_uuid()::text,
    'pcs',
    100,
    70,
    0,
    TRUE
  ) RETURNING id INTO v_material_id;

  INSERT INTO service_jobs (business_id, status, materials_reversed)
  VALUES (v_business_id, 'in_progress', FALSE)
  RETURNING id INTO v_job_id;

  -- ----- Allocated return -----
  INSERT INTO service_job_material_usage (
    business_id, job_id, material_id, quantity_used, unit_cost, total_cost, status
  ) VALUES (
    v_business_id, v_job_id, v_material_id, 5, 70, 350, 'allocated'
  ) RETURNING id INTO v_usage_alloc;

  UPDATE service_material_inventory SET quantity_on_hand = 95 WHERE id = v_material_id;
  SELECT quantity_on_hand INTO v_qty_before FROM service_material_inventory WHERE id = v_material_id;

  v_key := 'sql-alloc-' || gen_random_uuid()::text;
  v_result := return_service_job_material_usage(
    v_usage_alloc, v_business_id, CURRENT_DATE, v_key, v_owner_id
  );

  SELECT quantity_on_hand INTO v_qty_after FROM service_material_inventory WHERE id = v_material_id;
  RETURN QUERY SELECT 'allocated_restores_qty_once'::TEXT,
    v_qty_after = v_qty_before + 5 AND (v_result->>'quantity_restored')::numeric = 5,
    format('before=%s after=%s result=%s', v_qty_before, v_qty_after, v_result);

  SELECT COUNT(*) INTO v_mov_count
  FROM service_material_movements
  WHERE id = (v_result->>'return_movement_id')::uuid
    AND movement_type = 'return'
    AND quantity = 5;
  RETURN QUERY SELECT 'allocated_creates_one_movement'::TEXT, v_mov_count = 1,
    format('mov_count=%s', v_mov_count);

  RETURN QUERY SELECT 'allocated_no_journal'::TEXT,
    (v_result->>'return_journal_entry_id') IS NULL,
    format('return_je=%s', v_result->>'return_journal_entry_id');

  -- Idempotent replay
  v_result2 := return_service_job_material_usage(
    v_usage_alloc, v_business_id, CURRENT_DATE, v_key, v_owner_id
  );
  SELECT quantity_on_hand INTO v_qty_after FROM service_material_inventory WHERE id = v_material_id;
  RETURN QUERY SELECT 'idempotent_replay_same_result'::TEXT,
    COALESCE((v_result2->>'idempotent')::boolean, FALSE) = TRUE
      AND v_qty_after = v_qty_before + 5
      AND v_result2->>'return_movement_id' = v_result->>'return_movement_id',
    format('result2=%s qty=%s', v_result2, v_qty_after);

  -- Different key after return blocked
  v_key2 := 'sql-alloc-other-' || gen_random_uuid()::text;
  BEGIN
    PERFORM return_service_job_material_usage(
      v_usage_alloc, v_business_id, CURRENT_DATE, v_key2, v_owner_id
    );
    RETURN QUERY SELECT 'different_key_blocked'::TEXT, FALSE, 'Expected USAGE_ALREADY_RETURNED'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'different_key_blocked'::TEXT,
      SQLERRM LIKE '%USAGE_ALREADY_RETURNED%',
      SQLERRM;
  END;

  -- ----- Consumed return (assert_account_exists already verified above) -----
  INSERT INTO service_job_material_usage (
    business_id, job_id, material_id, quantity_used, unit_cost, total_cost, status
  ) VALUES (
    v_business_id, v_job_id, v_material_id, 5, 70, 350, 'allocated'
  ) RETURNING id INTO v_usage_cons;

  UPDATE service_material_inventory
  SET quantity_on_hand = quantity_on_hand - 5
  WHERE id = v_material_id;

  UPDATE service_job_material_usage SET status = 'consumed' WHERE id = v_usage_cons;

  SELECT cogs_journal_entry_id INTO v_je_id FROM service_job_material_usage WHERE id = v_usage_cons;
  IF v_je_id IS NULL THEN
    SELECT id INTO v_je_id FROM journal_entries
    WHERE reference_type = 'service_job_usage' AND reference_id = v_usage_cons LIMIT 1;
  END IF;

  RETURN QUERY SELECT 'consume_posts_cogs'::TEXT, v_je_id IS NOT NULL,
    format('cogs_je=%s', v_je_id);

  SELECT quantity_on_hand INTO v_qty_before FROM service_material_inventory WHERE id = v_material_id;
  v_key := 'sql-cons-' || gen_random_uuid()::text;
  v_result := return_service_job_material_usage(
    v_usage_cons, v_business_id, CURRENT_DATE, v_key, v_owner_id
  );
  SELECT quantity_on_hand INTO v_qty_after FROM service_material_inventory WHERE id = v_material_id;

  RETURN QUERY SELECT 'consumed_restores_qty_once'::TEXT,
    v_qty_after = v_qty_before + 5,
    format('before=%s after=%s', v_qty_before, v_qty_after);

  v_rev_je_id := (v_result->>'return_journal_entry_id')::uuid;
  RETURN QUERY SELECT 'consumed_reverses_own_cogs'::TEXT,
    v_rev_je_id IS NOT NULL
      AND (v_result->>'original_cogs_journal_entry_id')::uuid = v_je_id
      AND (v_result->>'total_cost')::numeric = 350,
    format('rev_je=%s orig=%s total=%s', v_rev_je_id, v_je_id, v_result->>'total_cost');

  SELECT ROUND(SUM(debit), 2), ROUND(SUM(credit), 2)
  INTO v_debit, v_credit
  FROM journal_entry_lines
  WHERE journal_entry_id = v_rev_je_id;

  RETURN QUERY SELECT 'return_journal_balanced'::TEXT,
    v_debit = v_credit AND v_debit = 350,
    format('debit=%s credit=%s', v_debit, v_credit);

  RETURN QUERY SELECT 'return_uses_original_cost'::TEXT,
    (v_result->>'unit_cost')::numeric = 70 AND (v_result->>'total_cost')::numeric = 350,
    format('unit=%s total=%s', v_result->>'unit_cost', v_result->>'total_cost');

  -- Cross-tenant blocked
  BEGIN
    PERFORM return_service_job_material_usage(
      v_usage_cons,
      '00000000-0000-0000-0000-000000000099'::uuid,
      CURRENT_DATE,
      'sql-xtenant-' || gen_random_uuid()::text,
      v_owner_id
    );
    RETURN QUERY SELECT 'cross_tenant_blocked'::TEXT, FALSE, 'Expected CROSS_TENANT'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'cross_tenant_blocked'::TEXT,
      SQLERRM LIKE '%CROSS_TENANT%' OR SQLERRM LIKE '%USAGE_NOT_FOUND%' OR SQLERRM LIKE '%does not belong%',
      SQLERRM;
  END;

  -- Missing COGS link fails closed
  INSERT INTO service_job_material_usage (
    business_id, job_id, material_id, quantity_used, unit_cost, total_cost, status
  ) VALUES (
    v_business_id, v_job_id, v_material_id, 1, 70, 70, 'consumed'
  ) RETURNING id INTO v_usage_other;

  DELETE FROM journal_entries
  WHERE reference_type = 'service_job_usage' AND reference_id = v_usage_other;

  BEGIN
    PERFORM return_service_job_material_usage(
      v_usage_other, v_business_id, CURRENT_DATE,
      'sql-missing-cogs-' || gen_random_uuid()::text, v_owner_id
    );
    RETURN QUERY SELECT 'missing_cogs_fails_closed'::TEXT, FALSE, 'Expected USAGE_COGS_LINK_MISSING'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'missing_cogs_fails_closed'::TEXT,
      SQLERRM LIKE '%USAGE_COGS_LINK_MISSING%',
      SQLERRM;
  END;

  SELECT quantity_on_hand INTO v_qty_before FROM service_material_inventory WHERE id = v_material_id;

  UPDATE service_material_inventory m
  SET quantity_on_hand = m.quantity_on_hand + sub.qty
  FROM (
    SELECT COALESCE(SUM(u.quantity_used), 0) AS qty
    FROM service_job_material_usage u
    WHERE u.job_id = v_job_id
      AND u.business_id = v_business_id
      AND u.status <> 'returned'
      AND u.return_movement_id IS NULL
      AND u.id <> v_usage_other
  ) sub
  WHERE m.id = v_material_id;

  SELECT quantity_on_hand INTO v_qty_after FROM service_material_inventory WHERE id = v_material_id;
  RETURN QUERY SELECT 'cancel_skips_returned_qty'::TEXT,
    v_qty_after = v_qty_before,
    format('before=%s after=%s (orphan excluded)', v_qty_before, v_qty_after);

  SELECT reverse_service_job_cogs(v_job_id) INTO v_cancel_je;
  RETURN QUERY SELECT 'cancel_cogs_skips_returned'::TEXT,
    v_cancel_je IS NULL,
    format('cancel_je=%s', v_cancel_je);

  INSERT INTO service_jobs (business_id, status, materials_reversed)
  VALUES (v_business_id, 'in_progress', FALSE)
  RETURNING id INTO v_job2;

  INSERT INTO service_job_material_usage (
    business_id, job_id, material_id, quantity_used, unit_cost, total_cost, status
  ) VALUES (
    v_business_id, v_job2, v_material_id, 2, 70, 140, 'allocated'
  ) RETURNING id INTO v_usage2;

  UPDATE service_job_material_usage SET status = 'consumed' WHERE id = v_usage2;
  SELECT reverse_service_job_cogs(v_job2) INTO v_cancel2;
  RETURN QUERY SELECT 'cancel_reverses_active_consumed'::TEXT,
    v_cancel2 IS NOT NULL,
    format('cancel_je=%s', v_cancel2);

  BEGIN
    DELETE FROM journal_entries WHERE id = v_cancel2;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    DELETE FROM journal_entries WHERE reference_type = 'service_job_usage' AND reference_id = v_usage2;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  DELETE FROM service_job_material_usage WHERE id = v_usage2;
  DELETE FROM service_jobs WHERE id = v_job2;

  BEGIN
    DELETE FROM journal_entries WHERE reference_type = 'service_job_usage_return'
      AND reference_id IN (v_usage_alloc, v_usage_cons, v_usage_other);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    DELETE FROM journal_entries WHERE reference_type = 'service_job_usage'
      AND reference_id IN (v_usage_alloc, v_usage_cons, v_usage_other);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  DELETE FROM service_job_material_usage WHERE job_id = v_job_id;
  DELETE FROM service_material_movements WHERE material_id = v_material_id;
  DELETE FROM service_jobs WHERE id = v_job_id;
  DELETE FROM service_material_inventory WHERE id = v_material_id;

  RETURN QUERY SELECT 'cleanup_ok'::TEXT, TRUE, 'ephemeral rows removed'::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'test_aborted'::TEXT, FALSE, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.test_service_job_material_usage_return() IS
  'Phase 1A SQL integration tests for job material return integrity (dual-table account setup required).';

GRANT EXECUTE ON FUNCTION public.test_service_job_material_usage_return() TO service_role;

-- ============================================================================
-- Activation migration SQL tests (synthetic businesses; cleaned up)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.test_activate_service_material_accounts()
RETURNS TABLE (
  test_name TEXT,
  passed BOOLEAN,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_biz_a UUID := gen_random_uuid();
  v_biz_b UUID := gen_random_uuid();
  v_biz_c UUID := gen_random_uuid();
  v_biz_d UUID := gen_random_uuid();
  v_biz_e UUID := gen_random_uuid();
  v_biz_new UUID;
  v_biz_retail UUID;
  v_acc_1450_b UUID;
  v_acc_5110_b UUID;
  v_acc_1450_c UUID;
  v_acc_5110_c UUID;
  v_acc_1450_d UUID;
  v_acc_e_id UUID;
  v_acc_e_type TEXT;
  v_acc_e_name TEXT;
  v_acc_new_1450 UUID;
  v_acc_new_5110 UUID;
  v_coa_new_1450 UUID;
  v_coa_new_5110 UUID;
  v_count_acc INT;
  v_count_coa INT;
  v_class TEXT;
  v_detail TEXT;
  v_name_before TEXT;
  v_type_before TEXT;
BEGIN
  SELECT owner_id INTO v_owner_id
  FROM businesses
  WHERE id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid;

  IF v_owner_id IS NULL THEN
    SELECT owner_id INTO v_owner_id
    FROM businesses
    WHERE industry = 'service' AND archived_at IS NULL
    ORDER BY created_at NULLS LAST
    LIMIT 1;
  END IF;

  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE, 'No owner_id available for synthetic businesses'::TEXT;
    RETURN;
  END IF;

  -- Create five synthetic active Service businesses
  INSERT INTO businesses (id, owner_id, name, industry, archived_at)
  VALUES
    (v_biz_a, v_owner_id, 'SQL Mat Acc Class A ' || v_biz_a::text, 'service', NULL),
    (v_biz_b, v_owner_id, 'SQL Mat Acc Class B ' || v_biz_b::text, 'service', NULL),
    (v_biz_c, v_owner_id, 'SQL Mat Acc Class C ' || v_biz_c::text, 'service', NULL),
    (v_biz_d, v_owner_id, 'SQL Mat Acc Class D ' || v_biz_d::text, 'service', NULL),
    (v_biz_e, v_owner_id, 'SQL Mat Acc Class E ' || v_biz_e::text, 'service', NULL);

  -- Class A: fully ready
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  VALUES
    (v_biz_a, 'Service Materials Inventory', '1450', 'asset', 'Service materials stock', TRUE),
    (v_biz_a, 'Cost of Services', '5110', 'expense', 'Cost of services (material usage)', TRUE);
  INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
  VALUES
    (v_biz_a, '1450', 'Service Materials Inventory', 'asset', TRUE),
    (v_biz_a, '5110', 'Cost of Services', 'expense', TRUE);

  -- Class B: accounts only
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  VALUES
    (v_biz_b, 'Service Materials Inventory', '1450', 'asset', 'Service materials stock', TRUE),
    (v_biz_b, 'Cost of Services', '5110', 'expense', 'Cost of services (material usage)', TRUE);
  SELECT id INTO v_acc_1450_b FROM accounts WHERE business_id = v_biz_b AND code = '1450';
  SELECT id INTO v_acc_5110_b FROM accounts WHERE business_id = v_biz_b AND code = '5110';

  -- Class C: both missing (no inserts)

  -- Class D: partial — 1450 ready, 5110 missing
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  VALUES (v_biz_d, 'Service Materials Inventory', '1450', 'asset', 'Service materials stock', TRUE)
  RETURNING id INTO v_acc_1450_d;
  INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
  VALUES (v_biz_d, '1450', 'Service Materials Inventory', 'asset', TRUE);

  -- Class E: conflict — wrong type on 1450
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  VALUES (v_biz_e, 'Wrong Type 1450', '1450', 'expense', 'conflict fixture', TRUE)
  RETURNING id, type, name INTO v_acc_e_id, v_acc_e_type, v_acc_e_name;

  -- Snapshot Class A counts before activation
  SELECT COUNT(*) INTO v_count_acc FROM accounts WHERE business_id = v_biz_a AND code IN ('1450', '5110');
  SELECT COUNT(*) INTO v_count_coa FROM chart_of_accounts WHERE business_id = v_biz_a AND account_code IN ('1450', '5110');

  PERFORM activate_service_material_accounts(v_biz_a);
  PERFORM activate_service_material_accounts(v_biz_b);
  PERFORM activate_service_material_accounts(v_biz_c);
  PERFORM activate_service_material_accounts(v_biz_d);
  PERFORM activate_service_material_accounts(v_biz_e);

  -- Scenario 1 — Fully ready unchanged
  RETURN QUERY SELECT 'scenario1_fully_ready_no_dupes'::TEXT,
    (SELECT COUNT(*) FROM accounts WHERE business_id = v_biz_a AND code IN ('1450','5110')) = v_count_acc
    AND (SELECT COUNT(*) FROM chart_of_accounts WHERE business_id = v_biz_a AND account_code IN ('1450','5110')) = v_count_coa,
    format('acc=%s coa=%s', v_count_acc, v_count_coa);

  SELECT classification INTO v_class
  FROM diagnose_service_material_account_readiness(v_biz_a);
  RETURN QUERY SELECT 'scenario1_classification'::TEXT, v_class = 'FULLY_READY', v_class;

  -- Scenario 2 — Class B: only COA inserted; account IDs unchanged
  RETURN QUERY SELECT 'scenario2_account_ids_unchanged'::TEXT,
    (SELECT id FROM accounts WHERE business_id = v_biz_b AND code = '1450') = v_acc_1450_b
    AND (SELECT id FROM accounts WHERE business_id = v_biz_b AND code = '5110') = v_acc_5110_b,
    format('1450=%s 5110=%s', v_acc_1450_b, v_acc_5110_b);

  RETURN QUERY SELECT 'scenario2_coa_inserted'::TEXT,
    EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_b AND account_code = '1450' AND is_active AND account_type = 'asset')
    AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_b AND account_code = '5110' AND is_active AND account_type = 'expense'),
    'COA rows for 1450/5110';

  SELECT classification INTO v_class
  FROM diagnose_service_material_account_readiness(v_biz_b);
  RETURN QUERY SELECT 'scenario2_classification'::TEXT, v_class = 'FULLY_READY', v_class;

  -- Scenario 3 — Class C both inserted
  SELECT id INTO v_acc_1450_c FROM accounts WHERE business_id = v_biz_c AND code = '1450' AND deleted_at IS NULL;
  SELECT id INTO v_acc_5110_c FROM accounts WHERE business_id = v_biz_c AND code = '5110' AND deleted_at IS NULL;
  RETURN QUERY SELECT 'scenario3_accounts_and_coa'::TEXT,
    v_acc_1450_c IS NOT NULL AND v_acc_5110_c IS NOT NULL
    AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_c AND account_code = '1450' AND is_active AND account_type = 'asset')
    AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_c AND account_code = '5110' AND is_active AND account_type = 'expense')
    AND (SELECT type FROM accounts WHERE id = v_acc_1450_c) = 'asset'
    AND (SELECT type FROM accounts WHERE id = v_acc_5110_c) = 'expense',
    format('1450=%s 5110=%s', v_acc_1450_c, v_acc_5110_c);

  SELECT classification INTO v_class
  FROM diagnose_service_material_account_readiness(v_biz_c);
  RETURN QUERY SELECT 'scenario3_classification'::TEXT, v_class = 'FULLY_READY', v_class;

  -- Scenario 4 — Partial: only 5110 added
  RETURN QUERY SELECT 'scenario4_1450_unchanged'::TEXT,
    (SELECT id FROM accounts WHERE business_id = v_biz_d AND code = '1450') = v_acc_1450_d,
    format('1450=%s', v_acc_1450_d);

  RETURN QUERY SELECT 'scenario4_5110_added'::TEXT,
    EXISTS (SELECT 1 FROM accounts WHERE business_id = v_biz_d AND code = '5110' AND type = 'expense' AND deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_d AND account_code = '5110' AND is_active AND account_type = 'expense'),
    '5110 dual-table present';

  SELECT classification INTO v_class
  FROM diagnose_service_material_account_readiness(v_biz_d);
  RETURN QUERY SELECT 'scenario4_classification'::TEXT, v_class = 'FULLY_READY', v_class;

  -- Scenario 5 — Conflict unchanged
  SELECT name, type INTO v_name_before, v_type_before FROM accounts WHERE id = v_acc_e_id;
  RETURN QUERY SELECT 'scenario5_conflict_unchanged'::TEXT,
    v_name_before = v_acc_e_name AND v_type_before = v_acc_e_type
    AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_e AND account_code = '1450'),
    format('name=%s type=%s', v_name_before, v_type_before);

  SELECT classification, conflict_detail INTO v_class, v_detail
  FROM diagnose_service_material_account_readiness(v_biz_e);
  RETURN QUERY SELECT 'scenario5_classification_conflict'::TEXT,
    v_class = 'CONFLICT' AND v_detail ILIKE '%incompatible%',
    format('%s | %s', v_class, v_detail);

  -- Scenario 6 — Idempotent rerun
  SELECT COUNT(*) INTO v_count_acc FROM accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d) AND code IN ('1450','5110');
  SELECT COUNT(*) INTO v_count_coa FROM chart_of_accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d) AND account_code IN ('1450','5110');
  SELECT id INTO v_acc_1450_c FROM accounts WHERE business_id = v_biz_c AND code = '1450';
  SELECT name, type INTO v_name_before, v_type_before FROM accounts WHERE business_id = v_biz_c AND code = '1450';

  PERFORM activate_service_material_accounts(v_biz_a);
  PERFORM activate_service_material_accounts(v_biz_b);
  PERFORM activate_service_material_accounts(v_biz_c);
  PERFORM activate_service_material_accounts(v_biz_d);
  PERFORM activate_service_material_accounts(v_biz_e);

  RETURN QUERY SELECT 'scenario6_idempotent_counts'::TEXT,
    (SELECT COUNT(*) FROM accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d) AND code IN ('1450','5110')) = v_count_acc
    AND (SELECT COUNT(*) FROM chart_of_accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d) AND account_code IN ('1450','5110')) = v_count_coa
    AND (SELECT COUNT(*) FROM accounts WHERE business_id = v_biz_c AND code = '1450') = 1
    AND (SELECT id FROM accounts WHERE business_id = v_biz_c AND code = '1450') = v_acc_1450_c
    AND (SELECT name FROM accounts WHERE business_id = v_biz_c AND code = '1450') = v_name_before
    AND (SELECT type FROM accounts WHERE business_id = v_biz_c AND code = '1450') = v_type_before,
    format('acc=%s coa=%s', v_count_acc, v_count_coa);

  -- Scenario 7 — Journal resolver readiness for B and C
  BEGIN
    PERFORM assert_account_exists(v_biz_b, '1450');
    PERFORM assert_account_exists(v_biz_b, '5110');
    PERFORM assert_account_exists(v_biz_c, '1450');
    PERFORM assert_account_exists(v_biz_c, '5110');
    RETURN QUERY SELECT 'scenario7_assert_account_exists'::TEXT, TRUE, 'B and C resolve'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'scenario7_assert_account_exists'::TEXT, FALSE, SQLERRM;
  END;

  RETURN QUERY SELECT 'scenario7_get_account_by_code'::TEXT,
    get_account_by_code(v_biz_b, '1450') IS NOT NULL
    AND get_account_by_code(v_biz_b, '5110') IS NOT NULL
    AND get_account_by_code(v_biz_c, '1450') IS NOT NULL
    AND get_account_by_code(v_biz_c, '5110') IS NOT NULL,
    'get_account_by_code B/C';

  -- Scenario 8 — New Service tenant via authoritative ensure_accounting_initialized_system
  v_biz_new := gen_random_uuid();
  INSERT INTO businesses (id, owner_id, name, industry, archived_at)
  VALUES (v_biz_new, v_owner_id, 'SQL Mat Acc New Service ' || v_biz_new::text, 'service', NULL);

  PERFORM ensure_accounting_initialized_system(v_biz_new);

  SELECT id INTO v_acc_new_1450 FROM accounts WHERE business_id = v_biz_new AND code = '1450' AND deleted_at IS NULL;
  SELECT id INTO v_acc_new_5110 FROM accounts WHERE business_id = v_biz_new AND code = '5110' AND deleted_at IS NULL;
  SELECT id INTO v_coa_new_1450 FROM chart_of_accounts WHERE business_id = v_biz_new AND account_code = '1450' AND is_active;
  SELECT id INTO v_coa_new_5110 FROM chart_of_accounts WHERE business_id = v_biz_new AND account_code = '5110' AND is_active;

  RETURN QUERY SELECT 'scenario8_new_service_dual_table'::TEXT,
    v_acc_new_1450 IS NOT NULL AND v_acc_new_5110 IS NOT NULL
    AND v_coa_new_1450 IS NOT NULL AND v_coa_new_5110 IS NOT NULL
    AND (SELECT type FROM accounts WHERE id = v_acc_new_1450) = 'asset'
    AND (SELECT type FROM accounts WHERE id = v_acc_new_5110) = 'expense'
    AND (SELECT account_type FROM chart_of_accounts WHERE id = v_coa_new_1450) = 'asset'
    AND (SELECT account_type FROM chart_of_accounts WHERE id = v_coa_new_5110) = 'expense',
    format('acc1450=%s acc5110=%s coa1450=%s coa5110=%s', v_acc_new_1450, v_acc_new_5110, v_coa_new_1450, v_coa_new_5110);

  BEGIN
    PERFORM assert_account_exists(v_biz_new, '1450');
    PERFORM assert_account_exists(v_biz_new, '5110');
    RETURN QUERY SELECT 'scenario8_new_service_assert'::TEXT, TRUE, 'assert ok'::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'scenario8_new_service_assert'::TEXT, FALSE, SQLERRM;
  END;

  RETURN QUERY SELECT 'scenario8_new_service_get_by_code'::TEXT,
    get_account_by_code(v_biz_new, '1450') IS NOT NULL
    AND get_account_by_code(v_biz_new, '5110') IS NOT NULL,
    'get_account_by_code new service';

  SELECT classification INTO v_class
  FROM diagnose_service_material_account_readiness(v_biz_new);
  RETURN QUERY SELECT 'scenario8_new_service_classification'::TEXT, v_class = 'FULLY_READY', v_class;

  -- Scenario 9 — Repeated initialization (same IDs, no dupes)
  PERFORM ensure_accounting_initialized_system(v_biz_new);
  RETURN QUERY SELECT 'scenario9_repeated_init_stable_ids'::TEXT,
    (SELECT id FROM accounts WHERE business_id = v_biz_new AND code = '1450') = v_acc_new_1450
    AND (SELECT id FROM accounts WHERE business_id = v_biz_new AND code = '5110') = v_acc_new_5110
    AND (SELECT id FROM chart_of_accounts WHERE business_id = v_biz_new AND account_code = '1450') = v_coa_new_1450
    AND (SELECT id FROM chart_of_accounts WHERE business_id = v_biz_new AND account_code = '5110') = v_coa_new_5110
    AND (SELECT COUNT(*) FROM accounts WHERE business_id = v_biz_new AND code IN ('1450','5110')) = 2
    AND (SELECT COUNT(*) FROM chart_of_accounts WHERE business_id = v_biz_new AND account_code IN ('1450','5110')) = 2
    AND (SELECT name FROM accounts WHERE id = v_acc_new_1450) = 'Service Materials Inventory'
    AND (SELECT name FROM accounts WHERE id = v_acc_new_5110) = 'Cost of Services',
    'stable after second ensure';

  -- Scenario 10 — Retail isolation: ensure must not add Service-only 1450/5110
  v_biz_retail := gen_random_uuid();
  INSERT INTO businesses (id, owner_id, name, industry, archived_at)
  VALUES (v_biz_retail, v_owner_id, 'SQL Mat Acc Retail ' || v_biz_retail::text, 'retail', NULL);

  PERFORM ensure_accounting_initialized_system(v_biz_retail);

  RETURN QUERY SELECT 'scenario10_retail_no_service_material_accounts'::TEXT,
    NOT EXISTS (SELECT 1 FROM accounts WHERE business_id = v_biz_retail AND code IN ('1450','5110'))
    AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = v_biz_retail AND account_code IN ('1450','5110'))
    AND EXISTS (SELECT 1 FROM accounts WHERE business_id = v_biz_retail AND code = '1000' AND deleted_at IS NULL),
    'retail has system cash, no 1450/5110';

  -- Cleanup synthetic rows
  DELETE FROM accounting_periods WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
  DELETE FROM chart_of_accounts_control_map WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
  DELETE FROM chart_of_accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
  DELETE FROM accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
  DELETE FROM businesses WHERE id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);

  RETURN QUERY SELECT 'cleanup_ok'::TEXT, TRUE, 'synthetic businesses removed'::TEXT;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort cleanup on failure
  BEGIN
    DELETE FROM accounting_periods WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
    DELETE FROM chart_of_accounts_control_map WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
    DELETE FROM chart_of_accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
    DELETE FROM accounts WHERE business_id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
    DELETE FROM businesses WHERE id IN (v_biz_a, v_biz_b, v_biz_c, v_biz_d, v_biz_e, v_biz_new, v_biz_retail);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN QUERY SELECT 'test_aborted'::TEXT, FALSE, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.test_activate_service_material_accounts() IS
  'SQL tests for activate_service_material_accounts / diagnose_service_material_account_readiness.';

GRANT EXECUTE ON FUNCTION public.test_activate_service_material_accounts() TO service_role;
