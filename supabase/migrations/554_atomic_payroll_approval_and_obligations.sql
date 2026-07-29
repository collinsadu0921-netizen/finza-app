-- ============================================================================
-- Migration 554: Atomic payroll approval + obligation generation
-- ============================================================================
-- One transaction owns: lock → validate → journal (+ advance recoveries via 553) →
-- obligations → status → audit.
-- Does NOT rewrite migrations 552/553. Does NOT backfill historical runs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Uniqueness: one payroll journal per run (authoritative reference)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT business_id, reference_id
      FROM public.journal_entries
      WHERE reference_type = 'payroll'
        AND reference_id IS NOT NULL
      GROUP BY business_id, reference_id
      HAVING COUNT(*) > 1
    ) d
  ) THEN
    RAISE NOTICE 'Skipping ux_journal_entries_one_payroll_reference: duplicate payroll journals exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_entries_one_payroll_reference
      ON public.journal_entries (business_id, reference_id)
      WHERE reference_type = 'payroll' AND reference_id IS NOT NULL;
  END IF;
END $$;

-- One approval audit event per payroll run
CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_logs_payroll_run_approved
  ON public.audit_logs (business_id, entity_id)
  WHERE action_type = 'payroll.run_approved'
    AND entity_type = 'payroll_run'
    AND entity_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_next_month_paye_due_date(p_payroll_month DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT make_date(
    EXTRACT(YEAR FROM (date_trunc('month', p_payroll_month) + INTERVAL '1 month'))::INT,
    EXTRACT(MONTH FROM (date_trunc('month', p_payroll_month) + INTERVAL '1 month'))::INT,
    15
  );
$$;

CREATE OR REPLACE FUNCTION public.payroll_obligation_status(p_due NUMERIC, p_paid NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_due, 0) <= 0 OR GREATEST(0, COALESCE(p_due, 0) - COALESCE(p_paid, 0)) <= 0.01 THEN 'paid'
    WHEN COALESCE(p_paid, 0) > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END;
$$;

CREATE OR REPLACE FUNCTION public.raise_payroll_approval_error(
  p_code TEXT,
  p_message TEXT,
  p_detail JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%', p_message
    USING ERRCODE = 'P0001',
          DETAIL = COALESCE(p_detail, jsonb_build_object('code', p_code))::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- Obligation sync (approval transaction)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_payroll_obligations_for_approval(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_tier1_snap NUMERIC := 0;
  v_tier2_snap NUMERIC := 0;
  v_aggregate_pension NUMERIC := 0;
  v_tier1 NUMERIC := 0;
  v_tier2 NUMERIC := 0;
  v_advance_recovered NUMERIC := 0;
  v_other_due NUMERIC := 0;
  v_other_paid NUMERIC := 0;
  v_has_2232 BOOLEAN := false;
  v_tier1_code TEXT := '2231';
  v_tier2_code TEXT := '2232';
  v_existing RECORD;
  v_ids JSONB := '[]'::jsonb;
  v_id UUID;
BEGIN
  SELECT *
  INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_OBLIGATION_FAILED',
      'Payroll run not found for obligation sync'
    );
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0),
    COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0)
  INTO v_tier1_snap, v_tier2_snap
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id;

  v_aggregate_pension := COALESCE(v_run.total_ssnit_employee, 0) + COALESCE(v_run.total_ssnit_employer, 0);

  IF v_aggregate_pension <= 0.01 THEN
    v_tier1 := 0;
    v_tier2 := 0;
  ELSIF
    v_tier1_snap >= 0
    AND v_tier2_snap >= 0
    AND (v_tier1_snap + v_tier2_snap) > 0.01
    AND ABS((v_tier1_snap + v_tier2_snap) - v_aggregate_pension) <= 0.02
  THEN
    v_tier1 := ROUND(v_tier1_snap::NUMERIC, 2);
    v_tier2 := ROUND(v_tier2_snap::NUMERIC, 2);
  ELSE
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_OBLIGATION_FAILED',
      'Pension tier snapshots do not reconcile to payroll pension totals',
      jsonb_build_object(
        'code', 'PAYROLL_APPROVAL_OBLIGATION_FAILED',
        'tier1Snapshot', v_tier1_snap,
        'tier2Snapshot', v_tier2_snap,
        'aggregatePension', v_aggregate_pension
      )
    );
  END IF;

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_recovered
  FROM public.salary_advance_repayments sar
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted';

  SELECT EXISTS (
    SELECT 1
    FROM public.journal_entry_lines jel
    JOIN public.accounts a ON a.id = jel.account_id
    WHERE jel.journal_entry_id = v_run.journal_entry_id
      AND a.business_id = p_business_id
      AND a.code = '2232'
      AND a.deleted_at IS NULL
      AND jel.credit > 0.01
  ) INTO v_has_2232;

  IF NOT v_has_2232 THEN
    v_tier1_code := '2231';
    v_tier2_code := '2231';
  END IF;

  PERFORM 1
  FROM public.payroll_obligations o
  WHERE o.business_id = p_business_id
    AND o.payroll_run_id = p_payroll_run_id
    AND o.deleted_at IS NULL
  ORDER BY o.obligation_type, o.id
  FOR UPDATE;

  -- salary_net
  IF COALESCE(v_run.total_net_salary, 0) > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'salary_net'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF COALESCE(v_existing.amount_paid, 0) > 0.01
         AND ABS(COALESCE(v_existing.amount_due, 0) - COALESCE(v_run.total_net_salary, 0)) > 0.01 THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting salary_net obligation amount for paid/partially paid row'
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'Net salaries payable',
        amount_due = ROUND(v_run.total_net_salary::NUMERIC, 2),
        amount_paid = LEAST(COALESCE(amount_paid, 0), ROUND(v_run.total_net_salary::NUMERIC, 2)),
        due_date = v_run.payroll_month,
        liability_account_code = '2240',
        status = public.payroll_obligation_status(
          ROUND(v_run.total_net_salary::NUMERIC, 2),
          LEAST(COALESCE(amount_paid, 0), ROUND(v_run.total_net_salary::NUMERIC, 2))
        ),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'salary_net', 'Net salaries payable',
        ROUND(v_run.total_net_salary::NUMERIC, 2), 0, 'unpaid', v_run.payroll_month, '2240'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'salary_net', 'id', v_id, 'amount', ROUND(v_run.total_net_salary::NUMERIC, 2)));
  END IF;

  -- paye_gra
  IF COALESCE(v_run.total_paye, 0) > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'paye_gra'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF COALESCE(v_existing.amount_paid, 0) > 0.01
         AND ABS(COALESCE(v_existing.amount_due, 0) - COALESCE(v_run.total_paye, 0)) > 0.01 THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting paye_gra obligation amount for paid/partially paid row'
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'PAYE payable to GRA',
        amount_due = ROUND(v_run.total_paye::NUMERIC, 2),
        amount_paid = LEAST(COALESCE(amount_paid, 0), ROUND(v_run.total_paye::NUMERIC, 2)),
        due_date = public.payroll_next_month_paye_due_date(v_run.payroll_month),
        liability_account_code = '2230',
        status = public.payroll_obligation_status(
          ROUND(v_run.total_paye::NUMERIC, 2),
          LEAST(COALESCE(amount_paid, 0), ROUND(v_run.total_paye::NUMERIC, 2))
        ),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'paye_gra', 'PAYE payable to GRA',
        ROUND(v_run.total_paye::NUMERIC, 2), 0, 'unpaid',
        public.payroll_next_month_paye_due_date(v_run.payroll_month), '2230'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'paye_gra', 'id', v_id, 'amount', ROUND(v_run.total_paye::NUMERIC, 2)));
  END IF;

  -- ssnit_tier1
  IF v_tier1 > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'ssnit_tier1'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF COALESCE(v_existing.amount_paid, 0) > 0.01
         AND ABS(COALESCE(v_existing.amount_due, 0) - v_tier1) > 0.01 THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting ssnit_tier1 obligation amount for paid/partially paid row'
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'SSNIT / Tier 1 pension remittance',
        amount_due = v_tier1,
        amount_paid = LEAST(COALESCE(amount_paid, 0), v_tier1),
        due_date = NULL,
        liability_account_code = v_tier1_code,
        status = public.payroll_obligation_status(v_tier1, LEAST(COALESCE(amount_paid, 0), v_tier1)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'ssnit_tier1', 'SSNIT / Tier 1 pension remittance',
        v_tier1, 0, 'unpaid', NULL, v_tier1_code
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'ssnit_tier1', 'id', v_id, 'amount', v_tier1));
  END IF;

  -- tier2_pension
  IF v_tier2 > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'tier2_pension'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF COALESCE(v_existing.amount_paid, 0) > 0.01
         AND ABS(COALESCE(v_existing.amount_due, 0) - v_tier2) > 0.01 THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting tier2_pension obligation amount for paid/partially paid row'
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'Tier 2 pension remittance',
        amount_due = v_tier2,
        amount_paid = LEAST(COALESCE(amount_paid, 0), v_tier2),
        due_date = NULL,
        liability_account_code = v_tier2_code,
        status = public.payroll_obligation_status(v_tier2, LEAST(COALESCE(amount_paid, 0), v_tier2)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'tier2_pension', 'Tier 2 pension remittance',
        v_tier2, 0, 'unpaid', NULL, v_tier2_code
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'tier2_pension', 'id', v_id, 'amount', v_tier2));
  END IF;

  -- other_employee_deductions: amount_due = total deductions; advance recoveries marked paid (internal clear)
  v_other_due := ROUND(COALESCE(v_run.total_deductions, 0)::NUMERIC, 2);
  v_other_paid := CASE
    WHEN v_other_due <= 0.01 OR v_advance_recovered <= 0.01 THEN 0
    ELSE LEAST(v_other_due, ROUND(v_advance_recovered::NUMERIC, 2))
  END;

  IF v_other_due > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'other_employee_deductions'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF COALESCE(v_existing.amount_paid, 0) > 0.01
         AND ABS(COALESCE(v_existing.amount_due, 0) - v_other_due) > 0.01 THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting other_employee_deductions obligation amount for paid/partially paid row'
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = CASE
          WHEN v_other_paid >= v_other_due - 0.01 THEN 'Salary advance recoveries'
          ELSE 'Employee deductions / recoveries'
        END,
        amount_due = v_other_due,
        amount_paid = LEAST(v_other_due, GREATEST(COALESCE(amount_paid, 0), v_other_paid)),
        due_date = NULL,
        liability_account_code = '2241',
        status = public.payroll_obligation_status(
          v_other_due,
          LEAST(v_other_due, GREATEST(COALESCE(amount_paid, 0), v_other_paid))
        ),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'other_employee_deductions',
        CASE
          WHEN v_other_paid >= v_other_due - 0.01 THEN 'Salary advance recoveries'
          ELSE 'Employee deductions / recoveries'
        END,
        v_other_due, v_other_paid,
        public.payroll_obligation_status(v_other_due, v_other_paid),
        NULL, '2241'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object(
      'type', 'other_employee_deductions',
      'id', v_id,
      'amount', v_other_due,
      'amountPaid', v_other_paid,
      'excludedAdvanceRecoveries', v_other_paid
    ));
  END IF;

  RETURN jsonb_build_object(
    'obligations', v_ids,
    'tier1', v_tier1,
    'tier2', v_tier2,
    'advanceRecovered', v_advance_recovered,
    'otherDeductionsDue', v_other_due,
    'otherDeductionsPaidInternal', v_other_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Consistency check for reused approvals
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_approval_obligations_consistent(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_tier1 NUMERIC;
  v_tier2 NUMERIC;
  v_agg NUMERIC;
  v_t1s NUMERIC;
  v_t2s NUMERIC;
  v_obl NUMERIC;
BEGIN
  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT COALESCE(SUM(tier1_ssnit_remittance),0), COALESCE(SUM(tier2_pension_remittance),0)
  INTO v_t1s, v_t2s
  FROM public.payroll_entries WHERE payroll_run_id = p_payroll_run_id;

  v_agg := COALESCE(v_run.total_ssnit_employee,0) + COALESCE(v_run.total_ssnit_employer,0);
  IF v_agg <= 0.01 THEN
    v_tier1 := 0; v_tier2 := 0;
  ELSIF ABS((v_t1s + v_t2s) - v_agg) <= 0.02 THEN
    v_tier1 := ROUND(v_t1s, 2); v_tier2 := ROUND(v_t2s, 2);
  ELSE
    RETURN FALSE;
  END IF;

  IF COALESCE(v_run.total_net_salary,0) > 0.01 THEN
    SELECT amount_due INTO v_obl FROM public.payroll_obligations
    WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'salary_net' AND deleted_at IS NULL;
    IF v_obl IS NULL OR ABS(v_obl - v_run.total_net_salary) > 0.01 THEN RETURN FALSE; END IF;
  END IF;

  IF COALESCE(v_run.total_paye,0) > 0.01 THEN
    SELECT amount_due INTO v_obl FROM public.payroll_obligations
    WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'paye_gra' AND deleted_at IS NULL;
    IF v_obl IS NULL OR ABS(v_obl - v_run.total_paye) > 0.01 THEN RETURN FALSE; END IF;
  END IF;

  IF v_tier1 > 0.01 THEN
    SELECT amount_due INTO v_obl FROM public.payroll_obligations
    WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'ssnit_tier1' AND deleted_at IS NULL;
    IF v_obl IS NULL OR ABS(v_obl - v_tier1) > 0.01 THEN RETURN FALSE; END IF;
  END IF;

  IF v_tier2 > 0.01 THEN
    SELECT amount_due INTO v_obl FROM public.payroll_obligations
    WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'tier2_pension' AND deleted_at IS NULL;
    IF v_obl IS NULL OR ABS(v_obl - v_tier2) > 0.01 THEN RETURN FALSE; END IF;
  END IF;

  IF COALESCE(v_run.total_deductions,0) > 0.01 THEN
    SELECT amount_due INTO v_obl FROM public.payroll_obligations
    WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'other_employee_deductions' AND deleted_at IS NULL;
    IF v_obl IS NULL OR ABS(v_obl - v_run.total_deductions) > 0.01 THEN RETURN FALSE; END IF;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Ghana readiness (immutable entry snapshots; no live staff repair)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_run_for_approval(
  p_business_id UUID,
  p_run public.payroll_runs,
  p_entry_count INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_country TEXT;
  v_is_ghana BOOLEAN := false;
  v_period DATE;
  v_paye TEXT;
  v_pension TEXT;
  v_engine TEXT;
  v_jurisdiction TEXT;
  v_frequency TEXT;
  v_entry RECORD;
  v_profile JSONB;
  v_emp TEXT;
  v_class TEXT;
  v_affected JSONB := '[]'::jsonb;
  v_paye_ok BOOLEAN;
  v_pension_ok BOOLEAN;
  v_entry_period DATE;
BEGIN
  SELECT LOWER(TRIM(COALESCE(b.address_country, '')))
  INTO v_country
  FROM public.businesses b
  WHERE b.id = p_business_id;

  v_is_ghana := v_country IN ('gh', 'ghana') OR v_country LIKE '%ghana%';

  IF NOT v_is_ghana THEN
    RETURN;
  END IF;

  IF p_entry_count < 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      'Payroll run has no included entries to approve'
    );
  END IF;

  v_engine := NULLIF(TRIM(COALESCE(p_run.calculation_engine_version, '')), '');
  v_paye := NULLIF(TRIM(COALESCE(p_run.paye_rate_version, '')), '');
  v_pension := NULLIF(TRIM(COALESCE(p_run.pension_rate_version, '')), '');
  v_jurisdiction := UPPER(NULLIF(TRIM(COALESCE(p_run.calculation_jurisdiction, '')), ''));
  v_frequency := LOWER(NULLIF(TRIM(COALESCE(p_run.payroll_frequency, '')), ''));

  BEGIN
    v_period := NULLIF(TRIM(COALESCE(p_run.statutory_period_basis::text, '')), '')::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_period := NULL;
  END;
  IF v_period IS NULL THEN
    v_period := p_run.payroll_month;
  END IF;

  IF v_engine IS NULL OR v_paye IS NULL OR v_pension IS NULL OR v_jurisdiction IS NULL OR v_frequency IS NULL OR v_period IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      'This payroll run is missing a recognized Ghana calculation-engine, jurisdiction, period basis, frequency, or statutory-rate version and cannot be approved.'
    );
  END IF;

  IF v_engine <> 'finza-ghana-v2' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Unrecognized Ghana calculation engine version "%s". Expected finza-ghana-v2.', v_engine)
    );
  END IF;

  IF v_jurisdiction <> 'GH' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      format('Ghana payroll approval requires calculation_jurisdiction "GH" (received "%s").', v_jurisdiction)
    );
  END IF;

  IF v_frequency <> 'monthly' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      format('Ghana payroll approval currently requires monthly frequency (received "%s").', v_frequency)
    );
  END IF;

  IF v_period < DATE '2024-01-01' OR v_period > DATE '2026-12-31' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Ghana payroll period %s is outside the verified statutory support window (2024-01-01 through 2026-12-31).', v_period)
    );
  END IF;

  v_paye_ok := (v_paye = 'gh-paye-2024-01' AND v_period BETWEEN DATE '2024-01-01' AND DATE '2026-12-31');
  v_pension_ok :=
    (v_pension = 'gh-pension-2024-01' AND v_period BETWEEN DATE '2024-01-01' AND DATE '2024-12-31')
    OR (v_pension = 'gh-pension-2025-01' AND v_period BETWEEN DATE '2025-01-01' AND DATE '2025-12-31')
    OR (v_pension = 'gh-pension-2026-01' AND v_period BETWEEN DATE '2026-01-01' AND DATE '2026-12-31');

  IF NOT v_paye_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Ghana PAYE version "%s" does not cover stored period %s.', v_paye, v_period)
    );
  END IF;
  IF NOT v_pension_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Ghana pension version "%s" does not cover stored period %s.', v_pension, v_period)
    );
  END IF;

  FOR v_entry IN
    SELECT pe.*
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_run.id
      AND pe.is_included IS DISTINCT FROM FALSE
    ORDER BY pe.id
  LOOP
    IF v_entry.calculation_engine_version IS NULL
       OR v_entry.paye_rate_version IS NULL
       OR v_entry.pension_rate_version IS NULL
       OR v_entry.calculation_jurisdiction IS NULL
       OR v_entry.statutory_period_basis IS NULL THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'missing_rate_version_snapshot'
      ));
      CONTINUE;
    END IF;

    IF v_entry.calculation_engine_version IS DISTINCT FROM p_run.calculation_engine_version THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id, 'unsupportedClassification', 'engine_version_mismatch'
      ));
    END IF;
    IF v_entry.paye_rate_version IS DISTINCT FROM p_run.paye_rate_version THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id, 'unsupportedClassification', 'paye_version_mismatch'
      ));
    END IF;
    IF v_entry.pension_rate_version IS DISTINCT FROM p_run.pension_rate_version THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id, 'unsupportedClassification', 'pension_version_mismatch'
      ));
    END IF;
    IF UPPER(TRIM(COALESCE(v_entry.calculation_jurisdiction, ''))) IS DISTINCT FROM v_jurisdiction THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id, 'unsupportedClassification', 'jurisdiction_mismatch'
      ));
    END IF;

    BEGIN
      v_entry_period := DATE(v_entry.statutory_period_basis);
      IF v_entry_period IS DISTINCT FROM v_period THEN
        v_affected := v_affected || jsonb_build_array(jsonb_build_object(
          'staffId', v_entry.staff_id, 'unsupportedClassification', 'statutory_period_mismatch'
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id, 'unsupportedClassification', 'statutory_period_mismatch'
      ));
    END;

    v_profile := v_entry.payroll_tax_profile;
    v_class := NULL;
    IF v_profile IS NULL OR jsonb_typeof(v_profile) <> 'object' THEN
      v_class := 'missing_tax_profile_snapshot';
    ELSIF NOT (v_profile ? 'staff_is_tax_resident') OR jsonb_typeof(v_profile->'staff_is_tax_resident') <> 'boolean' THEN
      v_class := 'missing_tax_profile_snapshot';
    ELSIF NOT (v_profile ? 'secondary_employment') OR jsonb_typeof(v_profile->'secondary_employment') <> 'boolean' THEN
      v_class := 'missing_tax_profile_snapshot';
    ELSE
      v_emp := LOWER(TRIM(COALESCE(v_profile->>'employment_type', '')));
      IF v_emp = '' THEN
        v_class := 'missing_tax_profile_snapshot';
      ELSIF (v_profile->>'staff_is_tax_resident')::BOOLEAN IS FALSE THEN
        v_class := 'non_resident';
      ELSIF (v_profile->>'secondary_employment')::BOOLEAN IS TRUE THEN
        v_class := 'secondary_employment';
      ELSIF v_emp LIKE '%casual%' OR COALESCE((v_profile->>'casual_worker_flat_tax_applied')::BOOLEAN, FALSE) THEN
        v_class := 'casual_worker';
      ELSIF v_emp LIKE '%temporary%' THEN
        v_class := 'temporary_worker';
      END IF;
    END IF;

    IF v_class IS NOT NULL THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', v_class
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_affected) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_affected) e
      WHERE e.value->>'unsupportedClassification' IN (
        'non_resident', 'secondary_employment', 'casual_worker', 'temporary_worker', 'missing_tax_profile_snapshot'
      )
    ) THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
        'Payroll includes employees with unsupported Ghana tax profiles and cannot be approved.',
        jsonb_build_object('code', 'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE', 'affectedEmployees', v_affected)
      );
    ELSE
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Payroll entry statutory snapshots do not match the run and cannot be approved.',
        jsonb_build_object('code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED', 'affectedEmployees', v_affected)
      );
    END IF;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Atomic approval RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_payroll_run_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_run public.payroll_runs%ROWTYPE;
  v_entry_count INT := 0;
  v_journal_count INT := 0;
  v_journal_id UUID;
  v_active_journal UUID;
  v_obl JSONB;
  v_advance_total NUMERIC := 0;
  v_audit_id UUID;
  v_recomputed RECORD;
  v_diffs JSONB := '[]'::jsonb;
  v_tol NUMERIC := 0.01;
  v_msg TEXT;
  v_code TEXT;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Authentication required for payroll approval'
    );
  END IF;

  IF p_business_id IS NULL OR p_payroll_run_id IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'business_id and payroll_run_id are required'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Not authorized to approve payroll for this business'
    );
  END IF;

  -- 1. Lock payroll run
  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.deleted_at IS NOT NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll run not found'
    );
  END IF;

  IF v_run.business_id IS DISTINCT FROM p_business_id THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll run does not belong to the requested business'
    );
  END IF;

  -- Count journals for this run
  SELECT COUNT(*) INTO v_journal_count
  FROM public.journal_entries je
  WHERE je.business_id = p_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id;

  IF v_journal_count > 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Multiple payroll journals exist for this run',
      jsonb_build_object('code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE', 'journalCount', v_journal_count)
    );
  END IF;

  SELECT je.id INTO v_active_journal
  FROM public.journal_entries je
  WHERE je.business_id = p_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id
  ORDER BY je.created_at ASC
  LIMIT 1;

  -- Inconsistent historical states (fail closed)
  IF v_run.status = 'draft' AND v_run.journal_entry_id IS NOT NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Draft payroll run already has a journal_entry_id'
    );
  END IF;

  IF v_run.status IN ('approved', 'locked') THEN
    IF v_run.journal_entry_id IS NULL THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        format('%s payroll run is missing journal_entry_id', v_run.status)
      );
    END IF;

    IF v_active_journal IS NULL OR v_active_journal IS DISTINCT FROM v_run.journal_entry_id THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Payroll journal reference does not match the run'
      );
    END IF;

    IF NOT public.payroll_approval_obligations_consistent(p_business_id, p_payroll_run_id) THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Approved payroll obligations are incomplete or do not match run totals'
      );
    END IF;

    SELECT COALESCE(SUM(sar.amount), 0) INTO v_advance_total
    FROM public.salary_advance_repayments sar
    WHERE sar.business_id = p_business_id
      AND sar.payroll_run_id = p_payroll_run_id
      AND sar.status = 'posted';

    RETURN jsonb_build_object(
      'ok', true,
      'reused', true,
      'payroll_run_id', p_payroll_run_id,
      'business_id', p_business_id,
      'status', v_run.status,
      'journal_entry_id', v_run.journal_entry_id,
      'approved_at', v_run.approved_at,
      'approved_by', v_run.approved_by,
      'advance_recovery_total', v_advance_total
    );
  END IF;

  IF v_run.status IS DISTINCT FROM 'draft' THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      format('Cannot approve payroll run in status "%s"', v_run.status)
    );
  END IF;

  IF v_run.journal_entry_id IS NOT NULL OR v_active_journal IS NOT NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Draft payroll already has a payroll journal'
    );
  END IF;

  -- 2. Lock included entries ordered by id
  PERFORM 1
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE
  ORDER BY pe.id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_entry_count
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF v_entry_count < 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Cannot approve an empty payroll run'
    );
  END IF;

  -- Entry monetary / ownership checks
  IF EXISTS (
    SELECT 1
    FROM public.payroll_entries pe
    LEFT JOIN public.staff s ON s.id = pe.staff_id
    WHERE pe.payroll_run_id = p_payroll_run_id
      AND pe.is_included IS DISTINCT FROM FALSE
      AND (
        s.id IS NULL
        OR s.business_id IS DISTINCT FROM p_business_id
        OR COALESCE(pe.net_salary, 0) < -0.0001
        OR COALESCE(pe.gross_salary, 0) < -0.0001
        OR COALESCE(pe.paye, 0) < -0.0001
        OR COALESCE(pe.ssnit_employee, 0) < -0.0001
        OR COALESCE(pe.ssnit_employer, 0) < -0.0001
        OR COALESCE(pe.deductions_total, 0) < -0.0001
        OR COALESCE(pe.basic_salary, 0) < -0.0001
        OR COALESCE(pe.allowances_total, 0) < -0.0001
        OR pe.gross_salary IS NULL
        OR pe.net_salary IS NULL
      )
  ) THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'One or more included payroll entries fail monetary or ownership validation'
    );
  END IF;

  -- Ghana containment (after lock)
  PERFORM public.payroll_ghana_validate_run_for_approval(p_business_id, v_run, v_entry_count);

  -- 3. Reconcile totals under lock
  SELECT
    COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0) AS basic,
    COALESCE(SUM(COALESCE(pe.allowances_total, 0)), 0) AS allowances,
    COALESCE(SUM(COALESCE(pe.gross_salary, 0)), 0) AS gross,
    COALESCE(SUM(COALESCE(pe.ssnit_employee, 0)), 0) AS ssnit_employee,
    COALESCE(SUM(COALESCE(pe.ssnit_employer, 0)), 0) AS ssnit_employer,
    COALESCE(SUM(COALESCE(pe.paye, 0)), 0) AS paye,
    COALESCE(SUM(COALESCE(pe.deductions_total, 0)), 0) AS deductions,
    COALESCE(SUM(COALESCE(pe.net_salary, 0)), 0) AS net
  INTO v_recomputed
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF ABS(COALESCE(v_run.total_allowances, 0) - v_recomputed.allowances) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_allowances',
      'stored', COALESCE(v_run.total_allowances, 0),
      'recomputed', v_recomputed.allowances,
      'difference', COALESCE(v_run.total_allowances, 0) - v_recomputed.allowances
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_gross_salary, 0) - v_recomputed.gross) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_gross_salary',
      'stored', COALESCE(v_run.total_gross_salary, 0),
      'recomputed', v_recomputed.gross,
      'difference', COALESCE(v_run.total_gross_salary, 0) - v_recomputed.gross
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_ssnit_employee, 0) - v_recomputed.ssnit_employee) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_ssnit_employee',
      'stored', COALESCE(v_run.total_ssnit_employee, 0),
      'recomputed', v_recomputed.ssnit_employee,
      'difference', COALESCE(v_run.total_ssnit_employee, 0) - v_recomputed.ssnit_employee
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_ssnit_employer, 0) - v_recomputed.ssnit_employer) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_ssnit_employer',
      'stored', COALESCE(v_run.total_ssnit_employer, 0),
      'recomputed', v_recomputed.ssnit_employer,
      'difference', COALESCE(v_run.total_ssnit_employer, 0) - v_recomputed.ssnit_employer
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_paye, 0) - v_recomputed.paye) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_paye',
      'stored', COALESCE(v_run.total_paye, 0),
      'recomputed', v_recomputed.paye,
      'difference', COALESCE(v_run.total_paye, 0) - v_recomputed.paye
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_deductions, 0) - v_recomputed.deductions) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_deductions',
      'stored', COALESCE(v_run.total_deductions, 0),
      'recomputed', v_recomputed.deductions,
      'difference', COALESCE(v_run.total_deductions, 0) - v_recomputed.deductions
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_net_salary, 0) - v_recomputed.net) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_net_salary',
      'stored', COALESCE(v_run.total_net_salary, 0),
      'recomputed', v_recomputed.net,
      'difference', COALESCE(v_run.total_net_salary, 0) - v_recomputed.net
    ));
  END IF;

  IF jsonb_array_length(v_diffs) > 0 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_TOTALS_OUT_OF_SYNC',
      'Payroll run totals do not reconcile to included entries',
      jsonb_build_object(
        'code', 'PAYROLL_TOTALS_OUT_OF_SYNC',
        'differences', v_diffs,
        'recomputedBasicSalary', v_recomputed.basic
      )
    );
  END IF;

  -- 4. Post payroll journal (+ salary-advance recoveries via migration 553)
  BEGIN
    v_journal_id := public.post_payroll_to_ledger(p_payroll_run_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_msg := SQLERRM;
      IF v_msg ILIKE '%period%closed%' OR v_msg ILIKE '%accounting period%' THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_PERIOD_CLOSED',
          v_msg,
          jsonb_build_object('code', 'PAYROLL_APPROVAL_PERIOD_CLOSED')
        );
      END IF;
      RAISE;
  END;

  IF v_journal_id IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll journal posting returned no journal id'
    );
  END IF;

  -- Refresh run row after ledger (journal_entry_id set by post_payroll_to_ledger)
  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;

  IF v_run.journal_entry_id IS DISTINCT FROM v_journal_id THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Payroll journal_entry_id does not match posted journal'
    );
  END IF;

  -- 5. Sync obligations
  BEGIN
    v_obl := public.sync_payroll_obligations_for_approval(p_business_id, p_payroll_run_id);
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_OBLIGATION_FAILED',
        'Obligation uniqueness conflict during approval'
      );
    WHEN OTHERS THEN
      IF SQLERRM ILIKE '%PAYROLL_APPROVAL_%' OR SQLERRM ILIKE '%Conflicting%' THEN
        RAISE;
      END IF;
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_OBLIGATION_FAILED',
        SQLERRM
      );
  END;

  SELECT COALESCE(SUM(sar.amount), 0) INTO v_advance_total
  FROM public.salary_advance_repayments sar
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted';

  -- 6. Update run status (only after journal + obligations)
  UPDATE public.payroll_runs
  SET
    status = 'approved',
    approved_at = NOW(),
    approved_by = v_uid,
    journal_entry_id = v_journal_id,
    updated_at = NOW()
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll run status changed during approval'
    );
  END IF;

  -- 7. Approval audit (idempotent via unique index)
  BEGIN
    v_audit_id := public.create_audit_log(
      p_business_id,
      v_uid,
      'payroll.run_approved',
      'payroll_run',
      p_payroll_run_id,
      jsonb_build_object('status', 'draft'),
      jsonb_build_object(
        'status', 'approved',
        'journal_entry_id', v_journal_id,
        'totals', jsonb_build_object(
          'total_gross_salary', v_run.total_gross_salary,
          'total_allowances', v_run.total_allowances,
          'total_ssnit_employee', v_run.total_ssnit_employee,
          'total_ssnit_employer', v_run.total_ssnit_employer,
          'total_paye', v_run.total_paye,
          'total_deductions', v_run.total_deductions,
          'total_net_salary', v_run.total_net_salary
        ),
        'obligations', COALESCE(v_obl->'obligations', '[]'::jsonb),
        'salary_advance_recovery_total', v_advance_total
      ),
      NULL,
      NULL,
      format('Payroll run %s approved atomically', p_payroll_run_id)
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_audit_id
      FROM public.audit_logs
      WHERE business_id = p_business_id
        AND entity_id = p_payroll_run_id
        AND action_type = 'payroll.run_approved'
        AND entity_type = 'payroll_run'
      LIMIT 1;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'payroll_run_id', p_payroll_run_id,
    'business_id', p_business_id,
    'status', 'approved',
    'journal_entry_id', v_journal_id,
    'approved_by', v_uid,
    'advance_recovery_total', v_advance_total,
    'obligations', COALESCE(v_obl->'obligations', '[]'::jsonb),
    'audit_log_id', v_audit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) IS
  'Atomically approve a draft payroll run: validate, post journal (+ advance recoveries), sync obligations, set approved, audit.';
