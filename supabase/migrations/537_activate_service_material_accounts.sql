-- ============================================================================
-- Migration 537: Targeted activation of Service material accounts 1450 / 5110
-- ============================================================================
-- Scope: active Service businesses only (industry = 'service', archived_at IS NULL).
-- Dual-table readiness: accounts + chart_of_accounts (assert_account_exists uses COA).
--
-- Safety:
--   - INSERT missing rows only (no broad ON CONFLICT DO UPDATE)
--   - Do not rename, reclassify, reactivate, delete, or overwrite
--   - Do not touch Retail / archived businesses
--   - Conflicts left unchanged; evidence via diagnose_service_material_account_readiness()
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-code status helper (read-only classification of one code for one business)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._service_material_code_status(
  p_business_id UUID,
  p_code TEXT,
  p_expected_accounts_type TEXT,
  p_expected_coa_type TEXT
)
RETURNS TABLE (
  status TEXT,
  accounts_exists BOOLEAN,
  accounts_id UUID,
  accounts_type TEXT,
  accounts_deleted BOOLEAN,
  coa_exists BOOLEAN,
  coa_id UUID,
  coa_type TEXT,
  coa_active BOOLEAN,
  conflict_detail TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc_id UUID;
  v_acc_type TEXT;
  v_acc_deleted BOOLEAN := FALSE;
  v_acc_count INT;
  v_coa_id UUID;
  v_coa_type TEXT;
  v_coa_active BOOLEAN;
  v_status TEXT;
BEGIN
  SELECT COUNT(*)::INT INTO v_acc_count
  FROM accounts a
  WHERE a.business_id = p_business_id AND a.code = p_code;

  SELECT a.id, a.type
  INTO v_acc_id, v_acc_type
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.code = p_code
    AND a.deleted_at IS NULL
  ORDER BY a.created_at NULLS LAST
  LIMIT 1;

  -- Soft-deleted only (UNIQUE still occupied) → conflict
  IF v_acc_id IS NULL AND v_acc_count > 0 THEN
    SELECT a.id, a.type, TRUE
    INTO v_acc_id, v_acc_type, v_acc_deleted
    FROM accounts a
    WHERE a.business_id = p_business_id AND a.code = p_code
    ORDER BY a.deleted_at DESC NULLS LAST
    LIMIT 1;

    SELECT c.id, c.account_type, c.is_active
    INTO v_coa_id, v_coa_type, v_coa_active
    FROM chart_of_accounts c
    WHERE c.business_id = p_business_id AND c.account_code = p_code
    LIMIT 1;

    RETURN QUERY SELECT
      'CONFLICT'::TEXT,
      TRUE,
      v_acc_id,
      v_acc_type,
      TRUE,
      (v_coa_id IS NOT NULL),
      v_coa_id,
      v_coa_type,
      COALESCE(v_coa_active, FALSE),
      format('Account %s exists only as soft-deleted; not reactivated', p_code);
    RETURN;
  END IF;

  -- Duplicate non-deleted rows (should be impossible under UNIQUE; defensive)
  IF (
    SELECT COUNT(*) FROM accounts a
    WHERE a.business_id = p_business_id AND a.code = p_code AND a.deleted_at IS NULL
  ) > 1 THEN
    SELECT c.id, c.account_type, c.is_active
    INTO v_coa_id, v_coa_type, v_coa_active
    FROM chart_of_accounts c
    WHERE c.business_id = p_business_id AND c.account_code = p_code
    LIMIT 1;

    RETURN QUERY SELECT
      'CONFLICT'::TEXT,
      TRUE,
      v_acc_id,
      v_acc_type,
      FALSE,
      (v_coa_id IS NOT NULL),
      v_coa_id,
      v_coa_type,
      COALESCE(v_coa_active, FALSE),
      format('Multiple active accounts rows for code %s', p_code);
    RETURN;
  END IF;

  SELECT c.id, c.account_type, c.is_active
  INTO v_coa_id, v_coa_type, v_coa_active
  FROM chart_of_accounts c
  WHERE c.business_id = p_business_id AND c.account_code = p_code
  LIMIT 1;

  -- Incompatible accounts type
  IF v_acc_id IS NOT NULL AND v_acc_type IS DISTINCT FROM p_expected_accounts_type THEN
    RETURN QUERY SELECT
      'CONFLICT'::TEXT,
      TRUE,
      v_acc_id,
      v_acc_type,
      FALSE,
      (v_coa_id IS NOT NULL),
      v_coa_id,
      v_coa_type,
      COALESCE(v_coa_active, FALSE),
      format('Account %s type %s incompatible with expected %s', p_code, v_acc_type, p_expected_accounts_type);
    RETURN;
  END IF;

  -- COA inactive → conflict (do not reactivate)
  IF v_coa_id IS NOT NULL AND COALESCE(v_coa_active, FALSE) IS NOT TRUE THEN
    RETURN QUERY SELECT
      'CONFLICT'::TEXT,
      (v_acc_id IS NOT NULL),
      v_acc_id,
      v_acc_type,
      FALSE,
      TRUE,
      v_coa_id,
      v_coa_type,
      FALSE,
      format('Account %s is inactive in chart_of_accounts', p_code);
    RETURN;
  END IF;

  -- COA type mismatch
  IF v_coa_id IS NOT NULL AND v_coa_type IS DISTINCT FROM p_expected_coa_type THEN
    RETURN QUERY SELECT
      'CONFLICT'::TEXT,
      (v_acc_id IS NOT NULL),
      v_acc_id,
      v_acc_type,
      FALSE,
      TRUE,
      v_coa_id,
      v_coa_type,
      COALESCE(v_coa_active, FALSE),
      format('COA %s type %s incompatible with expected %s', p_code, v_coa_type, p_expected_coa_type);
    RETURN;
  END IF;

  -- accounts vs COA type conflict when both present (after expected checks, still catch drift)
  IF v_acc_id IS NOT NULL AND v_coa_id IS NOT NULL THEN
    IF (CASE WHEN v_acc_type = 'income' THEN 'revenue' ELSE v_acc_type END) IS DISTINCT FROM v_coa_type THEN
      RETURN QUERY SELECT
        'CONFLICT'::TEXT,
        TRUE,
        v_acc_id,
        v_acc_type,
        FALSE,
        TRUE,
        v_coa_id,
        v_coa_type,
        COALESCE(v_coa_active, FALSE),
        format('accounts/COA type mismatch for %s (%s vs %s)', p_code, v_acc_type, v_coa_type);
      RETURN;
    END IF;
  END IF;

  -- COA present without accounts (unexpected mapping) → conflict; do not invent accounts overwrite path
  IF v_acc_id IS NULL AND v_coa_id IS NOT NULL THEN
    RETURN QUERY SELECT
      'CONFLICT'::TEXT,
      FALSE,
      NULL::UUID,
      NULL::TEXT,
      FALSE,
      TRUE,
      v_coa_id,
      v_coa_type,
      COALESCE(v_coa_active, FALSE),
      format('COA %s exists without matching accounts row', p_code);
    RETURN;
  END IF;

  IF v_acc_id IS NOT NULL AND v_coa_id IS NOT NULL THEN
    v_status := 'READY';
  ELSIF v_acc_id IS NOT NULL AND v_coa_id IS NULL THEN
    v_status := 'ACCOUNTS_PRESENT_COA_MISSING';
  ELSE
    v_status := 'MISSING';
  END IF;

  RETURN QUERY SELECT
    v_status,
    (v_acc_id IS NOT NULL),
    v_acc_id,
    v_acc_type,
    FALSE,
    (v_coa_id IS NOT NULL),
    v_coa_id,
    v_coa_type,
    COALESCE(v_coa_active, FALSE),
    NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION public._service_material_code_status(UUID, TEXT, TEXT, TEXT) IS
  'Internal read-only status for Service material account code dual-table readiness.';

-- ---------------------------------------------------------------------------
-- Read-only diagnostic across active Service businesses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.diagnose_service_material_account_readiness(
  p_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  business_id UUID,
  classification TEXT,
  accounts_1450_exists BOOLEAN,
  coa_1450_exists BOOLEAN,
  accounts_1450_type TEXT,
  coa_1450_type TEXT,
  accounts_1450_active BOOLEAN,
  coa_1450_active BOOLEAN,
  accounts_5110_exists BOOLEAN,
  coa_5110_exists BOOLEAN,
  accounts_5110_type TEXT,
  coa_5110_type TEXT,
  accounts_5110_active BOOLEAN,
  coa_5110_active BOOLEAN,
  conflict_detail TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  s1450 RECORD;
  s5110 RECORD;
  v_class TEXT;
  v_detail TEXT;
BEGIN
  FOR r IN
    SELECT b.id
    FROM businesses b
    WHERE b.industry = 'service'
      AND b.archived_at IS NULL
      AND (p_business_id IS NULL OR b.id = p_business_id)
    ORDER BY b.id
  LOOP
    SELECT * INTO s1450
    FROM public._service_material_code_status(r.id, '1450', 'asset', 'asset');

    SELECT * INTO s5110
    FROM public._service_material_code_status(r.id, '5110', 'expense', 'expense');

    v_detail := NULLIF(concat_ws('; ', s1450.conflict_detail, s5110.conflict_detail), '');

    IF s1450.status = 'CONFLICT' OR s5110.status = 'CONFLICT' THEN
      v_class := 'CONFLICT';
    ELSIF s1450.status = 'READY' AND s5110.status = 'READY' THEN
      v_class := 'FULLY_READY';
    ELSIF s1450.status = 'MISSING' AND s5110.status = 'MISSING' THEN
      v_class := 'BOTH_MISSING';
    ELSIF s1450.status IN ('READY', 'ACCOUNTS_PRESENT_COA_MISSING')
      AND s5110.status IN ('READY', 'ACCOUNTS_PRESENT_COA_MISSING')
      AND (
        s1450.status = 'ACCOUNTS_PRESENT_COA_MISSING'
        OR s5110.status = 'ACCOUNTS_PRESENT_COA_MISSING'
      ) THEN
      -- Both codes have accounts rows; at least one COA row is missing
      v_class := 'ACCOUNTS_PRESENT_COA_MISSING';
    ELSE
      v_class := 'PARTIAL_SETUP';
    END IF;

    business_id := r.id;
    classification := v_class;
    accounts_1450_exists := s1450.accounts_exists AND NOT COALESCE(s1450.accounts_deleted, FALSE);
    coa_1450_exists := s1450.coa_exists;
    accounts_1450_type := s1450.accounts_type;
    coa_1450_type := s1450.coa_type;
    accounts_1450_active := s1450.accounts_exists AND NOT COALESCE(s1450.accounts_deleted, FALSE);
    coa_1450_active := s1450.coa_active;
    accounts_5110_exists := s5110.accounts_exists AND NOT COALESCE(s5110.accounts_deleted, FALSE);
    coa_5110_exists := s5110.coa_exists;
    accounts_5110_type := s5110.accounts_type;
    coa_5110_type := s5110.coa_type;
    accounts_5110_active := s5110.accounts_exists AND NOT COALESCE(s5110.accounts_deleted, FALSE);
    coa_5110_active := s5110.coa_active;
    conflict_detail := v_detail;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.diagnose_service_material_account_readiness(UUID) IS
  'Read-only readiness of Service material accounts 1450/5110 across accounts + chart_of_accounts.';

REVOKE ALL ON FUNCTION public.diagnose_service_material_account_readiness(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diagnose_service_material_account_readiness(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_service_material_account_readiness(UUID) TO service_role;

-- Drop obsolete zero-arg overload if present (ambiguous with DEFAULT NULL UUID arg)
DROP FUNCTION IF EXISTS public.diagnose_service_material_account_readiness();

-- ---------------------------------------------------------------------------
-- Activation: insert missing rows only for eligible Service businesses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_service_material_accounts(
  p_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  business_id UUID,
  code TEXT,
  action TEXT,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  s RECORD;
  v_codes TEXT[] := ARRAY['1450', '5110'];
  v_code TEXT;
  v_expected_acc TEXT;
  v_expected_coa TEXT;
  v_name TEXT;
  v_desc TEXT;
  v_acc_id UUID;
  v_acc_name TEXT;
  v_acc_type TEXT;
  v_coa_type TEXT;
BEGIN
  FOR r IN
    SELECT b.id
    FROM businesses b
    WHERE b.industry = 'service'
      AND b.archived_at IS NULL
      AND (p_business_id IS NULL OR b.id = p_business_id)
    ORDER BY b.id
  LOOP
    FOREACH v_code IN ARRAY v_codes
    LOOP
      IF v_code = '1450' THEN
        v_expected_acc := 'asset';
        v_expected_coa := 'asset';
        v_name := 'Service Materials Inventory';
        v_desc := 'Service materials stock';
      ELSE
        v_expected_acc := 'expense';
        v_expected_coa := 'expense';
        v_name := 'Cost of Services';
        v_desc := 'Cost of services (material usage)';
      END IF;

      SELECT * INTO s
      FROM public._service_material_code_status(r.id, v_code, v_expected_acc, v_expected_coa);

      IF s.status = 'CONFLICT' THEN
        business_id := r.id;
        code := v_code;
        action := 'SKIPPED_CONFLICT';
        detail := s.conflict_detail;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF s.status = 'READY' THEN
        business_id := r.id;
        code := v_code;
        action := 'NO_CHANGE';
        detail := 'Already dual-table ready';
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- Class C / partial missing: insert accounts when fully absent
      IF s.status = 'MISSING' THEN
        INSERT INTO accounts (business_id, name, code, type, description, is_system)
        SELECT r.id, v_name, v_code, v_expected_acc, v_desc, TRUE
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts a
          WHERE a.business_id = r.id AND a.code = v_code
        )
        ON CONFLICT ON CONSTRAINT accounts_business_id_code_key DO NOTHING;

        SELECT a.id, a.name, a.type
        INTO v_acc_id, v_acc_name, v_acc_type
        FROM accounts a
        WHERE a.business_id = r.id AND a.code = v_code AND a.deleted_at IS NULL
        LIMIT 1;

        IF v_acc_id IS NULL THEN
          business_id := r.id;
          code := v_code;
          action := 'SKIPPED_CONFLICT';
          detail := format('Could not insert accounts %s (unique/soft-delete conflict)', v_code);
          RETURN NEXT;
          CONTINUE;
        END IF;

        business_id := r.id;
        code := v_code;
        action := 'INSERTED_ACCOUNTS';
        detail := format('accounts.id=%s', v_acc_id);
        RETURN NEXT;
      ELSE
        -- ACCOUNTS_PRESENT_COA_MISSING
        SELECT a.id, a.name, a.type
        INTO v_acc_id, v_acc_name, v_acc_type
        FROM accounts a
        WHERE a.business_id = r.id AND a.code = v_code AND a.deleted_at IS NULL
        LIMIT 1;
      END IF;

      -- Insert missing COA from existing accounts values (never overwrite)
      IF v_acc_id IS NOT NULL THEN
        v_coa_type := CASE WHEN v_acc_type = 'income' THEN 'revenue' ELSE v_acc_type END;

        -- Only insert when accounts type matches expected (status already gated)
        INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
        SELECT r.id, v_code, v_acc_name, v_coa_type, TRUE
        WHERE NOT EXISTS (
          SELECT 1 FROM chart_of_accounts c
          WHERE c.business_id = r.id AND c.account_code = v_code
        )
        ON CONFLICT ON CONSTRAINT chart_of_accounts_business_id_account_code_key DO NOTHING;

        IF EXISTS (
          SELECT 1 FROM chart_of_accounts c
          WHERE c.business_id = r.id AND c.account_code = v_code AND c.is_active IS TRUE
            AND c.account_type = v_expected_coa
        ) THEN
          business_id := r.id;
          code := v_code;
          action := CASE
            WHEN s.status = 'MISSING' THEN 'INSERTED_COA'
            ELSE 'INSERTED_COA'
          END;
          detail := format('COA aligned from accounts.id=%s name=%s type=%s', v_acc_id, v_acc_name, v_coa_type);
          RETURN NEXT;
        ELSE
          business_id := r.id;
          code := v_code;
          action := 'SKIPPED_CONFLICT';
          detail := format('COA insert did not yield active %s/%s', v_code, v_expected_coa);
          RETURN NEXT;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.activate_service_material_accounts(UUID) IS
  'Idempotent targeted insert of Service material accounts 1450/5110 into accounts + chart_of_accounts. Skips conflicts.';

REVOKE ALL ON FUNCTION public.activate_service_material_accounts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_service_material_accounts(UUID) TO service_role;

-- Drop obsolete zero-arg overload if present (ambiguous with DEFAULT NULL UUID arg)
DROP FUNCTION IF EXISTS public.activate_service_material_accounts();

-- ---------------------------------------------------------------------------
-- Permanent onboarding: wire into authoritative accounting initialization
-- Sequence: create_system_accounts → activate (Service only) → COA sync → period
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_accounting_initialized(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE;
  v_period_exists BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = p_business_id AND b.owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN (
        'admin',
        'accountant',
        'manager',
        'staff',
        'cashier',
        'employee'
      )
  ) THEN
    RAISE EXCEPTION 'Not allowed to initialize accounting for this business'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM create_system_accounts(p_business_id);
  -- No-op for non-Service / archived businesses (industry filter inside activator)
  PERFORM 1 FROM public.activate_service_material_accounts(p_business_id);
  PERFORM initialize_business_chart_of_accounts(p_business_id);

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE business_id = p_business_id
  ) INTO v_period_exists;

  IF NOT v_period_exists THEN
    SELECT COALESCE(
      (SELECT (b.start_date)::DATE FROM businesses b WHERE b.id = p_business_id),
      DATE_TRUNC('month', CURRENT_DATE)::DATE
    ) INTO v_start_date;

    PERFORM initialize_business_accounting_period(p_business_id, v_start_date);
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.ensure_accounting_initialized(UUID) IS
  'Idempotent Fortnox-style bootstrap. Owner or business_users role. Ensures system accounts, Service material accounts (1450/5110 when industry=service), chart sync, control mappings, and at least one period.';

GRANT EXECUTE ON FUNCTION public.ensure_accounting_initialized(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_accounting_initialized_system(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE;
  v_period_exists BOOLEAN;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id is required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM create_system_accounts(p_business_id);
  PERFORM 1 FROM public.activate_service_material_accounts(p_business_id);
  PERFORM initialize_business_chart_of_accounts(p_business_id);

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE business_id = p_business_id
  ) INTO v_period_exists;

  IF NOT v_period_exists THEN
    SELECT COALESCE(
      (SELECT (b.start_date)::DATE FROM businesses b WHERE b.id = p_business_id),
      DATE_TRUNC('month', CURRENT_DATE)::DATE
    ) INTO v_start_date;

    PERFORM initialize_business_accounting_period(p_business_id, v_start_date);
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.ensure_accounting_initialized_system(UUID) IS
  'Idempotent accounting bootstrap for trusted server jobs. Includes Service material accounts when industry=service. service_role only.';

REVOKE ALL ON FUNCTION public.ensure_accounting_initialized_system(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_accounting_initialized_system(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- One-time activation for all eligible Service businesses (idempotent)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_inserted_accounts INT := 0;
  v_inserted_coa INT := 0;
  v_skipped INT := 0;
  v_ready INT := 0;
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM public.activate_service_material_accounts(NULL)
  LOOP
    IF r.action = 'INSERTED_ACCOUNTS' THEN
      v_inserted_accounts := v_inserted_accounts + 1;
    ELSIF r.action = 'INSERTED_COA' THEN
      v_inserted_coa := v_inserted_coa + 1;
    ELSIF r.action = 'SKIPPED_CONFLICT' THEN
      v_skipped := v_skipped + 1;
    ELSIF r.action = 'NO_CHANGE' THEN
      v_ready := v_ready + 1;
    END IF;
  END LOOP;

  RAISE NOTICE
    '537 activate_service_material_accounts: inserted_accounts=% inserted_coa=% no_change=% skipped_conflict=%',
    v_inserted_accounts, v_inserted_coa, v_ready, v_skipped;
END;
$$;
