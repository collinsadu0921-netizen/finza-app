-- ============================================================================
-- Migration: Service job cancellation — materials_reversed + COGS reversal
-- Additive. Service only. No retail changes.
-- ============================================================================

-- Add flag to prevent double reversal
ALTER TABLE service_jobs
  ADD COLUMN IF NOT EXISTS materials_reversed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN service_jobs.materials_reversed IS 'True after stock restoration and COGS reversal on cancel/credit; prevents double reversal.';

-- ============================================================================
-- Function: Reverse COGS for a cancelled job (Dr 1450, Cr 5110)
-- Idempotent: no-op if already posted for this job.
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_service_job_cogs(p_job_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  business_id_val UUID;
  total_reversal NUMERIC;
  cost_account_id UUID;
  inventory_account_id UUID;
  journal_lines JSONB;
  journal_id UUID;
  v_date DATE;
BEGIN
  -- Idempotency: already posted
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'service_job_cancel' AND reference_id = p_job_id
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT business_id INTO business_id_val
  FROM service_jobs
  WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service job not found: %', p_job_id;
  END IF;

  SELECT COALESCE(SUM(total_cost), 0) INTO total_reversal
  FROM service_job_material_usage
  WHERE job_id = p_job_id AND business_id = business_id_val;

  IF total_reversal IS NULL OR total_reversal <= 0 THEN
    RETURN NULL;
  END IF;

  v_date := CURRENT_DATE;

  PERFORM assert_accounting_period_is_open(business_id_val, v_date);
  PERFORM assert_account_exists(business_id_val, '1450');
  PERFORM assert_account_exists(business_id_val, '5110');

  cost_account_id := get_account_by_code(business_id_val, '5110');
  inventory_account_id := get_account_by_code(business_id_val, '1450');

  IF cost_account_id IS NULL OR inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Service ledger accounts (1450, 5110) not found for business %', business_id_val;
  END IF;

  -- Reversal: Dr 1450 Service Materials Inventory, Cr 5110 Cost of Services
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', inventory_account_id,
      'debit', total_reversal,
      'description', 'Service job cancelled - restore materials inventory'
    ),
    jsonb_build_object(
      'account_id', cost_account_id,
      'credit', total_reversal,
      'description', 'Reverse cost of services'
    )
  );

  SELECT post_journal_entry(
    business_id_val,
    v_date,
    'Service job cancelled - reverse COGS',
    'service_job_cancel',
    p_job_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$;

COMMENT ON FUNCTION reverse_service_job_cogs(UUID) IS
  'Reverses COGS for a cancelled service job: Dr 1450, Cr 5110. Idempotent. Call after restoring stock.';
