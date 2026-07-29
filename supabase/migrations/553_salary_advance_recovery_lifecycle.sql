-- ============================================================================
-- Migration 553: Salary advance recovery lifecycle (snapshots + atomic posting)
-- ============================================================================
-- Additive / staging-safe. Does NOT backfill historical payroll recoveries.
-- Does NOT rewrite migration 552.
-- ============================================================================

-- 1) Immutable recovery snapshot on payroll entries
ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS advance_recoveries_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.payroll_entries.advance_recoveries_snapshot IS
  'Immutable advance-recovery items included in deductions_total for this entry. Empty for legacy/excluded. Shape: [{advanceId, deductionId, staffId, amount}].';

-- 2) Extend repayments for payroll + direct paths
ALTER TABLE public.salary_advance_repayments
  ADD COLUMN IF NOT EXISTS deduction_id UUID REFERENCES public.deductions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repayment_method TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_identity TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS reference TEXT;

-- Allow direct repayments without a payroll run
ALTER TABLE public.salary_advance_repayments
  ALTER COLUMN payroll_run_id DROP NOT NULL;

UPDATE public.salary_advance_repayments
SET repayment_method = 'payroll_deduction'
WHERE repayment_method IS NULL
  AND payroll_run_id IS NOT NULL;

UPDATE public.salary_advance_repayments
SET repayment_method = 'direct_legacy'
WHERE repayment_method IS NULL
  AND payroll_run_id IS NULL;

ALTER TABLE public.salary_advance_repayments
  ALTER COLUMN repayment_method SET DEFAULT 'payroll_deduction';

ALTER TABLE public.salary_advance_repayments
  DROP CONSTRAINT IF EXISTS salary_advance_repayments_repayment_method_check;

ALTER TABLE public.salary_advance_repayments
  ADD CONSTRAINT salary_advance_repayments_repayment_method_check
  CHECK (
    repayment_method IN (
      'payroll_deduction',
      'direct_cash',
      'direct_bank',
      'direct_legacy'
    )
  );

-- Backfill payroll idempotency identities for existing rows (no guessed historical amounts)
UPDATE public.salary_advance_repayments
SET idempotency_identity =
  'payroll:' || payroll_run_id::text || ':' || payroll_entry_id::text || ':' || salary_advance_id::text
WHERE payroll_run_id IS NOT NULL
  AND payroll_entry_id IS NOT NULL
  AND idempotency_identity IS NULL;

-- Legacy rows without entry linkage keep a unique non-colliding identity
UPDATE public.salary_advance_repayments
SET idempotency_identity = 'legacy:' || id::text
WHERE idempotency_identity IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS salary_advance_repayments_idempotency_identity_uidx
  ON public.salary_advance_repayments (idempotency_identity)
  WHERE idempotency_identity IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS salary_advance_repayments_business_idempotency_key_uidx
  ON public.salary_advance_repayments (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Keep legacy unique for payroll rows that have entry ids
DROP INDEX IF EXISTS public.salary_advance_repayments_unique_entry;
CREATE UNIQUE INDEX IF NOT EXISTS salary_advance_repayments_unique_entry
  ON public.salary_advance_repayments (salary_advance_id, payroll_run_id, payroll_entry_id)
  WHERE payroll_run_id IS NOT NULL AND payroll_entry_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.salary_advance_posted_repaid_amount(p_advance_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(amount), 0)::NUMERIC(15,2)
  FROM public.salary_advance_repayments
  WHERE salary_advance_id = p_advance_id
    AND status = 'posted';
$$;

CREATE OR REPLACE FUNCTION public.salary_advance_stop_recurring_deduction(p_advance_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.deductions d
  SET deleted_at = COALESCE(d.deleted_at, NOW())
  WHERE d.advance_id = p_advance_id
    AND d.deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.salary_advance_apply_posted_balance(
  p_advance_id UUID
)
RETURNS public.salary_advances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.salary_advances;
  v_posted NUMERIC(15,2);
BEGIN
  SELECT * INTO v_row
  FROM public.salary_advances
  WHERE id = p_advance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Salary advance not found: %', p_advance_id;
  END IF;

  v_posted := public.salary_advance_posted_repaid_amount(p_advance_id);

  UPDATE public.salary_advances sa
  SET
    repaid_amount = LEAST(sa.amount, v_posted),
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
  RETURNING * INTO v_row;

  IF v_row.status = 'cleared' THEN
    PERFORM public.salary_advance_stop_recurring_deduction(p_advance_id);
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Direct repayment RPC (cash/bank → clear 1110). Never uses 2241.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_salary_advance_direct_repayment(
  p_business_id UUID,
  p_advance_id UUID,
  p_amount NUMERIC,
  p_payment_account_id UUID,
  p_payment_date DATE,
  p_idempotency_key TEXT,
  p_reference TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance public.salary_advances;
  v_account RECORD;
  v_existing public.salary_advance_repayments;
  v_outstanding NUMERIC(15,2);
  v_amount NUMERIC(15,2);
  v_method TEXT;
  v_staff_advances_id UUID;
  v_period RECORD;
  v_journal_id UUID;
  v_repayment public.salary_advance_repayments;
  v_updated public.salary_advances;
BEGIN
  IF p_business_id IS NULL OR p_advance_id IS NULL OR p_payment_account_id IS NULL OR p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Missing required direct repayment parameters'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized for this business'
      USING ERRCODE = '42501';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0)::NUMERIC, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be a positive number'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent reuse
  SELECT * INTO v_existing
  FROM public.salary_advance_repayments
  WHERE business_id = p_business_id
    AND idempotency_key = trim(p_idempotency_key)
  LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_advance FROM public.salary_advances WHERE id = p_advance_id;
    RETURN jsonb_build_object(
      'reused', true,
      'repayment_id', v_existing.id,
      'journal_entry_id', v_existing.journal_entry_id,
      'advance_id', p_advance_id,
      'amount', v_existing.amount,
      'status', v_existing.status,
      'repaid_amount', v_advance.repaid_amount,
      'outstanding', GREATEST(0, v_advance.amount - COALESCE(v_advance.repaid_amount, 0))
    );
  END IF;

  SELECT * INTO v_advance
  FROM public.salary_advances
  WHERE id = p_advance_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Salary advance not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_advance.cancelled_at IS NOT NULL OR v_advance.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot record repayment on a cancelled advance'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_advance.status = 'cleared' THEN
    RAISE EXCEPTION 'Advance is already fully repaid'
      USING ERRCODE = 'P0001';
  END IF;

  v_outstanding := GREATEST(
    0,
    ROUND(v_advance.amount - public.salary_advance_posted_repaid_amount(v_advance.id), 2)
  );
  IF v_amount > v_outstanding THEN
    RAISE EXCEPTION 'Repayment exceeds outstanding balance'
      USING ERRCODE = 'P0001',
            DETAIL = format('amount=%s outstanding=%s', v_amount, v_outstanding);
  END IF;

  SELECT a.id, a.business_id, a.type, a.sub_type, a.code, a.deleted_at
  INTO v_account
  FROM public.accounts a
  WHERE a.id = p_payment_account_id
    AND a.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_account.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment account not found for this business'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_account.type IS DISTINCT FROM 'asset'
     OR (
       COALESCE(v_account.sub_type, '') NOT IN ('bank', 'cash')
       AND COALESCE(v_account.code, '') NOT IN ('1000', '1010', '1020')
     )
  THEN
    RAISE EXCEPTION 'Payment account must be a cash or bank asset account'
      USING ERRCODE = 'P0001';
  END IF;

  v_method := CASE
    WHEN COALESCE(v_account.sub_type, '') = 'cash' OR v_account.code IN ('1000') THEN 'direct_cash'
    ELSE 'direct_bank'
  END;

  PERFORM public.assert_accounting_period_is_open(p_business_id, p_payment_date);

  SELECT id INTO v_staff_advances_id
  FROM public.accounts
  WHERE business_id = p_business_id AND code = '1110' AND deleted_at IS NULL;

  IF v_staff_advances_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (p_business_id, 'Staff Advances', '1110', 'asset', 'Salary advances issued to employees', TRUE)
    RETURNING id INTO v_staff_advances_id;
  END IF;

  INSERT INTO public.salary_advance_repayments (
    business_id,
    salary_advance_id,
    staff_id,
    payroll_run_id,
    payroll_entry_id,
    deduction_id,
    amount,
    status,
    repayment_method,
    idempotency_key,
    payment_account_id,
    payment_date,
    reference
  ) VALUES (
    p_business_id,
    p_advance_id,
    v_advance.staff_id,
    NULL,
    NULL,
    NULL,
    v_amount,
    'pending',
    v_method,
    trim(p_idempotency_key),
    p_payment_account_id,
    p_payment_date,
    NULLIF(trim(COALESCE(p_reference, '')), '')
  )
  RETURNING * INTO v_repayment;

  INSERT INTO public.journal_entries (
    business_id, date, description, reference_type, reference_id, posting_source, created_by, posted_by
  ) VALUES (
    p_business_id,
    p_payment_date,
    format('Salary advance direct repayment %s', left(p_advance_id::text, 8)),
    'salary_advance_repayment',
    v_repayment.id,
    'system',
    p_user_id,
    p_user_id
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_id, p_payment_account_id, v_amount, 0, 'Direct salary advance repayment'),
    (v_journal_id, v_staff_advances_id, 0, v_amount, 'Clear staff advances receivable');

  UPDATE public.salary_advance_repayments
  SET
    status = 'posted',
    journal_entry_id = v_journal_id,
    posted_at = NOW(),
    updated_at = NOW()
  WHERE id = v_repayment.id
  RETURNING * INTO v_repayment;

  v_updated := public.salary_advance_apply_posted_balance(p_advance_id);

  RETURN jsonb_build_object(
    'reused', false,
    'repayment_id', v_repayment.id,
    'journal_entry_id', v_journal_id,
    'advance_id', p_advance_id,
    'amount', v_amount,
    'status', v_repayment.status,
    'repayment_method', v_method,
    'repaid_amount', v_updated.repaid_amount,
    'outstanding', GREATEST(0, v_updated.amount - COALESCE(v_updated.repaid_amount, 0)),
    'advance_status', v_updated.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_salary_advance_direct_repayment(UUID, UUID, NUMERIC, UUID, DATE, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_salary_advance_direct_repayment(UUID, UUID, NUMERIC, UUID, DATE, TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Replace payroll posting: snapshot-driven, idempotent, clears 2241→1110
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_run_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id                      UUID;
  v_payroll_month                    DATE;
  v_run_status                       TEXT;
  v_total_gross                      NUMERIC;
  v_total_deductions                 NUMERIC;
  v_total_ssnit_employer             NUMERIC;
  v_total_paye                       NUMERIC;
  v_total_ssnit_employee             NUMERIC;
  v_total_net                        NUMERIC;
  v_total_pension                    NUMERIC;
  v_tier1_snap                       NUMERIC;
  v_tier2_snap                       NUMERIC;
  v_tier1_total                      NUMERIC;
  v_tier2_total                      NUMERIC;
  v_advance_repayment_total          NUMERIC := 0;
  v_payroll_expense_account_id       UUID;
  v_ssnit_employer_expense_id        UUID;
  v_paye_liability_account_id        UUID;
  v_tier1_liability_account_id       UUID;
  v_tier2_liability_account_id       UUID;
  v_net_salaries_payable_account_id  UUID;
  v_deductions_payable_account_id    UUID;
  v_staff_advances_account_id        UUID;
  v_journal_entry_id                 UUID;
  v_run_journal_id                   UUID;
  v_active_payroll_journal_id        UUID;
  v_entry                            RECORD;
  v_item                             JSONB;
  v_advance_id                       UUID;
  v_staff_id                         UUID;
  v_deduction_id                     UUID;
  v_amount                           NUMERIC(15,2);
  v_identity                         TEXT;
  v_advance                          RECORD;
  v_posted_before                    NUMERIC(15,2);
  v_pending_same_run                 NUMERIC(15,2);
  v_outstanding                      NUMERIC(15,2);
BEGIN
  SELECT
    business_id,
    payroll_month,
    status,
    total_gross_salary,
    COALESCE(total_deductions, 0),
    COALESCE(total_ssnit_employer, 0),
    COALESCE(total_paye, 0),
    COALESCE(total_ssnit_employee, 0),
    COALESCE(total_net_salary, 0),
    journal_entry_id
  INTO
    v_business_id,
    v_payroll_month,
    v_run_status,
    v_total_gross,
    v_total_deductions,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net,
    v_run_journal_id
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found: %', p_payroll_run_id;
  END IF;

  IF NOT public.finza_user_can_access_business(v_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post payroll for this business';
  END IF;

  -- Lock included entries
  PERFORM 1
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE
  FOR UPDATE;

  -- Materialize recoveries from immutable snapshots into repayments (idempotent)
  FOR v_entry IN
    SELECT pe.id AS entry_id, pe.staff_id, pe.deductions_total, pe.advance_recoveries_snapshot, pe.is_included
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_payroll_run_id
  LOOP
    IF v_entry.is_included IS FALSE THEN
      CONTINUE;
    END IF;

    IF v_entry.advance_recoveries_snapshot IS NULL
       OR jsonb_typeof(v_entry.advance_recoveries_snapshot) <> 'array' THEN
      CONTINUE;
    END IF;

    IF COALESCE((
      SELECT ROUND(SUM((x.elem->>'amount')::NUMERIC), 2)
      FROM jsonb_array_elements(v_entry.advance_recoveries_snapshot) AS x(elem)
    ), 0) - ROUND(COALESCE(v_entry.deductions_total, 0)::NUMERIC, 2) > 0.01 THEN
      RAISE EXCEPTION 'Advance recoveries exceed deductions_total on payroll entry %', v_entry.entry_id
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_entry.advance_recoveries_snapshot)
    LOOP
      v_advance_id := NULLIF(trim(COALESCE(v_item->>'advanceId', v_item->>'advance_id', '')), '')::UUID;
      v_staff_id := NULLIF(trim(COALESCE(v_item->>'staffId', v_item->>'staff_id', '')), '')::UUID;
      v_deduction_id := NULLIF(trim(COALESCE(v_item->>'deductionId', v_item->>'deduction_id', '')), '')::UUID;
      v_amount := ROUND(COALESCE((v_item->>'amount')::NUMERIC, 0), 2);

      IF v_advance_id IS NULL OR v_staff_id IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid advance recovery snapshot on entry %', v_entry.entry_id
          USING ERRCODE = 'P0001';
      END IF;

      IF v_staff_id IS DISTINCT FROM v_entry.staff_id THEN
        RAISE EXCEPTION 'Advance recovery staff mismatch on entry %', v_entry.entry_id
          USING ERRCODE = 'P0001';
      END IF;

      v_identity := format('payroll:%s:%s:%s', p_payroll_run_id, v_entry.entry_id, v_advance_id);

      INSERT INTO public.salary_advance_repayments (
        business_id,
        salary_advance_id,
        staff_id,
        payroll_run_id,
        payroll_entry_id,
        deduction_id,
        amount,
        status,
        repayment_method,
        idempotency_identity
      ) VALUES (
        v_business_id,
        v_advance_id,
        v_staff_id,
        p_payroll_run_id,
        v_entry.entry_id,
        v_deduction_id,
        v_amount,
        'pending',
        'payroll_deduction',
        v_identity
      )
      ON CONFLICT (idempotency_identity) WHERE idempotency_identity IS NOT NULL
      DO NOTHING;

      -- If a conflicting pending row exists with a different amount, fail closed
      IF EXISTS (
        SELECT 1
        FROM public.salary_advance_repayments sar
        WHERE sar.idempotency_identity = v_identity
          AND sar.status = 'pending'
          AND ROUND(sar.amount, 2) IS DISTINCT FROM v_amount
      ) THEN
        RAISE EXCEPTION 'Conflicting pending advance recovery amount for %', v_identity
          USING ERRCODE = 'P0001';
      END IF;

      -- Posted conflicting payload with different amount fails closed
      IF EXISTS (
        SELECT 1
        FROM public.salary_advance_repayments sar
        WHERE sar.idempotency_identity = v_identity
          AND sar.status = 'posted'
          AND ROUND(sar.amount, 2) IS DISTINCT FROM v_amount
      ) THEN
        RAISE EXCEPTION 'Conflicting posted advance recovery amount for %', v_identity
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END LOOP;

  -- Lock advances in deterministic order and validate outstanding
  FOR v_advance IN
    SELECT sa.*
    FROM public.salary_advances sa
    WHERE sa.id IN (
      SELECT DISTINCT sar.salary_advance_id
      FROM public.salary_advance_repayments sar
      WHERE sar.payroll_run_id = p_payroll_run_id
        AND sar.business_id = v_business_id
        AND sar.status IN ('pending', 'posted')
        AND sar.repayment_method = 'payroll_deduction'
    )
    ORDER BY sa.id
    FOR UPDATE
  LOOP
    IF v_advance.business_id IS DISTINCT FROM v_business_id THEN
      RAISE EXCEPTION 'Advance % belongs to another business', v_advance.id
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.salary_advance_repayments sar
      WHERE sar.payroll_run_id = p_payroll_run_id
        AND sar.salary_advance_id = v_advance.id
        AND sar.staff_id IS DISTINCT FROM v_advance.staff_id
    ) THEN
      RAISE EXCEPTION 'Advance % does not belong to payroll entry staff', v_advance.id
        USING ERRCODE = 'P0001';
    END IF;

    v_posted_before := public.salary_advance_posted_repaid_amount(v_advance.id)
      - COALESCE((
          SELECT SUM(sar.amount)
          FROM public.salary_advance_repayments sar
          WHERE sar.salary_advance_id = v_advance.id
            AND sar.payroll_run_id = p_payroll_run_id
            AND sar.status = 'posted'
        ), 0);

    v_pending_same_run := COALESCE((
      SELECT SUM(sar.amount)
      FROM public.salary_advance_repayments sar
      WHERE sar.salary_advance_id = v_advance.id
        AND sar.payroll_run_id = p_payroll_run_id
        AND sar.status = 'pending'
    ), 0);

    v_outstanding := GREATEST(0, ROUND(v_advance.amount - v_posted_before, 2));

    IF ROUND(v_pending_same_run, 2) - v_outstanding > 0.01 THEN
      RAISE EXCEPTION 'SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'code', 'SALARY_ADVANCE_RECOVERY_EXCEEDS_OUTSTANDING',
                'advanceId', v_advance.id,
                'staffId', v_advance.staff_id,
                'snapshottedAmount', v_pending_same_run,
                'currentOutstandingAmount', v_outstanding
              )::text;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_repayment_total
  FROM public.salary_advance_repayments sar
  WHERE sar.payroll_run_id = p_payroll_run_id
    AND sar.business_id = v_business_id
    AND sar.status = 'pending'
    AND sar.repayment_method = 'payroll_deduction';

  -- Idempotent journal path
  IF v_run_journal_id IS NOT NULL THEN
    v_journal_entry_id := v_run_journal_id;
  ELSE
    SELECT je.id
    INTO v_active_payroll_journal_id
    FROM public.journal_entries je
    WHERE je.business_id = v_business_id
      AND je.reference_type = 'payroll'
      AND je.reference_id = p_payroll_run_id
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries r WHERE r.reverses_entry_id = je.id
      )
    ORDER BY je.created_at ASC
    LIMIT 1;

    IF v_active_payroll_journal_id IS NOT NULL THEN
      UPDATE public.payroll_runs pr
      SET journal_entry_id = v_active_payroll_journal_id
      WHERE pr.id = p_payroll_run_id
        AND pr.business_id = v_business_id
        AND pr.journal_entry_id IS NULL;
      v_journal_entry_id := v_active_payroll_journal_id;
    END IF;
  END IF;

  IF v_journal_entry_id IS NULL THEN
    PERFORM public.assert_accounting_period_is_open(v_business_id, v_payroll_month);

    v_total_pension := COALESCE(v_total_ssnit_employee, 0) + COALESCE(v_total_ssnit_employer, 0);

    SELECT
      COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0),
      COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0)
    INTO v_tier1_snap, v_tier2_snap
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_payroll_run_id;

    IF v_total_pension <= 0.01 THEN
      v_tier1_total := 0;
      v_tier2_total := 0;
    ELSIF
      v_tier1_snap >= 0
      AND v_tier2_snap >= 0
      AND (v_tier1_snap + v_tier2_snap) > 0.01
      AND ABS((v_tier1_snap + v_tier2_snap) - v_total_pension) <= 0.02
    THEN
      v_tier1_total := ROUND(v_tier1_snap::NUMERIC, 2);
      v_tier2_total := ROUND(v_tier2_snap::NUMERIC, 2);
    ELSE
      v_tier1_total := ROUND(v_total_pension * (13.5 / 18.5), 2);
      v_tier2_total := ROUND(v_total_pension - v_tier1_total, 2);
    END IF;

    IF ABS(
      COALESCE(v_tier1_total, 0) + COALESCE(v_tier2_total, 0) - COALESCE(v_total_pension, 0)
    ) > 0.02 THEN
      RAISE EXCEPTION 'Pension split does not reconcile to total pension liability.';
    END IF;

    SELECT id INTO v_payroll_expense_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '5600' AND deleted_at IS NULL;
    IF v_payroll_expense_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Gross salaries, wages and allowances', TRUE)
      RETURNING id INTO v_payroll_expense_account_id;
    END IF;

    SELECT id INTO v_ssnit_employer_expense_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '5610' AND deleted_at IS NULL;
    IF v_ssnit_employer_expense_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Employer Pension Expense', '5610', 'expense', 'Employer pension / SSNIT contribution expense', TRUE)
      RETURNING id INTO v_ssnit_employer_expense_id;
    END IF;

    SELECT id INTO v_paye_liability_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '2230' AND deleted_at IS NULL;
    IF v_paye_liability_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE income tax payable to GRA', TRUE)
      RETURNING id INTO v_paye_liability_account_id;
    END IF;

    SELECT id INTO v_tier1_liability_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '2231' AND deleted_at IS NULL;
    IF v_tier1_liability_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'SSNIT / Tier 1 Pension Payable', '2231', 'liability', 'SSNIT / Tier 1 pension contributions payable', TRUE)
      RETURNING id INTO v_tier1_liability_account_id;
    END IF;
    IF v_tier1_liability_account_id IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve Tier 1 pension payable account code 2231 for business %', v_business_id;
    END IF;

    SELECT id INTO v_tier2_liability_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '2232' AND deleted_at IS NULL;
    IF v_tier2_liability_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Tier 2 Pension Payable', '2232', 'liability', 'Tier 2 pension contributions payable to trustee', TRUE)
      RETURNING id INTO v_tier2_liability_account_id;
    END IF;
    IF v_tier2_liability_account_id IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve Tier 2 pension payable account code 2232 for business %', v_business_id;
    END IF;

    SELECT id INTO v_net_salaries_payable_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '2240' AND deleted_at IS NULL;
    IF v_net_salaries_payable_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
      RETURNING id INTO v_net_salaries_payable_account_id;
    END IF;

    SELECT id INTO v_deductions_payable_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '2241' AND deleted_at IS NULL;
    IF v_deductions_payable_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability', 'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
      RETURNING id INTO v_deductions_payable_account_id;
    END IF;

    SELECT id INTO v_staff_advances_account_id
    FROM public.accounts WHERE business_id = v_business_id AND code = '1110' AND deleted_at IS NULL;
    IF v_staff_advances_account_id IS NULL THEN
      INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Staff Advances', '1110', 'asset', 'Salary advances issued to employees', TRUE)
      RETURNING id INTO v_staff_advances_account_id;
    END IF;

    INSERT INTO public.journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
    VALUES (
      v_business_id,
      v_payroll_month,
      'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'),
      'payroll',
      p_payroll_run_id,
      'system'
    )
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT l.journal_entry_id, l.account_id, l.debit, l.credit, l.description
    FROM (
      SELECT v_journal_entry_id AS journal_entry_id, v_payroll_expense_account_id AS account_id, v_total_gross AS debit,
             0::NUMERIC AS credit, 'Gross Salaries and Allowances'::TEXT AS description
      UNION ALL
      SELECT v_journal_entry_id, v_ssnit_employer_expense_id, v_total_ssnit_employer, 0::NUMERIC,
             'Employer pension / SSNIT contribution'::TEXT
      UNION ALL SELECT v_journal_entry_id, v_paye_liability_account_id, 0::NUMERIC, v_total_paye, 'PAYE Tax Payable'::TEXT
      UNION ALL
      SELECT v_journal_entry_id, v_net_salaries_payable_account_id, 0::NUMERIC, v_total_net, 'Net Salaries Payable'::TEXT
      UNION ALL
      SELECT v_journal_entry_id, v_deductions_payable_account_id, 0::NUMERIC, v_total_deductions, 'Employee Deductions Payable'::TEXT
      UNION ALL
      SELECT v_journal_entry_id, v_tier1_liability_account_id, 0::NUMERIC, v_tier1_total, 'SSNIT / Tier 1 pension payable'::TEXT
      WHERE v_total_pension > 0.01 AND v_tier1_total > 0.01
      UNION ALL
      SELECT v_journal_entry_id, v_tier2_liability_account_id, 0::NUMERIC, v_tier2_total, 'Tier 2 pension payable'::TEXT
      WHERE v_total_pension > 0.01 AND v_tier2_total > 0.01
      UNION ALL
      SELECT v_journal_entry_id, v_deductions_payable_account_id, v_advance_repayment_total, 0::NUMERIC,
             'Clear salary advance deductions payable'::TEXT
      WHERE COALESCE(v_advance_repayment_total, 0) > 0
      UNION ALL
      SELECT v_journal_entry_id, v_staff_advances_account_id, 0::NUMERIC, v_advance_repayment_total,
             'Clear staff advances receivable'::TEXT
      WHERE COALESCE(v_advance_repayment_total, 0) > 0
    ) l;
  END IF;

  -- Mark pending recoveries posted and refresh advance balances (idempotent)
  UPDATE public.salary_advance_repayments sar
  SET
    status = 'posted',
    journal_entry_id = COALESCE(sar.journal_entry_id, v_journal_entry_id),
    posted_at = COALESCE(sar.posted_at, NOW()),
    updated_at = NOW()
  WHERE sar.payroll_run_id = p_payroll_run_id
    AND sar.business_id = v_business_id
    AND sar.repayment_method = 'payroll_deduction'
    AND sar.status = 'pending';

  FOR v_advance IN
    SELECT DISTINCT sa.*
    FROM public.salary_advances sa
    JOIN public.salary_advance_repayments sar ON sar.salary_advance_id = sa.id
    WHERE sar.payroll_run_id = p_payroll_run_id
      AND sar.business_id = v_business_id
      AND sar.repayment_method = 'payroll_deduction'
      AND sar.status = 'posted'
  LOOP
    PERFORM public.salary_advance_apply_posted_balance(v_advance.id);
  END LOOP;

  UPDATE public.payroll_runs
  SET journal_entry_id = COALESCE(journal_entry_id, v_journal_entry_id)
  WHERE id = p_payroll_run_id
    AND business_id = v_business_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.post_payroll_to_ledger(UUID) IS
'Posts payroll run to ledger from run totals + immutable advance_recoveries_snapshot. Creates idempotent payroll repayments, clears 2241→1110, updates advance balances, and stops fully recovered deductions.';

REVOKE ALL ON FUNCTION public.post_payroll_to_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_to_ledger(UUID) TO authenticated;

COMMENT ON FUNCTION public.post_salary_advance_direct_repayment(UUID, UUID, NUMERIC, UUID, DATE, TEXT, TEXT, UUID) IS
'Posts a direct cash/bank salary-advance repayment (Dr cash/bank, Cr 1110) with idempotency. Never uses 2241.';
