-- ============================================================================
-- Migration 535: Service job material usage — atomic return integrity (Phase 1A)
-- Additive. Service only. No invoice fulfilment tables. No retail changes.
-- ============================================================================
-- Fixes: PATCH status=returned previously flipped status without restoring stock.
-- Adds authoritative return links + single RPC for qty + movement + per-usage COGS reverse.
-- Hardens job cancel COGS to exclude returned / non-consumed usages.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema: return audit columns on service_job_material_usage
-- ----------------------------------------------------------------------------

ALTER TABLE public.service_job_material_usage
  ADD COLUMN IF NOT EXISTS cogs_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_movement_id UUID REFERENCES public.service_material_movements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_date DATE,
  ADD COLUMN IF NOT EXISTS return_idempotency_key TEXT;

COMMENT ON COLUMN public.service_job_material_usage.cogs_journal_entry_id IS
  'Journal entry posted when status became consumed (Dr 5110 / Cr 1450).';
COMMENT ON COLUMN public.service_job_material_usage.return_movement_id IS
  'Stock movement created by return_service_job_material_usage. Authoritative return proof.';
COMMENT ON COLUMN public.service_job_material_usage.return_journal_entry_id IS
  'COGS reversal journal for this usage return (Dr 1450 / Cr 5110). Null when usage was never consumed.';
COMMENT ON COLUMN public.service_job_material_usage.return_idempotency_key IS
  'Client/server idempotency key for the return RPC.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_job_material_usage_return_idempotency
  ON public.service_job_material_usage (business_id, return_idempotency_key)
  WHERE return_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_job_material_usage_one_return_movement
  ON public.service_job_material_usage (return_movement_id)
  WHERE return_movement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_service_job_usage_return
  ON public.journal_entries (reference_type, reference_id)
  WHERE reference_type = 'service_job_usage_return' AND reference_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Persist COGS journal id when usage is consumed (additive to existing poster)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_service_job_material_usage_to_ledger(p_usage_id UUID)
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
    UPDATE service_job_material_usage
    SET cogs_journal_entry_id = COALESCE(cogs_journal_entry_id, journal_id)
    WHERE id = p_usage_id
      AND cogs_journal_entry_id IS NULL;
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

  UPDATE service_job_material_usage
  SET cogs_journal_entry_id = journal_id
  WHERE id = p_usage_id;

  RETURN journal_id;
END;
$$;

COMMENT ON FUNCTION public.post_service_job_material_usage_to_ledger(UUID) IS
  'Posts service job material usage to ledger: Dr 5110 / Cr 1450. Idempotent. Stores cogs_journal_entry_id on usage.';

-- ----------------------------------------------------------------------------
-- 3. Hardened job-cancel COGS: only unreverted consumed usages
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reverse_service_job_cogs(p_job_id UUID)
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
  -- Idempotency: already posted for this job cancel
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

  -- Only consumed usages that still have outstanding COGS (not returned per-usage)
  SELECT COALESCE(SUM(u.total_cost), 0) INTO total_reversal
  FROM service_job_material_usage u
  WHERE u.job_id = p_job_id
    AND u.business_id = business_id_val
    AND u.status = 'consumed'
    AND u.return_movement_id IS NULL
    AND u.return_journal_entry_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.reference_type = 'service_job_usage'
        AND je.reference_id = u.id
    );

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

COMMENT ON FUNCTION public.reverse_service_job_cogs(UUID) IS
  'Reverses COGS for cancelled service job for unreverted consumed usages only. Excludes returned usages. Idempotent.';

-- ----------------------------------------------------------------------------
-- 4. Authoritative return RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.return_service_job_material_usage(
  p_usage_id UUID,
  p_business_id UUID,
  p_return_date DATE,
  p_idempotency_key TEXT,
  p_returned_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage public.service_job_material_usage%ROWTYPE;
  v_job public.service_jobs%ROWTYPE;
  v_material public.service_material_inventory%ROWTYPE;
  v_qty NUMERIC;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_new_qty NUMERIC;
  v_movement_id UUID;
  v_cogs_je_id UUID;
  v_return_je_id UUID;
  v_cost_account_id UUID;
  v_inventory_account_id UUID;
  v_journal_lines JSONB;
  v_return_date DATE;
  v_key TEXT;
  v_existing_by_key public.service_job_material_usage%ROWTYPE;
BEGIN
  IF p_usage_id IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_ARGS: usage_id and business_id are required';
  END IF;

  v_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_ARGS: idempotency_key is required';
  END IF;

  v_return_date := COALESCE(p_return_date, CURRENT_DATE);

  -- Idempotent replay by key (same business)
  SELECT * INTO v_existing_by_key
  FROM service_job_material_usage
  WHERE business_id = p_business_id
    AND return_idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_by_key.id <> p_usage_id THEN
      RAISE EXCEPTION 'USAGE_RETURN_IDEMPOTENCY_CONFLICT: idempotency key already used for another usage';
    END IF;
    RETURN jsonb_build_object(
      'usage_id', v_existing_by_key.id,
      'status', v_existing_by_key.status,
      'quantity_restored', v_existing_by_key.quantity_used,
      'return_movement_id', v_existing_by_key.return_movement_id,
      'return_journal_entry_id', v_existing_by_key.return_journal_entry_id,
      'original_cogs_journal_entry_id', v_existing_by_key.cogs_journal_entry_id,
      'unit_cost', v_existing_by_key.unit_cost,
      'total_cost', v_existing_by_key.total_cost,
      'return_date', v_existing_by_key.return_date,
      'idempotent', TRUE
    );
  END IF;

  -- Lock usage row
  SELECT * INTO v_usage
  FROM service_job_material_usage
  WHERE id = p_usage_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USAGE_NOT_FOUND: usage record not found';
  END IF;

  IF v_usage.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: usage does not belong to business';
  END IF;

  -- Idempotent replay if already returned with this key (race after lock)
  IF v_usage.return_idempotency_key IS NOT NULL AND v_usage.return_idempotency_key = v_key THEN
    RETURN jsonb_build_object(
      'usage_id', v_usage.id,
      'status', v_usage.status,
      'quantity_restored', v_usage.quantity_used,
      'return_movement_id', v_usage.return_movement_id,
      'return_journal_entry_id', v_usage.return_journal_entry_id,
      'original_cogs_journal_entry_id', v_usage.cogs_journal_entry_id,
      'unit_cost', v_usage.unit_cost,
      'total_cost', v_usage.total_cost,
      'return_date', v_usage.return_date,
      'idempotent', TRUE
    );
  END IF;

  IF v_usage.status = 'returned'
     OR v_usage.return_movement_id IS NOT NULL
     OR v_usage.returned_at IS NOT NULL THEN
    RAISE EXCEPTION 'USAGE_ALREADY_RETURNED: usage has already been returned';
  END IF;

  IF v_usage.status NOT IN ('allocated', 'consumed') THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_STATUS: usage status % cannot be returned', v_usage.status;
  END IF;

  -- Lock parent job
  SELECT * INTO v_job
  FROM service_jobs
  WHERE id = v_usage.job_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND: parent job not found for business';
  END IF;

  IF v_job.materials_reversed IS TRUE THEN
    RAISE EXCEPTION 'JOB_MATERIALS_ALREADY_REVERSED: job materials were already restored on cancellation';
  END IF;

  -- Lock material
  SELECT * INTO v_material
  FROM service_material_inventory
  WHERE id = v_usage.material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATERIAL_NOT_FOUND: material not found';
  END IF;

  IF v_material.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: material does not belong to business';
  END IF;

  v_qty := v_usage.quantity_used;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_QTY: quantity_used must be positive';
  END IF;

  v_unit_cost := COALESCE(v_usage.unit_cost, 0);
  v_total_cost := COALESCE(v_usage.total_cost, ROUND(v_qty * v_unit_cost, 2));

  -- Resolve original COGS journal when consumed
  v_cogs_je_id := v_usage.cogs_journal_entry_id;
  IF v_usage.status = 'consumed' THEN
    IF v_cogs_je_id IS NULL THEN
      SELECT id INTO v_cogs_je_id
      FROM journal_entries
      WHERE reference_type = 'service_job_usage'
        AND reference_id = v_usage.id
      LIMIT 1;
    END IF;

    IF v_cogs_je_id IS NULL THEN
      RAISE EXCEPTION 'USAGE_COGS_LINK_MISSING: consumed usage has no COGS journal; refusing to guess';
    END IF;

    -- Period must be open for ledger reversal
    BEGIN
      PERFORM assert_accounting_period_is_open(p_business_id, v_return_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: %', SQLERRM;
    END;
  END IF;
  -- Allocated / unconsumed: quantity-only return; no period lock
  -- (matches existing manual stock-out / add-stock operational precedent).

  v_new_qty := COALESCE(v_material.quantity_on_hand, 0) + v_qty;

  UPDATE service_material_inventory
  SET quantity_on_hand = v_new_qty,
      updated_at = NOW()
  WHERE id = v_material.id
    AND business_id = p_business_id;

  INSERT INTO service_material_movements (
    business_id,
    material_id,
    movement_type,
    quantity,
    unit_cost,
    reference_id,
    movement_date,
    note
  ) VALUES (
    p_business_id,
    v_material.id,
    'return',
    v_qty,
    v_unit_cost,
    v_usage.job_id,
    v_return_date,
    'Job material usage return'
  )
  RETURNING id INTO v_movement_id;

  v_return_je_id := NULL;
  IF v_usage.status = 'consumed' THEN
    -- Idempotency for return journal
    SELECT id INTO v_return_je_id
    FROM journal_entries
    WHERE reference_type = 'service_job_usage_return'
      AND reference_id = v_usage.id
    LIMIT 1;

    IF v_return_je_id IS NULL THEN
      PERFORM assert_account_exists(p_business_id, '1450');
      PERFORM assert_account_exists(p_business_id, '5110');

      v_cost_account_id := get_account_by_code(p_business_id, '5110');
      v_inventory_account_id := get_account_by_code(p_business_id, '1450');

      IF v_cost_account_id IS NULL OR v_inventory_account_id IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Service ledger accounts (1450, 5110) not found';
      END IF;

      v_journal_lines := jsonb_build_array(
        jsonb_build_object(
          'account_id', v_inventory_account_id,
          'debit', v_total_cost,
          'description', 'Return job material - restore inventory'
        ),
        jsonb_build_object(
          'account_id', v_cost_account_id,
          'credit', v_total_cost,
          'description', 'Return job material - reverse COGS'
        )
      );

      SELECT post_journal_entry(
        p_business_id,
        v_return_date,
        'Service job material usage return',
        'service_job_usage_return',
        v_usage.id,
        v_journal_lines,
        FALSE,
        NULL,
        NULL,
        p_returned_by,
        NULL,
        NULL,
        NULL,
        NULL,
        'system',
        FALSE,
        v_cogs_je_id
      ) INTO v_return_je_id;
    END IF;
  END IF;

  UPDATE service_job_material_usage
  SET status = 'returned',
      cogs_journal_entry_id = COALESCE(cogs_journal_entry_id, v_cogs_je_id),
      return_movement_id = v_movement_id,
      return_journal_entry_id = v_return_je_id,
      returned_at = NOW(),
      returned_by = p_returned_by,
      return_date = v_return_date,
      return_idempotency_key = v_key
  WHERE id = v_usage.id
    AND business_id = p_business_id
    AND status IN ('allocated', 'consumed')
    AND return_movement_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USAGE_ALREADY_RETURNED: concurrent return won the race';
  END IF;

  RETURN jsonb_build_object(
    'usage_id', v_usage.id,
    'status', 'returned',
    'quantity_restored', v_qty,
    'return_movement_id', v_movement_id,
    'return_journal_entry_id', v_return_je_id,
    'original_cogs_journal_entry_id', v_cogs_je_id,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'return_date', v_return_date,
    'idempotent', FALSE
  );
END;
$$;

COMMENT ON FUNCTION public.return_service_job_material_usage(UUID, UUID, DATE, TEXT, UUID) IS
  'Atomically returns job material usage to stock; reverses per-usage COGS when consumed. Idempotent.';

GRANT EXECUTE ON FUNCTION public.return_service_job_material_usage(UUID, UUID, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_service_job_material_usage(UUID, UUID, DATE, TEXT, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Read-only historical diagnostic (no repairs)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.diagnose_service_job_material_returns(
  p_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  usage_id UUID,
  business_id UUID,
  job_id UUID,
  material_id UUID,
  quantity_used NUMERIC,
  unit_cost NUMERIC,
  total_cost NUMERIC,
  usage_status TEXT,
  job_status TEXT,
  materials_reversed BOOLEAN,
  has_return_movement BOOLEAN,
  has_cogs_journal BOOLEAN,
  has_return_journal BOOLEAN,
  has_cancel_cogs_journal BOOLEAN,
  classification TEXT,
  detail TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS usage_id,
    u.business_id,
    u.job_id,
    u.material_id,
    u.quantity_used,
    u.unit_cost,
    u.total_cost,
    u.status AS usage_status,
    j.status AS job_status,
    j.materials_reversed,
    (u.return_movement_id IS NOT NULL) AS has_return_movement,
    EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'service_job_usage' AND je.reference_id = u.id
    ) AS has_cogs_journal,
    (u.return_journal_entry_id IS NOT NULL) AS has_return_journal,
    EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'service_job_cancel' AND je.reference_id = u.job_id
    ) AS has_cancel_cogs_journal,
    CASE
      WHEN u.status = 'returned' AND u.return_movement_id IS NOT NULL THEN
        'Accounting reversal present'
      WHEN u.status = 'returned'
           AND u.return_movement_id IS NULL
           AND COALESCE(j.materials_reversed, FALSE) = FALSE THEN
        'Clearly not restored'
      WHEN u.status = 'returned'
           AND u.return_movement_id IS NULL
           AND COALESCE(j.materials_reversed, FALSE) = TRUE THEN
        'Possibly restored through cancellation'
      WHEN u.status = 'returned'
           AND u.return_movement_id IS NULL THEN
        'Possibly restored through manual adjustment'
      WHEN u.status <> 'returned'
           AND u.return_movement_id IS NOT NULL THEN
        'Ambiguous'
      ELSE
        'Ambiguous'
    END AS classification,
    CASE
      WHEN u.status = 'returned' AND u.return_movement_id IS NULL THEN
        'Historical status=returned without return_movement_id; review before any repair'
      ELSE
        'See classification'
    END AS detail
  FROM service_job_material_usage u
  JOIN service_jobs j ON j.id = u.job_id
  WHERE (p_business_id IS NULL OR u.business_id = p_business_id)
    AND (
      u.status = 'returned'
      OR u.return_movement_id IS NOT NULL
      OR u.return_journal_entry_id IS NOT NULL
    );
$$;

COMMENT ON FUNCTION public.diagnose_service_job_material_returns(UUID) IS
  'Read-only diagnostic for historical job material returns. Does not mutate data.';

GRANT EXECUTE ON FUNCTION public.diagnose_service_job_material_returns(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_service_job_material_returns(UUID) TO service_role;
