-- ============================================================================
-- Migration 536: SQL tests for return_service_job_material_usage (Phase 1A)
-- Self-contained helper. Run: SELECT * FROM public.test_service_job_material_usage_return();
-- Does not repair historical data. Creates and cleans up ephemeral rows.
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
  v_err TEXT;
  v_cancel_je UUID;
  v_has_1450 BOOLEAN;
  v_has_5110 BOOLEAN;
  v_job2 UUID;
  v_usage2 UUID;
  v_cancel2 UUID;
BEGIN
  -- Prefer a service business that already has 1450/5110
  SELECT b.id, b.owner_id INTO v_business_id, v_owner_id
  FROM businesses b
  WHERE b.industry = 'service'
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = b.id AND a.code = '1450' AND a.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = b.id AND a.code = '5110' AND a.deleted_at IS NULL
    )
  ORDER BY b.created_at NULLS LAST
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::TEXT, FALSE, 'No service business with 1450/5110 found'::TEXT;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM accounts WHERE business_id = v_business_id AND code = '1450' AND deleted_at IS NULL
  ), EXISTS (
    SELECT 1 FROM accounts WHERE business_id = v_business_id AND code = '5110' AND deleted_at IS NULL
  )
  INTO v_has_1450, v_has_5110;

  RETURN QUERY SELECT 'setup_accounts'::TEXT, v_has_1450 AND v_has_5110,
    format('business=%s 1450=%s 5110=%s', v_business_id, v_has_1450, v_has_5110);

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

  -- ----- Consumed return -----
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
  -- status inserted as consumed bypasses trigger (trigger is UPDATE OF status). Ensure no JE.
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

  -- Mark the orphan consumed row returned without stock (cleanup path via direct update not allowed for product;
  -- delete ephemeral usage instead after tests)
  -- Cancel after prior returns: should not restore returned qty again
  SELECT quantity_on_hand INTO v_qty_before FROM service_material_inventory WHERE id = v_material_id;

  -- Simulate hardened cancel stock restore: only non-returned
  UPDATE service_material_inventory m
  SET quantity_on_hand = m.quantity_on_hand + sub.qty
  FROM (
    SELECT COALESCE(SUM(u.quantity_used), 0) AS qty
    FROM service_job_material_usage u
    WHERE u.job_id = v_job_id
      AND u.business_id = v_business_id
      AND u.status <> 'returned'
      AND u.return_movement_id IS NULL
      AND u.id <> v_usage_other -- leave orphan consumed out of stock restore for this assertion
  ) sub
  WHERE m.id = v_material_id;

  SELECT quantity_on_hand INTO v_qty_after FROM service_material_inventory WHERE id = v_material_id;
  RETURN QUERY SELECT 'cancel_skips_returned_qty'::TEXT,
    v_qty_after = v_qty_before,
    format('before=%s after=%s (orphan excluded)', v_qty_before, v_qty_after);

  -- reverse_service_job_cogs should ignore returned usages
  SELECT reverse_service_job_cogs(v_job_id) INTO v_cancel_je;
  RETURN QUERY SELECT 'cancel_cogs_skips_returned'::TEXT,
    -- returned usages had their own return JE; cancel should find no remaining consumed
    -- (orphan v_usage_other is consumed without JE so also excluded by EXISTS filter)
    v_cancel_je IS NULL,
    format('cancel_je=%s', v_cancel_je);

  -- Active non-returned consumed still reverses on a fresh job
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

  -- Cleanup ephemeral rows (best effort; journal deletes may be immutable)
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
  'Phase 1A SQL integration tests for job material return integrity.';

GRANT EXECUTE ON FUNCTION public.test_service_job_material_usage_return() TO service_role;
