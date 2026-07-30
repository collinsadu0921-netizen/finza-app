-- ============================================================================
-- Migration 557: Atomic payroll reversal and correction drafts
-- ============================================================================
-- Staging migration only. No historical backfill. Original journals and journal
-- lines remain immutable; reversals are represented by a new opposite journal.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS reversal_journal_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS correction_of_run_id UUID REFERENCES public.payroll_runs(id),
  ADD COLUMN IF NOT EXISTS corrected_by_run_id UUID REFERENCES public.payroll_runs(id);

ALTER TABLE public.payroll_obligations
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

ALTER TABLE public.salary_advance_repayments
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

ALTER TABLE public.deductions
  ADD COLUMN IF NOT EXISTS deactivated_reason TEXT,
  ADD COLUMN IF NOT EXISTS deactivated_reference_id UUID,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

DO $ddl$
DECLARE v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.payroll_runs'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.payroll_runs DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$ddl$;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft', 'approved', 'locked', 'reversed'));

DO $ddl$
DECLARE v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.payroll_obligations'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.payroll_obligations DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$ddl$;
ALTER TABLE public.payroll_obligations
  ADD CONSTRAINT payroll_obligations_status_check
  CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'reversed'));

DO $ddl$
DECLARE v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.salary_advance_repayments'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.salary_advance_repayments DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$ddl$;
ALTER TABLE public.salary_advance_repayments
  ADD CONSTRAINT salary_advance_repayments_status_check
  CHECK (status IN ('pending', 'posted', 'voided', 'reversed'));

-- Fail closed before installing uniqueness guards.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payroll_runs
    WHERE correction_of_run_id IS NOT NULL
    GROUP BY correction_of_run_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create ux_payroll_runs_one_correction_child: duplicates exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
    WHERE reference_type = 'payroll_reversal' AND reference_id IS NOT NULL
    GROUP BY business_id, reference_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create ux_journal_entries_one_payroll_reversal: duplicates exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action_type = 'payroll.run_reversed' AND entity_type = 'payroll_run'
    GROUP BY business_id, entity_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create ux_audit_logs_payroll_run_reversed: duplicates exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action_type = 'payroll.correction_created' AND entity_type = 'payroll_run'
    GROUP BY business_id, entity_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create ux_audit_logs_payroll_correction_created: duplicates exist';
  END IF;
END;
$guard$;

CREATE UNIQUE INDEX ux_payroll_runs_one_correction_child
  ON public.payroll_runs(correction_of_run_id)
  WHERE correction_of_run_id IS NOT NULL;

CREATE UNIQUE INDEX ux_journal_entries_one_payroll_reversal
  ON public.journal_entries(business_id, reference_id)
  WHERE reference_type = 'payroll_reversal' AND reference_id IS NOT NULL;

CREATE UNIQUE INDEX ux_audit_logs_payroll_run_reversed
  ON public.audit_logs(business_id, entity_id)
  WHERE action_type = 'payroll.run_reversed' AND entity_type = 'payroll_run';

CREATE UNIQUE INDEX ux_audit_logs_payroll_correction_created
  ON public.audit_logs(business_id, entity_id)
  WHERE action_type = 'payroll.correction_created' AND entity_type = 'payroll_run';

-- ---------------------------------------------------------------------------
-- Salary-advance balance and deduction provenance helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salary_advance_posted_repaid_amount(p_advance_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2)
  FROM public.salary_advance_repayments
  WHERE salary_advance_id = p_advance_id
    AND status = 'posted';
$fn$;

DROP FUNCTION IF EXISTS public.salary_advance_stop_recurring_deduction(UUID);
CREATE FUNCTION public.salary_advance_stop_recurring_deduction(
  p_advance_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.deductions d
  SET deleted_at = NOW(),
      deactivated_at = NOW(),
      deactivated_reason = COALESCE(NULLIF(TRIM(p_reason), ''), 'manual'),
      deactivated_reference_id = p_reference_id,
      updated_at = NOW()
  WHERE d.advance_id = p_advance_id
    AND d.deleted_at IS NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.salary_advance_apply_posted_balance(p_advance_id UUID)
RETURNS public.salary_advances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_before public.salary_advances;
  v_after public.salary_advances;
  v_posted NUMERIC(15,2);
  v_repayment RECORD;
BEGIN
  SELECT * INTO v_before
  FROM public.salary_advances
  WHERE id = p_advance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Salary advance not found: %', p_advance_id;
  END IF;

  v_posted := public.salary_advance_posted_repaid_amount(p_advance_id);

  UPDATE public.salary_advances sa
  SET repaid_amount = LEAST(sa.amount, v_posted),
      status = CASE
        WHEN sa.cancelled_at IS NOT NULL THEN 'cancelled'
        WHEN LEAST(sa.amount, v_posted) >= sa.amount THEN 'cleared'
        WHEN LEAST(sa.amount, v_posted) > 0 THEN 'partially_repaid'
        ELSE 'outstanding'
      END,
      cleared_at = CASE
        WHEN sa.cancelled_at IS NULL AND LEAST(sa.amount, v_posted) >= sa.amount
          THEN COALESCE(sa.cleared_at, NOW())
        ELSE NULL
      END,
      updated_at = NOW()
  WHERE sa.id = p_advance_id
  RETURNING * INTO v_after;

  IF v_after.status = 'cleared' AND v_before.status IS DISTINCT FROM 'cleared' THEN
    SELECT sar.id, sar.payroll_run_id, sar.repayment_method
    INTO v_repayment
    FROM public.salary_advance_repayments sar
    WHERE sar.salary_advance_id = p_advance_id
      AND sar.status = 'posted'
    ORDER BY COALESCE(sar.posted_at, sar.created_at) DESC, sar.id DESC
    LIMIT 1;

    IF FOUND AND v_repayment.repayment_method = 'payroll_deduction' THEN
      PERFORM public.salary_advance_stop_recurring_deduction(
        p_advance_id, 'payroll_recovery', v_repayment.payroll_run_id
      );
    ELSIF FOUND AND v_repayment.repayment_method LIKE 'direct_%' THEN
      PERFORM public.salary_advance_stop_recurring_deduction(
        p_advance_id, 'direct_repayment', v_repayment.id
      );
    ELSE
      PERFORM public.salary_advance_stop_recurring_deduction(p_advance_id, 'manual', NULL);
    END IF;
  END IF;

  RETURN v_after;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Structured reversal error
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_payroll_reversal_error(
  p_code TEXT,
  p_message TEXT,
  p_detail JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION '%: %', p_code, p_message
    USING ERRCODE = 'P0001',
          DETAIL = COALESCE(
            p_detail,
            jsonb_build_object('code', p_code, 'message', p_message)
          )::TEXT;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Internal correction-draft helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payroll_correction_draft_from_reversed(
  p_business_id UUID,
  p_original_run_id UUID,
  p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_original public.payroll_runs%ROWTYPE;
  v_correction_id UUID;
  v_columns TEXT;
  v_select_columns TEXT;
  v_entry RECORD;
  v_item JSONB;
  v_new_snapshot JSONB;
  v_old_advance NUMERIC;
  v_new_advance NUMERIC;
  v_non_advance NUMERIC;
  v_outstanding NUMERIC;
BEGIN
  SELECT * INTO v_original
  FROM public.payroll_runs
  WHERE id = p_original_run_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_original.status IS DISTINCT FROM 'reversed' THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_CORRECTION_INVALID_SOURCE',
      'Correction source must be a reversed payroll run'
    );
  END IF;

  IF v_original.corrected_by_run_id IS NOT NULL THEN
    SELECT id INTO v_correction_id
    FROM public.payroll_runs
    WHERE id = v_original.corrected_by_run_id
      AND correction_of_run_id = p_original_run_id;
    IF v_correction_id IS NULL THEN
      PERFORM public.raise_payroll_reversal_error(
        'PAYROLL_REVERSAL_ALREADY_COMPLETED',
        'Reversed run has an inconsistent correction link'
      );
    END IF;
    RETURN v_correction_id;
  END IF;

  SELECT id INTO v_correction_id
  FROM public.payroll_runs
  WHERE correction_of_run_id = p_original_run_id;
  IF FOUND THEN
    UPDATE public.payroll_runs
    SET corrected_by_run_id = v_correction_id, updated_at = NOW()
    WHERE id = p_original_run_id;
    RETURN v_correction_id;
  END IF;

  INSERT INTO public.payroll_runs (
    business_id, payroll_month, status,
    total_gross_salary, total_allowances, total_deductions,
    total_ssnit_employee, total_ssnit_employer, total_paye,
    total_net_salary, total_basic_salary,
    notes, pay_period_start, pay_period_end, payroll_frequency,
    run_type, staff_scope_fingerprint, corrects_payroll_run_id,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, correction_of_run_id
  ) VALUES (
    v_original.business_id, v_original.payroll_month, 'draft',
    0, 0, 0, 0, 0, 0, 0, 0,
    'Correction of ' || p_original_run_id::TEXT,
    v_original.pay_period_start, v_original.pay_period_end,
    v_original.payroll_frequency, 'correction',
    v_original.staff_scope_fingerprint, p_original_run_id,
    v_original.calculation_engine_version, v_original.paye_rate_version,
    v_original.pension_rate_version, v_original.calculation_jurisdiction,
    v_original.statutory_period_basis, p_original_run_id
  )
  RETURNING id INTO v_correction_id;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.payroll_correction_entry_map (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL UNIQUE
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.payroll_correction_entry_map;

  INSERT INTO pg_temp.payroll_correction_entry_map(old_id, new_id)
  SELECT pe.id, gen_random_uuid()
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_original_run_id
  ORDER BY pe.id;

  SELECT
    string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
    string_agg(format('pe.%I', a.attname), ', ' ORDER BY a.attnum)
  INTO v_columns, v_select_columns
  FROM pg_attribute a
  WHERE a.attrelid = 'public.payroll_entries'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname NOT IN ('id', 'payroll_run_id', 'created_at', 'updated_at');

  EXECUTE format(
    'INSERT INTO public.payroll_entries (id, payroll_run_id, %s)
     SELECT m.new_id, $1, %s
     FROM public.payroll_entries pe
     JOIN pg_temp.payroll_correction_entry_map m ON m.old_id = pe.id
     WHERE pe.payroll_run_id = $2
     ORDER BY pe.id',
    v_columns, v_select_columns
  ) USING v_correction_id, p_original_run_id;

  FOR v_entry IN
    SELECT n.*
    FROM public.payroll_entries n
    WHERE n.payroll_run_id = v_correction_id
      AND n.is_included IS DISTINCT FROM FALSE
    ORDER BY n.id
  LOOP
    v_new_snapshot := '[]'::JSONB;
    v_old_advance := 0;
    v_new_advance := 0;

    IF jsonb_typeof(COALESCE(v_entry.advance_recoveries_snapshot, '[]'::JSONB)) = 'array' THEN
      FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(v_entry.advance_recoveries_snapshot, '[]'::JSONB))
      LOOP
        v_old_advance := v_old_advance + GREATEST(
          0, COALESCE((v_item->>'amount')::NUMERIC, 0)
        );
        SELECT GREATEST(
          0,
          ROUND(sa.amount - public.salary_advance_posted_repaid_amount(sa.id), 2)
        )
        INTO v_outstanding
        FROM public.salary_advances sa
        WHERE sa.id = NULLIF(
          TRIM(COALESCE(v_item->>'advanceId', v_item->>'advance_id', '')), ''
        )::UUID
          AND sa.business_id = p_business_id;

        v_outstanding := LEAST(
          GREATEST(0, COALESCE((v_item->>'amount')::NUMERIC, 0)),
          GREATEST(0, COALESCE(v_outstanding, 0))
        );
        v_new_advance := v_new_advance + v_outstanding;
        v_new_snapshot := v_new_snapshot || jsonb_build_array(
          jsonb_set(v_item, '{amount}', to_jsonb(ROUND(v_outstanding, 2)), TRUE)
        );
      END LOOP;
    END IF;

    v_non_advance := GREATEST(
      0, COALESCE(v_entry.deductions_total, 0) - v_old_advance
    );

    UPDATE public.payroll_entries
    SET advance_recoveries_snapshot = v_new_snapshot,
        deductions_total = ROUND(v_non_advance + v_new_advance, 2),
        net_salary = ROUND(
          COALESCE(v_entry.gross_salary, 0)
          - COALESCE(v_entry.ssnit_employee, 0)
          - COALESCE(v_entry.paye, 0)
          - ROUND(v_non_advance + v_new_advance, 2),
          2
        ),
        updated_at = NOW()
    WHERE id = v_entry.id;
  END LOOP;

  UPDATE public.payroll_runs pr
  SET total_basic_salary = x.basic,
      total_allowances = x.allowances,
      total_gross_salary = x.gross,
      total_ssnit_employee = x.ssnit_employee,
      total_ssnit_employer = x.ssnit_employer,
      total_paye = x.paye,
      total_deductions = x.deductions,
      total_net_salary = x.net,
      updated_at = NOW()
  FROM (
    SELECT
      COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0) basic,
      COALESCE(SUM(COALESCE(pe.allowances_total, 0)), 0) allowances,
      COALESCE(SUM(COALESCE(pe.gross_salary, 0)), 0) gross,
      COALESCE(SUM(COALESCE(pe.ssnit_employee, 0)), 0) ssnit_employee,
      COALESCE(SUM(COALESCE(pe.ssnit_employer, 0)), 0) ssnit_employer,
      COALESCE(SUM(COALESCE(pe.paye, 0)), 0) paye,
      COALESCE(SUM(COALESCE(pe.deductions_total, 0)), 0) deductions,
      COALESCE(SUM(COALESCE(pe.net_salary, 0)), 0) net
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = v_correction_id
      AND pe.is_included IS DISTINCT FROM FALSE
  ) x
  WHERE pr.id = v_correction_id;

  UPDATE public.payroll_runs
  SET corrected_by_run_id = v_correction_id, updated_at = NOW()
  WHERE id = p_original_run_id;

  PERFORM public.create_audit_log(
    p_business_id, p_actor_id, 'payroll.correction_created', 'payroll_run',
    v_correction_id, NULL,
    jsonb_build_object(
      'status', 'draft',
      'correction_of_run_id', p_original_run_id,
      'corrects_payroll_run_id', p_original_run_id
    ),
    NULL, NULL,
    format('Correction draft created for reversed payroll run %s', p_original_run_id)
  );

  RETURN v_correction_id;
EXCEPTION
  WHEN unique_violation THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'A conflicting correction draft or correction audit already exists'
    );
    RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Atomic payroll reversal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payroll_run_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_reversal_date DATE,
  p_reason TEXT,
  p_create_correction_draft BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_run public.payroll_runs%ROWTYPE;
  v_original_journal public.journal_entries%ROWTYPE;
  v_reversal_journal_id UUID;
  v_correction_run_id UUID;
  v_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_count INT;
  v_audit_count INT;
  v_bad_repay INT;
  v_obligation_ids JSONB := '[]'::JSONB;
  v_repayment_ids JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
  v_advance_total NUMERIC := 0;
  v_advance RECORD;
  v_after public.salary_advances;
  v_msg TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  IF v_uid IS NULL
     OR p_business_id IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.reverse')
  THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_PERMISSION_DENIED',
      'Payroll reversal permission required',
      jsonb_build_object('code', 'PAYROLL_REVERSAL_PERMISSION_DENIED')
    );
  END IF;

  IF p_payroll_run_id IS NULL OR p_reversal_date IS NULL THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_CONFLICT',
      'payroll_run_id and reversal_date are required'
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.deleted_at IS NOT NULL THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_CONFLICT', 'Payroll run not found'
    );
  END IF;

  IF v_run.status = 'reversed' AND v_run.reversal_journal_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.journal_entries je
    WHERE je.id = v_run.reversal_journal_id
      AND je.business_id = p_business_id
      AND je.reference_type = 'payroll_reversal'
      AND je.reference_id = p_payroll_run_id
      AND je.reverses_entry_id = v_run.journal_entry_id;
    IF v_count <> 1 THEN
      PERFORM public.raise_payroll_reversal_error(
        'PAYROLL_REVERSAL_ALREADY_COMPLETED',
        'Reversed payroll has inconsistent reversal state'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', TRUE, 'reused', TRUE,
      'payroll_run_id', p_payroll_run_id,
      'reversal_journal_id', v_run.reversal_journal_id,
      'original_journal_id', v_run.journal_entry_id,
      'correction_run_id', v_run.corrected_by_run_id,
      'advance_recovery_reversed_total', COALESCE((
        SELECT SUM(amount) FROM public.salary_advance_repayments
        WHERE payroll_run_id = p_payroll_run_id AND status = 'reversed'
      ), 0),
      'warnings', '[]'::JSONB,
      'reversed_obligation_ids', COALESCE((
        SELECT jsonb_agg(id ORDER BY id) FROM public.payroll_obligations
        WHERE payroll_run_id = p_payroll_run_id AND status = 'reversed'
      ), '[]'::JSONB),
      'reversed_repayment_ids', COALESCE((
        SELECT jsonb_agg(id ORDER BY id) FROM public.salary_advance_repayments
        WHERE payroll_run_id = p_payroll_run_id AND status = 'reversed'
      ), '[]'::JSONB)
    );
  END IF;

  IF v_run.status = 'reversed' OR v_run.reversal_journal_id IS NOT NULL THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_ALREADY_COMPLETED',
      'Payroll reversal state is incomplete or inconsistent'
    );
  END IF;

  IF v_run.status NOT IN ('approved', 'locked') THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INVALID_STATUS',
      format('Cannot reverse payroll run in status "%s"', v_run.status)
    );
  END IF;

  IF v_reason IS NULL OR LENGTH(v_reason) < 3 OR LENGTH(v_reason) > 500 THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_CONFLICT',
      'Reversal reason must contain between 3 and 500 characters'
    );
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries je
  WHERE je.business_id = p_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id;
  IF v_count <> 1 OR v_run.journal_entry_id IS NULL THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Payroll must have exactly one original payroll journal'
    );
  END IF;

  SELECT * INTO v_original_journal
  FROM public.journal_entries je
  WHERE je.id = v_run.journal_entry_id
    AND je.business_id = p_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Payroll journal_entry_id does not match its payroll reference'
    );
  END IF;

  -- Deterministic lock order.
  PERFORM 1 FROM public.payroll_entries
  WHERE payroll_run_id = p_payroll_run_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payroll_obligations
  WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
  ORDER BY obligation_type, id FOR UPDATE;
  PERFORM 1 FROM public.payroll_obligation_payments
  WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
  ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payroll_payments
  WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
  ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.payroll_payment_batches
  WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
  ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.salary_advance_repayments
  WHERE business_id = p_business_id AND payroll_run_id = p_payroll_run_id
  ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.salary_advances sa
  WHERE sa.id IN (
    SELECT sar.salary_advance_id FROM public.salary_advance_repayments sar
    WHERE sar.business_id = p_business_id
      AND sar.payroll_run_id = p_payroll_run_id
  ) ORDER BY sa.id FOR UPDATE;
  PERFORM 1 FROM public.deductions d
  WHERE d.advance_id IN (
    SELECT sar.salary_advance_id FROM public.salary_advance_repayments sar
    WHERE sar.business_id = p_business_id
      AND sar.payroll_run_id = p_payroll_run_id
  ) ORDER BY d.id FOR UPDATE;

  IF NOT public.payroll_approval_obligations_consistent(
    p_business_id, p_payroll_run_id
  ) THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Payroll obligations do not match approved run totals'
    );
  END IF;

  SELECT COUNT(*) INTO v_audit_count
  FROM public.audit_logs
  WHERE business_id = p_business_id
    AND entity_id = p_payroll_run_id
    AND action_type = 'payroll.run_approved'
    AND entity_type = 'payroll_run';
  IF v_audit_count <> 1 THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Payroll is missing a unique approval audit event'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND deleted_at IS NULL
      AND COALESCE(amount_paid, 0) > 0.01
  ) OR EXISTS (
    SELECT 1 FROM public.payroll_obligation_payments
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND journal_entry_id IS NOT NULL
      AND deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.payroll_payments
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND journal_entry_id IS NOT NULL
      AND deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.payroll_payment_batches
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND deleted_at IS NULL
      AND status IN ('pending_authorization', 'processing', 'partially_paid', 'paid')
  ) THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_PAYMENTS_EXIST',
      'Payroll cannot be reversed after salary or obligation payments exist'
    );
  END IF;

  SELECT COUNT(*) INTO v_bad_repay
  FROM public.salary_advance_repayments sar
  LEFT JOIN public.payroll_entries pe ON pe.id = sar.payroll_entry_id
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted'
    AND (
      sar.payroll_entry_id IS NULL OR pe.id IS NULL
      OR pe.payroll_run_id IS DISTINCT FROM p_payroll_run_id
      OR pe.is_included IS FALSE
      OR sar.staff_id IS DISTINCT FROM pe.staff_id
    );
  IF v_bad_repay > 0 THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Posted advance recovery is linked to an excluded or mismatched entry'
    );
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(
      p_business_id, p_reversal_date
    );
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_PERIOD_CLOSED',
      'The reversal accounting period is closed',
      jsonb_build_object('code', 'PAYROLL_REVERSAL_PERIOD_CLOSED', 'cause', v_msg)
    );
  END;

  INSERT INTO public.journal_entries (
    business_id, date, description, reference_type, reference_id,
    posting_source, reverses_entry_id
  ) VALUES (
    p_business_id, p_reversal_date,
    format('Reversed payroll %s', LEFT(p_payroll_run_id::TEXT, 8)),
    'payroll_reversal', p_payroll_run_id, 'system', v_original_journal.id
  )
  RETURNING id INTO v_reversal_journal_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  )
  SELECT
    v_reversal_journal_id, l.account_id, l.credit, l.debit,
    'Reversal: ' || COALESCE(l.description, '')
  FROM public.journal_entry_lines l
  WHERE l.journal_entry_id = v_original_journal.id
  ORDER BY l.id;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_reversal_journal_id;
  IF ABS(v_debit - v_credit) > 0.01 OR NOT EXISTS (
    SELECT 1 FROM public.journal_entry_lines
    WHERE journal_entry_id = v_reversal_journal_id
  ) THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Generated reversal journal is empty or unbalanced'
    );
  END IF;

  IF EXISTS (
    WITH original AS (
      SELECT account_id, SUM(credit - debit) net
      FROM public.journal_entry_lines
      WHERE journal_entry_id = v_original_journal.id GROUP BY account_id
    ), reversal AS (
      SELECT account_id, SUM(credit - debit) net
      FROM public.journal_entry_lines
      WHERE journal_entry_id = v_reversal_journal_id GROUP BY account_id
    )
    SELECT 1 FROM original o FULL JOIN reversal r USING (account_id)
    WHERE ABS(COALESCE(o.net, 0) + COALESCE(r.net, 0)) > 0.01
  ) THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Reversal journal is not the exact account-level opposite'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::JSONB)
  INTO v_obligation_ids
  FROM public.payroll_obligations
  WHERE business_id = p_business_id
    AND payroll_run_id = p_payroll_run_id
    AND deleted_at IS NULL;

  UPDATE public.payroll_obligations
  SET status = 'reversed', reversed_at = NOW(), reversed_by = v_uid,
      reversal_journal_id = v_reversal_journal_id,
      reversal_reason = v_reason, updated_at = NOW()
  WHERE business_id = p_business_id
    AND payroll_run_id = p_payroll_run_id
    AND deleted_at IS NULL
    AND COALESCE(amount_paid, 0) <= 0.01;

  SELECT
    COALESCE(jsonb_agg(id ORDER BY id), '[]'::JSONB),
    COALESCE(SUM(amount), 0)
  INTO v_repayment_ids, v_advance_total
  FROM public.salary_advance_repayments
  WHERE business_id = p_business_id
    AND payroll_run_id = p_payroll_run_id
    AND status = 'posted'
    AND repayment_method = 'payroll_deduction';

  UPDATE public.salary_advance_repayments
  SET status = 'reversed', reversed_at = NOW(), reversed_by = v_uid,
      reversal_journal_id = v_reversal_journal_id,
      reversal_reason = v_reason, updated_at = NOW()
  WHERE business_id = p_business_id
    AND payroll_run_id = p_payroll_run_id
    AND status = 'posted'
    AND repayment_method = 'payroll_deduction';

  FOR v_advance IN
    SELECT DISTINCT sa.id
    FROM public.salary_advances sa
    JOIN public.salary_advance_repayments sar
      ON sar.salary_advance_id = sa.id
    WHERE sar.business_id = p_business_id
      AND sar.payroll_run_id = p_payroll_run_id
      AND sar.status = 'reversed'
    ORDER BY sa.id
  LOOP
    v_after := public.salary_advance_apply_posted_balance(v_advance.id);
    IF v_after.status IN ('outstanding', 'partially_repaid') THEN
      IF EXISTS (
        SELECT 1 FROM public.deductions d
        WHERE d.advance_id = v_advance.id
          AND d.deleted_at IS NOT NULL
          AND d.deactivated_reason = 'payroll_recovery'
          AND d.deactivated_reference_id = p_payroll_run_id
      ) THEN
        UPDATE public.deductions
        SET deleted_at = NULL, deactivated_at = NULL,
            deactivated_reason = NULL, deactivated_reference_id = NULL,
            updated_at = NOW()
        WHERE advance_id = v_advance.id
          AND deleted_at IS NOT NULL
          AND deactivated_reason = 'payroll_recovery'
          AND deactivated_reference_id = p_payroll_run_id;
      ELSIF EXISTS (
        SELECT 1 FROM public.deductions d
        WHERE d.advance_id = v_advance.id AND d.deleted_at IS NOT NULL
      ) THEN
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'DEDUCTION_REACTIVATION_SKIPPED',
          'advance_id', v_advance.id,
          'message', 'Deduction provenance is missing or belongs to a later deactivation'
        ));
      END IF;
    END IF;
  END LOOP;

  UPDATE public.payroll_runs
  SET status = 'reversed',
      reversal_journal_id = v_reversal_journal_id,
      reversed_at = NOW(), reversed_by = v_uid,
      reversal_reason = v_reason, updated_at = NOW()
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND status IN ('approved', 'locked')
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_CONFLICT',
      'Payroll run status changed during reversal'
    );
  END IF;

  IF COALESCE(p_create_correction_draft, TRUE) THEN
    v_correction_run_id :=
      public.create_payroll_correction_draft_from_reversed(
        p_business_id, p_payroll_run_id, v_uid
      );
  END IF;

  BEGIN
    PERFORM public.create_audit_log(
      p_business_id, v_uid, 'payroll.run_reversed', 'payroll_run',
      p_payroll_run_id,
      jsonb_build_object(
        'status', v_run.status,
        'journal_entry_id', v_original_journal.id
      ),
      jsonb_build_object(
        'status', 'reversed',
        'reversal_journal_id', v_reversal_journal_id,
        'reversal_date', p_reversal_date,
        'reversal_reason', v_reason,
        'correction_run_id', v_correction_run_id,
        'reversed_obligation_ids', v_obligation_ids,
        'reversed_repayment_ids', v_repayment_ids,
        'advance_recovery_reversed_total', v_advance_total,
        'warnings', v_warnings
      ),
      NULL, NULL,
      format('Payroll run %s reversed atomically', p_payroll_run_id)
    );
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'Duplicate payroll reversal audit event'
    );
  END;

  RETURN jsonb_build_object(
    'ok', TRUE, 'reused', FALSE,
    'payroll_run_id', p_payroll_run_id,
    'reversal_journal_id', v_reversal_journal_id,
    'original_journal_id', v_original_journal.id,
    'correction_run_id', v_correction_run_id,
    'advance_recovery_reversed_total', v_advance_total,
    'warnings', v_warnings,
    'reversed_obligation_ids', v_obligation_ids,
    'reversed_repayment_ids', v_repayment_ids
  );
EXCEPTION
  WHEN unique_violation THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'A conflicting reversal journal, correction, or audit already exists'
    );
    RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Approval patch
-- Preserve the complete migration-556 implementation and add an early,
-- fail-closed reversed-state guard immediately after v_run is loaded.
-- ---------------------------------------------------------------------------
DO $patch_approval$
DECLARE
  v_definition TEXT;
  v_needle TEXT;
  v_replacement TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.approve_payroll_run_atomic(uuid,uuid)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'approve_payroll_run_atomic not found';
  END IF;

  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_definition := replace(v_definition, E'\r', E'\n');

  v_needle :=
    'IF NOT FOUND OR v_run.deleted_at IS NOT NULL THEN' || E'\n' ||
    '    PERFORM public.raise_payroll_approval_error(' || E'\n' ||
    '      ''PAYROLL_APPROVAL_CONFLICT'',' || E'\n' ||
    '      ''Payroll run not found''' || E'\n' ||
    '    );' || E'\n' ||
    '  END IF;';

  v_replacement :=
    v_needle || E'\n\n' ||
    '  IF v_run.status = ''reversed'' THEN' || E'\n' ||
    '    PERFORM public.raise_payroll_approval_error(' || E'\n' ||
    '      ''PAYROLL_RUN_REVERSED'',' || E'\n' ||
    '      ''Payroll run has been reversed'',' || E'\n' ||
    '      jsonb_build_object(''code'', ''PAYROLL_RUN_REVERSED'')' || E'\n' ||
    '    );' || E'\n' ||
    '  END IF;';

  IF POSITION(v_needle IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot patch approve_payroll_run_atomic: migration-556 body not found';
  END IF;

  IF POSITION('PAYROLL_RUN_REVERSED' IN v_definition) = 0 THEN
    EXECUTE replace(v_definition, v_needle, v_replacement);
  END IF;
END;
$patch_approval$;

COMMENT ON FUNCTION public.reverse_payroll_run_atomic(UUID, UUID, DATE, TEXT, BOOLEAN) IS
  'Atomically reverses an unpaid approved/locked payroll, rolls back posted advance recoveries, and optionally creates a recalculated correction draft.';
COMMENT ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID) IS
  'Internal helper that copies all payroll-entry snapshots from a reversed run and recalculates advance recoveries and run totals.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reverse_payroll_run_atomic(UUID, UUID, DATE, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_run_atomic(UUID, UUID, DATE, TEXT, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salary_advance_posted_repaid_amount(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salary_advance_stop_recurring_deduction(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salary_advance_apply_posted_balance(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_payroll_reversal_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.salary_advance_posted_repaid_amount(UUID)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.salary_advance_stop_recurring_deduction(UUID, TEXT, UUID)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.salary_advance_apply_posted_balance(UUID)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_reversal_error(TEXT, TEXT, JSONB)
  TO postgres;

REVOKE ALL ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID)
  TO authenticated;

-- Re-assert approval-helper revokes after replacing approval.
REVOKE ALL ON FUNCTION public.payroll_obligation_posted_payments_total(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_next_month_paye_due_date(DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_obligation_status(NUMERIC, NUMERIC)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payroll_obligation_posted_payments_total(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT) TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_next_month_paye_due_date(DATE) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_status(NUMERIC, NUMERIC) TO postgres;

-- finza_user_has_permission intentionally remains executable by authenticated.
