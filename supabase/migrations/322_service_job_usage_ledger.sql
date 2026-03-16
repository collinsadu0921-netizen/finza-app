-- ============================================================================
-- Migration: Service job material usage — post to ledger
-- Uses post_journal_entry (existing helper). Dr 5110 Cost of Services, Cr 1450 Service Materials Inventory.
-- Additive; does not modify ledger core.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_service_job_material_usage_to_ledger(p_usage_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  usage_row RECORD;
  business_id_val UUID;
  cost_account_id UUID;
  inventory_account_id UUID;
  journal_lines JSONB;
  journal_id UUID;
  v_date DATE;
BEGIN
  -- Idempotency: already posted
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'service_job_usage' AND reference_id = p_usage_id
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT business_id, job_id, material_id, quantity_used, unit_cost, total_cost, created_at
  INTO usage_row
  FROM service_job_material_usage
  WHERE id = p_usage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service job material usage not found: %', p_usage_id;
  END IF;

  business_id_val := usage_row.business_id;
  v_date := (usage_row.created_at AT TIME ZONE 'UTC')::DATE;

  PERFORM assert_accounting_period_is_open(business_id_val, v_date);

  PERFORM assert_account_exists(business_id_val, '1450');
  PERFORM assert_account_exists(business_id_val, '5110');

  cost_account_id := get_account_by_code(business_id_val, '5110');
  inventory_account_id := get_account_by_code(business_id_val, '1450');

  IF cost_account_id IS NULL OR inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Service ledger accounts (1450, 5110) not found for business %', business_id_val;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cost_account_id,
      'debit', usage_row.total_cost,
      'description', 'Cost of services - job material usage'
    ),
    jsonb_build_object(
      'account_id', inventory_account_id,
      'credit', usage_row.total_cost,
      'description', 'Service materials inventory'
    )
  );

  SELECT post_journal_entry(
    business_id_val,
    v_date,
    'Service job material usage',
    'service_job_usage',
    p_usage_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system',
    FALSE
  ) INTO journal_id;

  RETURN journal_id;
END;
$$;

COMMENT ON FUNCTION post_service_job_material_usage_to_ledger(UUID) IS
  'Posts service job material usage to ledger: Dr 5110 Cost of Services, Cr 1450 Service Materials Inventory. Idempotent. Period-guarded.';
