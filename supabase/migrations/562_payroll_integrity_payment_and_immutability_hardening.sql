-- ============================================================================
-- Migration 562: Payroll integrity — immutability, atomic payments, batch integrity
-- Does NOT edit migrations 552–561. Production untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Schema extensions
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS batch_item_id UUID REFERENCES public.payroll_payment_batch_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_payments_business_idempotency
  ON public.payroll_payments(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_payments_posted_run
  ON public.payroll_payments(payroll_run_id)
  WHERE deleted_at IS NULL AND journal_entry_id IS NOT NULL;

ALTER TABLE public.payroll_obligation_payments
  ADD COLUMN IF NOT EXISTS payroll_payment_id UUID REFERENCES public.payroll_payments(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_obligation_payments_payroll_payment
  ON public.payroll_obligation_payments(payroll_payment_id)
  WHERE payroll_payment_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.payroll_payment_batch_items
  ADD COLUMN IF NOT EXISTS payroll_payment_id UUID REFERENCES public.payroll_payments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.payroll_payments.idempotency_key IS
  'Client-supplied idempotency key; unique per business for posted salary payments.';
COMMENT ON COLUMN public.payroll_obligation_payments.payroll_payment_id IS
  'Authoritative link from salary-net settlement row to payroll_payments for salary_net obligations.';

-- ---------------------------------------------------------------------------
-- 2) Mutation context helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_payroll_mutation_context()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('finza.payroll_mutation_context', true), '');
$$;

CREATE OR REPLACE FUNCTION public.finza_set_payroll_mutation_context(p_context TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('finza.payroll_mutation_context', COALESCE(p_context, ''), true);
END;
$$;

REVOKE ALL ON FUNCTION public.finza_set_payroll_mutation_context(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finza_set_payroll_mutation_context(TEXT) TO postgres;

CREATE OR REPLACE FUNCTION public.raise_payroll_payment_error(
  p_code TEXT,
  p_message TEXT,
  p_detail JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '%: %', p_code, p_message
    USING ERRCODE = 'P0001',
          DETAIL = COALESCE(
            p_detail,
            jsonb_build_object('code', p_code, 'message', p_message)
          )::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_payroll_payment_error(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_payroll_payment_error(TEXT, TEXT, JSONB) TO postgres;

-- ---------------------------------------------------------------------------
-- 3) payroll_runs immutability + status transitions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_runs_enforce_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
  v_notes_only BOOLEAN;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_notes_only := (
    NEW.business_id IS NOT DISTINCT FROM OLD.business_id
    AND NEW.payroll_month IS NOT DISTINCT FROM OLD.payroll_month
    AND NEW.pay_period_start IS NOT DISTINCT FROM OLD.pay_period_start
    AND NEW.pay_period_end IS NOT DISTINCT FROM OLD.pay_period_end
    AND NEW.payroll_frequency IS NOT DISTINCT FROM OLD.payroll_frequency
    AND NEW.run_type IS NOT DISTINCT FROM OLD.run_type
    AND NEW.calculation_engine_version IS NOT DISTINCT FROM OLD.calculation_engine_version
    AND NEW.calculation_jurisdiction IS NOT DISTINCT FROM OLD.calculation_jurisdiction
    AND NEW.statutory_period_basis IS NOT DISTINCT FROM OLD.statutory_period_basis
    AND NEW.paye_rate_version IS NOT DISTINCT FROM OLD.paye_rate_version
    AND NEW.pension_rate_version IS NOT DISTINCT FROM OLD.pension_rate_version
    AND NEW.total_basic_salary IS NOT DISTINCT FROM OLD.total_basic_salary
    AND NEW.total_allowances IS NOT DISTINCT FROM OLD.total_allowances
    AND NEW.total_gross_salary IS NOT DISTINCT FROM OLD.total_gross_salary
    AND NEW.total_ssnit_employee IS NOT DISTINCT FROM OLD.total_ssnit_employee
    AND NEW.total_ssnit_employer IS NOT DISTINCT FROM OLD.total_ssnit_employer
    AND NEW.total_paye IS NOT DISTINCT FROM OLD.total_paye
    AND NEW.total_deductions IS NOT DISTINCT FROM OLD.total_deductions
    AND NEW.total_net_salary IS NOT DISTINCT FROM OLD.total_net_salary
    AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
    AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
    AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
    AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at
    AND NEW.reversed_by IS NOT DISTINCT FROM OLD.reversed_by
    AND NEW.reversal_journal_id IS NOT DISTINCT FROM OLD.reversal_journal_id
    AND NEW.reversal_reason IS NOT DISTINCT FROM OLD.reversal_reason
    AND NEW.correction_of_run_id IS NOT DISTINCT FROM OLD.correction_of_run_id
    AND NEW.corrected_by_run_id IS NOT DISTINCT FROM OLD.corrected_by_run_id
    AND NEW.corrects_payroll_run_id IS NOT DISTINCT FROM OLD.corrects_payroll_run_id
    AND NEW.staff_scope_fingerprint IS NOT DISTINCT FROM OLD.staff_scope_fingerprint
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
  );

  IF v_notes_only AND NEW.notes IS DISTINCT FROM OLD.notes THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'approved' AND v_ctx = 'approve' THEN
        RETURN NEW;
      END IF;
      IF NEW.status = 'draft' THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_RUN_INVALID_STATUS_TRANSITION',
        format('Invalid payroll run status transition from %s to %s', OLD.status, NEW.status)
      );
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'locked', 'reversed') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'approved' AND NEW.status = 'locked' AND v_ctx = 'lock' THEN
        RETURN NEW;
      END IF;
      IF OLD.status IN ('approved', 'locked') AND NEW.status = 'reversed' AND v_ctx = 'reverse' THEN
        RETURN NEW;
      END IF;
      IF OLD.status = 'reversed' AND NEW.status = 'reversed' AND v_ctx = 'correction_link'
         AND NEW.corrected_by_run_id IS DISTINCT FROM OLD.corrected_by_run_id THEN
        RETURN NEW;
      END IF;
      IF OLD.status IN ('approved', 'locked') AND NEW.status = OLD.status AND v_ctx = 'approve' THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_RUN_INVALID_STATUS_TRANSITION',
        format('Invalid payroll run status transition from %s to %s', OLD.status, NEW.status)
      );
    END IF;

    IF v_ctx = 'approve' AND OLD.status = 'draft' THEN
      RETURN NEW;
    END IF;
    IF v_ctx = 'lock' AND OLD.status = 'approved' AND NEW.status = 'locked' THEN
      RETURN NEW;
    END IF;
    IF v_ctx = 'reverse' AND NEW.status = 'reversed' THEN
      RETURN NEW;
    END IF;
    IF v_ctx = 'correction_link'
       AND OLD.status = 'reversed'
       AND NEW.corrected_by_run_id IS DISTINCT FROM OLD.corrected_by_run_id
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;

    IF v_notes_only THEN
      RETURN NEW;
    END IF;

    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_RUN_IMMUTABLE',
      format('Payroll run in status %s cannot be mutated outside controlled payroll RPCs', OLD.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_runs_enforce_immutability ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_enforce_immutability
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_runs_enforce_immutability();

-- ---------------------------------------------------------------------------
-- 4) payroll_entries immutability when parent run is not draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_entries_enforce_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  SELECT pr.status INTO v_status
  FROM public.payroll_runs pr
  WHERE pr.id = OLD.payroll_run_id;

  IF COALESCE(v_status, 'draft') = 'draft' THEN
    RETURN NEW;
  END IF;

  PERFORM public.raise_payroll_payment_error(
    'PAYROLL_RUN_IMMUTABLE',
    'Approved, locked or reversed payroll entries cannot be mutated'
  );
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_entries_enforce_immutability ON public.payroll_entries;
CREATE TRIGGER trg_payroll_entries_enforce_immutability
  BEFORE UPDATE ON public.payroll_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_entries_enforce_immutability();

-- ---------------------------------------------------------------------------
-- 5) payroll_payments immutability after posting
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payments_enforce_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.journal_entry_id IS NOT NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_REVERSAL_REQUIRED',
        'Posted payroll payments cannot be deleted; reverse the payroll run or implement payment reversal'
      );
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.finza_payroll_mutation_context() = 'payment_record' AND OLD.journal_entry_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF OLD.journal_entry_id IS NOT NULL THEN
      IF NEW.business_id IS DISTINCT FROM OLD.business_id
         OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
         OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
         OR NEW.amount IS DISTINCT FROM OLD.amount
         OR NEW.payment_account_id IS DISTINCT FROM OLD.payment_account_id
         OR NEW.reference IS DISTINCT FROM OLD.reference
         OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
         OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id THEN
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_PAYMENT_REVERSAL_REQUIRED',
          'Posted payroll payments are immutable'
        );
      END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_PAYMENT_REVERSAL_REQUIRED',
          'Posted payroll payments cannot be soft-deleted'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_payments_enforce_immutability ON public.payroll_payments;
CREATE TRIGGER trg_payroll_payments_enforce_immutability
  BEFORE UPDATE OR DELETE ON public.payroll_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payments_enforce_immutability();

-- ---------------------------------------------------------------------------
-- 6) salary_net obligation amount_paid protection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_obligations_enforce_authoritative_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.obligation_type = 'salary_net'
     AND (
       NEW.amount_paid IS DISTINCT FROM OLD.amount_paid
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.latest_payment_date IS DISTINCT FROM OLD.latest_payment_date
       OR NEW.latest_payment_reference IS DISTINCT FROM OLD.latest_payment_reference
       OR NEW.payment_account_id IS DISTINCT FROM OLD.payment_account_id
     )
     AND public.finza_payroll_mutation_context() IS DISTINCT FROM 'payment_settle' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_OBLIGATION_MISMATCH',
      'salary_net obligation paid amounts must be updated by record_payroll_payment_atomic'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_obligations_enforce_authoritative_paid ON public.payroll_obligations;
CREATE TRIGGER trg_payroll_obligations_enforce_authoritative_paid
  BEFORE UPDATE ON public.payroll_obligations
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_obligations_enforce_authoritative_paid();

-- ---------------------------------------------------------------------------
-- 7) batch item paid integrity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payment_batch_items_enforce_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid' AND (
    public.finza_payroll_mutation_context() IS DISTINCT FROM 'batch_item_payment'
  ) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
      'Batch items cannot be marked paid without record_payroll_batch_item_payment_atomic'
    );
  END IF;

  IF NEW.status = 'paid' THEN
    IF NEW.payroll_payment_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Paid batch items must reference a posted payroll payment'
      );
    END IF;

    SELECT pp.id, pp.business_id, pp.payroll_run_id, pp.amount, pp.journal_entry_id, pp.deleted_at
    INTO v_payment
    FROM public.payroll_payments pp
    WHERE pp.id = NEW.payroll_payment_id;

    IF NOT FOUND OR v_payment.deleted_at IS NOT NULL OR v_payment.journal_entry_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Paid batch items must reference an active posted payroll payment'
      );
    END IF;

    IF v_payment.business_id <> NEW.business_id
       OR v_payment.payroll_run_id <> NEW.payroll_run_id THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Batch item payment business/run mismatch'
      );
    END IF;

    IF v_payment.amount + 0.01 < NEW.amount THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_EXCEEDS_OUTSTANDING',
        'Linked payroll payment amount is less than batch item amount'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_payment_batch_items_enforce_paid ON public.payroll_payment_batch_items;
CREATE TRIGGER trg_payroll_payment_batch_items_enforce_paid
  BEFORE UPDATE ON public.payroll_payment_batch_items
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payment_batch_items_enforce_paid();

-- ---------------------------------------------------------------------------
-- 8) Authoritative salary-net posted total
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_obligation_posted_payments_total(
  p_obligation_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(pop.amount), 0)::NUMERIC
  FROM public.payroll_obligation_payments pop
  JOIN public.payroll_obligations po ON po.id = pop.payroll_obligation_id
  WHERE pop.payroll_obligation_id = p_obligation_id
    AND pop.deleted_at IS NULL
    AND pop.journal_entry_id IS NOT NULL
    AND (
      po.obligation_type IS DISTINCT FROM 'salary_net'
      OR pop.payroll_payment_id IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.payroll_obligation_posted_payments_total(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_posted_payments_total(UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- 9) Batch status derivation (authoritative)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_derive_batch_status_from_items(p_batch_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current TEXT;
  v_relevant TEXT[];
  v_all_paid BOOLEAN;
  v_any_paid BOOLEAN;
  v_any_failed BOOLEAN;
  v_any_pending BOOLEAN;
  v_all_complete BOOLEAN;
BEGIN
  SELECT status INTO v_current
  FROM public.payroll_payment_batches
  WHERE id = p_batch_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'draft';
  END IF;

  IF v_current = 'cancelled' THEN
    RETURN 'cancelled';
  END IF;

  SELECT COALESCE(array_agg(i.status), ARRAY[]::TEXT[])
  INTO v_relevant
  FROM public.payroll_payment_batch_items i
  WHERE i.batch_id = p_batch_id
    AND i.deleted_at IS NULL
    AND i.status NOT IN ('skipped', 'cancelled');

  IF COALESCE(array_length(v_relevant, 1), 0) = 0 THEN
    RETURN 'cancelled';
  END IF;

  v_all_paid := (SELECT bool_and(s = 'paid') FROM unnest(v_relevant) s);
  v_any_paid := (SELECT bool_or(s = 'paid') FROM unnest(v_relevant) s);
  v_any_failed := (SELECT bool_or(s = 'failed') FROM unnest(v_relevant) s);
  v_any_pending := (SELECT bool_or(s = 'pending') FROM unnest(v_relevant) s);

  IF v_all_paid THEN
    IF EXISTS (
      SELECT 1
      FROM public.payroll_payment_batch_items i
      WHERE i.batch_id = p_batch_id
        AND i.deleted_at IS NULL
        AND i.status = 'paid'
        AND (
          i.payroll_payment_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.payroll_payments pp
            WHERE pp.id = i.payroll_payment_id
              AND pp.journal_entry_id IS NOT NULL
              AND pp.deleted_at IS NULL
          )
        )
    ) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Batch cannot be marked paid while items lack posted payroll payments'
      );
    END IF;
    RETURN 'paid';
  END IF;

  IF v_any_failed AND NOT v_any_paid AND NOT v_any_pending THEN
    RETURN 'failed';
  END IF;

  IF v_any_paid AND (v_any_pending OR v_any_failed) THEN
    RETURN 'partially_paid';
  END IF;

  IF v_any_failed AND v_any_paid THEN
    RETURN 'partially_paid';
  END IF;

  IF v_any_failed THEN
    RETURN 'failed';
  END IF;

  SELECT bool_and(
    COALESCE(LOWER(i.destination_method_type), '') = 'cash'
    OR (
      COALESCE(LOWER(i.destination_method_type), '') = 'bank'
      AND NULLIF(TRIM(COALESCE(i.destination_bank_name, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(i.destination_account_number, '')), '') IS NOT NULL
    )
    OR (
      COALESCE(LOWER(i.destination_method_type), '') = 'momo'
      AND NULLIF(TRIM(COALESCE(i.destination_momo_provider, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(i.destination_momo_number, '')), '') IS NOT NULL
    )
  )
  INTO v_all_complete
  FROM public.payroll_payment_batch_items i
  WHERE i.batch_id = p_batch_id AND i.deleted_at IS NULL;

  IF COALESCE(v_all_complete, FALSE) THEN
    RETURN 'ready';
  END IF;

  RETURN 'draft';
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_derive_batch_status_from_items(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_derive_batch_status_from_items(UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- 10) Internal journal posting helper (not callable by clients)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._post_payroll_payment_journal_internal(
  p_business_id UUID,
  p_payroll_payment_id UUID,
  p_payroll_run_id UUID,
  p_payment_date DATE,
  p_amount NUMERIC,
  p_payment_account_id UUID,
  p_payroll_month DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net_salaries_payable_account_id UUID;
  v_journal_entry_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  SELECT a.id
  INTO v_net_salaries_payable_account_id
  FROM public.accounts a
  WHERE a.business_id = p_business_id
    AND a.code = '2240'
    AND a.type = 'liability'
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF v_net_salaries_payable_account_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_INVALID_ACCOUNT',
      format('Net Salaries Payable account (2240) not found for business %s', p_business_id)
    );
  END IF;

  INSERT INTO public.journal_entries (
    business_id, date, description, reference_type, reference_id, posting_source
  )
  VALUES (
    p_business_id,
    p_payment_date,
    'Payroll salary payment - ' || TO_CHAR(p_payroll_month, 'Mon YYYY'),
    'payroll_payment',
    p_payroll_payment_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, debit, credit, description
  )
  VALUES
    (
      v_journal_entry_id,
      v_net_salaries_payable_account_id,
      ROUND(p_amount, 2),
      0,
      'Payroll salary disbursement (clear net salaries payable)'
    ),
    (
      v_journal_entry_id,
      p_payment_account_id,
      0,
      ROUND(p_amount, 2),
      'Payroll salary disbursement (payment account)'
    );

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_journal_entry_id;

  IF ABS(v_debit - v_credit) > 0.01 OR ABS(v_debit - ROUND(p_amount, 2)) > 0.01 THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_JOURNAL_IMBALANCE',
      'Payroll payment journal is not balanced'
    );
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('payment_record');
  UPDATE public.payroll_payments
  SET journal_entry_id = v_journal_entry_id,
      updated_at = NOW()
  WHERE id = p_payroll_payment_id;

  RETURN v_journal_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public._post_payroll_payment_journal_internal(UUID, UUID, UUID, DATE, NUMERIC, UUID, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._post_payroll_payment_journal_internal(UUID, UUID, UUID, DATE, NUMERIC, UUID, DATE)
  TO postgres;

-- ---------------------------------------------------------------------------
-- 11) Atomic salary payment RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payroll_payment_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_payment_date DATE,
  p_amount NUMERIC,
  p_payment_account_id UUID,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL,
  p_batch_item_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_actor_id, auth.uid());
  v_tol NUMERIC := 0.01;
  v_run public.payroll_runs%ROWTYPE;
  v_obligation public.payroll_obligations%ROWTYPE;
  v_existing public.payroll_payments%ROWTYPE;
  v_payment_id UUID;
  v_journal_id UUID;
  v_obligation_payment_id UUID;
  v_total_paid NUMERIC := 0;
  v_outstanding NUMERIC := 0;
  v_amount NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
  v_paid_total NUMERIC := 0;
  v_latest_payment RECORD;
  v_audit_action TEXT := 'payroll.payment_recorded';
BEGIN
  IF p_business_id IS NULL OR p_payroll_run_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'business_id and payroll_run_id are required');
  END IF;

  IF p_payment_date IS NULL OR v_amount IS NULL OR v_amount <= 0 OR p_payment_account_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'payment_date, positive amount and payment_account_id are required');
  END IF;

  IF NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'idempotency_key is required');
  END IF;

  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Authentication required');
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Not authorized for this business');
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'payroll.pay') THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'payroll.pay permission required');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('payroll_payment_run'),
    hashtext(p_business_id::TEXT || ':' || p_payroll_run_id::TEXT)
  );

  SELECT * INTO v_existing
  FROM public.payroll_payments pp
  WHERE pp.business_id = p_business_id
    AND pp.idempotency_key = TRIM(p_idempotency_key)
    AND pp.deleted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id
       OR v_existing.payment_date IS DISTINCT FROM p_payment_date
       OR v_existing.amount IS DISTINCT FROM v_amount
       OR v_existing.payment_account_id IS DISTINCT FROM p_payment_account_id
       OR COALESCE(v_existing.reference, '') IS DISTINCT FROM COALESCE(p_reference, '')
       OR COALESCE(v_existing.batch_id::TEXT, '') IS DISTINCT FROM COALESCE(p_batch_id::TEXT, '') THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT',
        'Idempotency key reused with different payment inputs'
      );
    END IF;

    IF v_existing.journal_entry_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_INCONSISTENT_STATE',
        'Existing payment row is missing journal linkage'
      );
    END IF;

    v_audit_action := 'payroll.payment_idempotency_reused';
    PERFORM public.create_audit_log(
      p_business_id, v_uid, v_audit_action, 'payroll_payment', v_existing.id,
      NULL,
      jsonb_build_object(
        'payroll_run_id', p_payroll_run_id,
        'journal_entry_id', v_existing.journal_entry_id,
        'amount', v_existing.amount,
        'idempotency_key', TRIM(p_idempotency_key)
      ),
      NULL, NULL,
      'Payroll payment idempotency reuse'
    );

    RETURN jsonb_build_object(
      'reused', true,
      'payment_id', v_existing.id,
      'journal_entry_id', v_existing.journal_entry_id,
      'amount', v_existing.amount
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id
    AND pr.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Payroll run not found');
  END IF;

  IF v_run.status = 'draft' THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_RUN_NOT_PAYABLE', 'Cannot record salary payment for draft payroll runs');
  END IF;

  IF v_run.status = 'reversed' THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_RUN_NOT_PAYABLE', 'Cannot record salary payment for reversed payroll runs');
  END IF;

  IF v_run.status NOT IN ('approved', 'locked') THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_RUN_NOT_PAYABLE', format('Payroll run status %s is not payable', v_run.status));
  END IF;

  PERFORM 1
  FROM public.payroll_payments pp
  WHERE pp.business_id = p_business_id
    AND pp.payroll_run_id = p_payroll_run_id
    AND pp.deleted_at IS NULL
  ORDER BY pp.id
  FOR UPDATE;

  SELECT COALESCE(SUM(pp.amount), 0)
  INTO v_total_paid
  FROM public.payroll_payments pp
  WHERE pp.business_id = p_business_id
    AND pp.payroll_run_id = p_payroll_run_id
    AND pp.deleted_at IS NULL
    AND pp.journal_entry_id IS NOT NULL
    AND pp.reversed_at IS NULL;

  v_outstanding := ROUND(COALESCE(v_run.total_net_salary, 0) - v_total_paid, 2);

  IF v_amount - v_outstanding > v_tol THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_EXCEEDS_OUTSTANDING',
      format('Payment amount exceeds outstanding net salaries payable (outstanding=%s)', v_outstanding)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_payment_account_id
      AND a.business_id = p_business_id
      AND a.deleted_at IS NULL
      AND a.type = 'asset'
      AND (
        COALESCE(LOWER(a.sub_type), '') IN ('cash', 'bank', 'momo', 'mobile_money')
        OR a.code IN ('1000', '1010', '1020')
      )
  ) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_INVALID_ACCOUNT',
      'Selected payment account is invalid. Must be an active cash/bank/momo asset account for this business.'
    );
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(p_business_id, p_payment_date);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_PERIOD_CLOSED',
      'The payment accounting period is closed',
      jsonb_build_object('cause', SQLERRM)
    );
  END;

  SELECT * INTO v_obligation
  FROM public.payroll_obligations po
  WHERE po.business_id = p_business_id
    AND po.payroll_run_id = p_payroll_run_id
    AND po.obligation_type = 'salary_net'
    AND po.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_OBLIGATION_MISMATCH',
      'salary_net obligation not found for payroll run'
    );
  END IF;

  IF ABS(COALESCE(v_obligation.amount_due, 0) - COALESCE(v_run.total_net_salary, 0)) > v_tol THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_OBLIGATION_MISMATCH',
      'salary_net obligation amount_due does not match payroll run total_net_salary'
    );
  END IF;

  IF p_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payroll_payment_batches b
    WHERE b.id = p_batch_id
      AND b.business_id = p_business_id
      AND b.payroll_run_id = p_payroll_run_id
      AND b.deleted_at IS NULL
  ) THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Invalid batch_id for payroll run');
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('payment_record');

  INSERT INTO public.payroll_payments (
    business_id, payroll_run_id, payment_date, amount, payment_account_id,
    reference, notes, batch_id, batch_item_id, created_by, idempotency_key
  )
  VALUES (
    p_business_id, p_payroll_run_id, p_payment_date, v_amount, p_payment_account_id,
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    p_batch_id, p_batch_item_id, v_uid, TRIM(p_idempotency_key)
  )
  RETURNING id INTO v_payment_id;

  v_journal_id := public._post_payroll_payment_journal_internal(
    p_business_id, v_payment_id, p_payroll_run_id, p_payment_date,
    v_amount, p_payment_account_id, v_run.payroll_month
  );

  INSERT INTO public.payroll_obligation_payments (
    business_id, payroll_run_id, payroll_obligation_id,
    payment_date, amount, payment_account_id, reference, notes,
    journal_entry_id, created_by, payroll_payment_id
  )
  VALUES (
    p_business_id, p_payroll_run_id, v_obligation.id,
    p_payment_date, v_amount, p_payment_account_id,
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    v_journal_id, v_uid, v_payment_id
  )
  RETURNING id INTO v_obligation_payment_id;

  v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);

  SELECT pp.payment_date, pp.reference, pp.payment_account_id
  INTO v_latest_payment
  FROM public.payroll_payments pp
  WHERE pp.business_id = p_business_id
    AND pp.payroll_run_id = p_payroll_run_id
    AND pp.deleted_at IS NULL
    AND pp.journal_entry_id IS NOT NULL
  ORDER BY pp.payment_date DESC, pp.created_at DESC
  LIMIT 1;

  PERFORM public.finza_set_payroll_mutation_context('payment_settle');
  UPDATE public.payroll_obligations
  SET amount_paid = LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2)),
      status = public.payroll_obligation_status(COALESCE(amount_due, 0), LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2))),
      latest_payment_date = v_latest_payment.payment_date,
      latest_payment_reference = v_latest_payment.reference,
      payment_account_id = v_latest_payment.payment_account_id,
      updated_at = NOW()
  WHERE id = v_obligation.id;

  PERFORM public.create_audit_log(
    p_business_id, v_uid, v_audit_action, 'payroll_payment', v_payment_id,
    NULL,
    jsonb_build_object(
      'payroll_run_id', p_payroll_run_id,
      'journal_entry_id', v_journal_id,
      'obligation_id', v_obligation.id,
      'obligation_payment_id', v_obligation_payment_id,
      'amount', v_amount,
      'payment_date', p_payment_date,
      'payment_account_id', p_payment_account_id,
      'reference', NULLIF(TRIM(COALESCE(p_reference, '')), ''),
      'batch_id', p_batch_id,
      'batch_item_id', p_batch_item_id,
      'idempotency_key', TRIM(p_idempotency_key)
    ),
    NULL, NULL,
    format('Payroll salary payment recorded for run %s', LEFT(p_payroll_run_id::TEXT, 8))
  );

  RETURN jsonb_build_object(
    'reused', false,
    'payment_id', v_payment_id,
    'journal_entry_id', v_journal_id,
    'obligation_id', v_obligation.id,
    'obligation_payment_id', v_obligation_payment_id,
    'amount', v_amount,
    'amount_paid', LEAST(COALESCE(v_obligation.amount_due, 0), ROUND(v_paid_total, 2)),
    'outstanding', GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - ROUND(v_paid_total, 2), 2)),
    'obligation_status', public.payroll_obligation_status(COALESCE(v_obligation.amount_due, 0), LEAST(COALESCE(v_obligation.amount_due, 0), ROUND(v_paid_total, 2)))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payroll_payment_atomic(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_payment_atomic(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, UUID, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12) Atomic batch item payment RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payroll_batch_item_payment_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_batch_id UUID,
  p_batch_item_id UUID,
  p_payment_date DATE,
  p_payment_account_id UUID,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_actor_id, auth.uid());
  v_item public.payroll_payment_batch_items%ROWTYPE;
  v_batch public.payroll_payment_batches%ROWTYPE;
  v_payment JSONB;
  v_payment_id UUID;
  v_new_batch_status TEXT;
BEGIN
  SELECT * INTO v_batch
  FROM public.payroll_payment_batches b
  WHERE b.id = p_batch_id
    AND b.business_id = p_business_id
    AND b.payroll_run_id = p_payroll_run_id
    AND b.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Batch not found');
  END IF;

  IF v_batch.status = 'cancelled' THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Cannot pay items on a cancelled batch');
  END IF;

  SELECT * INTO v_item
  FROM public.payroll_payment_batch_items i
  WHERE i.id = p_batch_item_id
    AND i.batch_id = p_batch_id
    AND i.business_id = p_business_id
    AND i.payroll_run_id = p_payroll_run_id
    AND i.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Batch item not found');
  END IF;

  IF v_item.status = 'paid' AND v_item.payroll_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reused', true,
      'payment_id', v_item.payroll_payment_id,
      'batch_item_id', v_item.id,
      'batch_status', v_batch.status
    );
  END IF;

  IF v_item.status NOT IN ('pending', 'failed') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_INVALID_INPUT',
      format('Batch item status %s is not payable', v_item.status)
    );
  END IF;

  IF COALESCE(v_item.amount, 0) <= 0 THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Batch item amount must be positive');
  END IF;

  v_payment := public.record_payroll_payment_atomic(
    p_business_id,
    p_payroll_run_id,
    p_payment_date,
    v_item.amount,
    p_payment_account_id,
    p_reference,
    p_notes,
    p_batch_id,
    p_batch_item_id,
    v_uid,
    p_idempotency_key
  );

  v_payment_id := (v_payment->>'payment_id')::UUID;

  PERFORM public.finza_set_payroll_mutation_context('batch_item_payment');
  UPDATE public.payroll_payment_batch_items
  SET status = 'paid',
      payroll_payment_id = v_payment_id,
      paid_at = NOW(),
      paid_by = v_uid,
      payment_reference = NULLIF(TRIM(COALESCE(p_reference, '')), ''),
      updated_at = NOW()
  WHERE id = p_batch_item_id;

  v_new_batch_status := public.payroll_derive_batch_status_from_items(p_batch_id);

  UPDATE public.payroll_payment_batches
  SET status = v_new_batch_status,
      updated_at = NOW()
  WHERE id = p_batch_id;

  PERFORM public.create_audit_log(
    p_business_id, v_uid, 'payroll.batch_item_payment_recorded', 'payroll_payment_batch_item', p_batch_item_id,
    NULL,
    jsonb_build_object(
      'payroll_run_id', p_payroll_run_id,
      'batch_id', p_batch_id,
      'payroll_payment_id', v_payment_id,
      'amount', v_item.amount,
      'payment_date', p_payment_date,
      'payment_account_id', p_payment_account_id,
      'reference', NULLIF(TRIM(COALESCE(p_reference, '')), ''),
      'batch_status', v_new_batch_status,
      'idempotency_key', TRIM(p_idempotency_key)
    ),
    NULL, NULL,
    'Batch item salary payment recorded atomically'
  );

  RETURN v_payment || jsonb_build_object(
    'batch_item_id', p_batch_item_id,
    'batch_id', p_batch_id,
    'batch_status', v_new_batch_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payroll_batch_item_payment_atomic(
  UUID, UUID, UUID, UUID, DATE, UUID, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_batch_item_payment_atomic(
  UUID, UUID, UUID, UUID, DATE, UUID, TEXT, TEXT, UUID, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13) Lock payroll run RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_payroll_run_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_actor_id, auth.uid());
  v_run public.payroll_runs%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Not authorized');
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'payroll.approve') THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'payroll.approve permission required');
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_RUN_INVALID_STATUS_TRANSITION', 'Payroll run not found');
  END IF;

  IF v_run.status = 'locked' THEN
    RETURN jsonb_build_object('reused', true, 'status', 'locked');
  END IF;

  IF v_run.status <> 'approved' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_RUN_INVALID_STATUS_TRANSITION',
      format('Cannot lock payroll run from status %s', v_run.status)
    );
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('lock');
  UPDATE public.payroll_runs
  SET status = 'locked', updated_at = NOW()
  WHERE id = p_payroll_run_id;

  PERFORM public.create_audit_log(
    p_business_id, v_uid, 'payroll.run_locked', 'payroll_run', p_payroll_run_id,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'locked'),
    NULL, NULL,
    'Payroll run locked'
  );

  RETURN jsonb_build_object('reused', false, 'status', 'locked');
END;
$$;

REVOKE ALL ON FUNCTION public.lock_payroll_run_atomic(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run_atomic(UUID, UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 14) Restrict legacy posting RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payroll_payment_to_ledger(p_payroll_payment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.raise_payroll_payment_error(
    'PAYROLL_PAYMENT_INVALID_INPUT',
    'post_payroll_payment_to_ledger is internal-only; use record_payroll_payment_atomic'
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.post_payroll_payment_to_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_payroll_payment_to_ledger(UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- 15) Patch controlled payroll RPCs to set mutation context
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.approve_payroll_run_atomic(uuid,uuid)'::regprocedure)
  INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'approve_payroll_run_atomic not found';
  END IF;

  IF POSITION('finza_set_payroll_mutation_context(''approve'')' IN v_def) = 0 THEN
    IF POSITION(E'  UPDATE public.payroll_runs\n  SET\n    status = ''approved'',' IN v_def) > 0 THEN
      v_def := replace(
        v_def,
        E'  UPDATE public.payroll_runs\n  SET\n    status = ''approved'',',
        E'  PERFORM public.finza_set_payroll_mutation_context(''approve'');\n  UPDATE public.payroll_runs\n  SET\n    status = ''approved'','
      );
    ELSE
      RAISE EXCEPTION 'Cannot patch approve_payroll_run_atomic: approval UPDATE anchor missing';
    END IF;
    EXECUTE v_def;
  END IF;
END;
$patch$;

DO $patch$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.reverse_payroll_run_atomic(uuid,uuid,date,text,boolean)'::regprocedure)
  INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reverse_payroll_run_atomic not found';
  END IF;

  IF POSITION('PAYROLL_RUN_HAS_POSTED_SALARY_PAYMENTS' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      E'PAYROLL_REVERSAL_PAYMENTS_EXIST' || E',\n      ''Payroll cannot be reversed after salary or obligation payments exist''',
      E'PAYROLL_RUN_HAS_POSTED_SALARY_PAYMENTS' || E',\n      ''Payroll cannot be reversed while posted salary payments exist'''
    );
  END IF;

  IF POSITION('finza_set_payroll_mutation_context(''reverse'')' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      E'  UPDATE public.payroll_runs\n  SET status = ''reversed'',',
      E'  PERFORM public.finza_set_payroll_mutation_context(''reverse'');\n  UPDATE public.payroll_runs\n  SET status = ''reversed'','
    );
  END IF;

  EXECUTE v_def;
END;
$patch$;

DO $patch$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.create_payroll_correction_draft_from_reversed(uuid,uuid,uuid)'::regprocedure)
  INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'create_payroll_correction_draft_from_reversed not found';
  END IF;

  IF POSITION('finza_set_payroll_mutation_context(''correction_link'')' IN v_def) = 0 THEN
    v_def := replace(
      v_def,
      E'    UPDATE public.payroll_runs\n    SET corrected_by_run_id = v_correction_id, updated_at = NOW()\n    WHERE id = p_original_run_id;',
      E'    PERFORM public.finza_set_payroll_mutation_context(''correction_link'');\n    UPDATE public.payroll_runs\n    SET corrected_by_run_id = v_correction_id, updated_at = NOW()\n    WHERE id = p_original_run_id;'
    );
    v_def := replace(
      v_def,
      E'  UPDATE public.payroll_runs\n  SET corrected_by_run_id = v_correction_id, updated_at = NOW()\n  WHERE id = p_original_run_id;',
      E'  PERFORM public.finza_set_payroll_mutation_context(''correction_link'');\n  UPDATE public.payroll_runs\n  SET corrected_by_run_id = v_correction_id, updated_at = NOW()\n  WHERE id = p_original_run_id;'
    );
    EXECUTE v_def;
  END IF;
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 16) Direct table mutation restrictions (RLS)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert payroll payments for their business" ON public.payroll_payments;
DROP POLICY IF EXISTS "Users can update payroll payments for their business" ON public.payroll_payments;
DROP POLICY IF EXISTS "Users can delete payroll payments for their business" ON public.payroll_payments;

DROP POLICY IF EXISTS "Users can insert payroll obligation payments for their business" ON public.payroll_obligation_payments;
DROP POLICY IF EXISTS "Users can update payroll obligation payments for their business" ON public.payroll_obligation_payments;
DROP POLICY IF EXISTS "Users can delete payroll obligation payments for their business" ON public.payroll_obligation_payments;

DROP POLICY IF EXISTS "Users can update payroll obligations for their business" ON public.payroll_obligations;

COMMENT ON FUNCTION public.record_payroll_payment_atomic(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, UUID, TEXT
) IS 'Atomically records a salary payment: payroll_payments + journal + salary_net obligation settlement + audit. Requires payroll.pay and idempotency_key.';

COMMENT ON FUNCTION public.record_payroll_batch_item_payment_atomic(
  UUID, UUID, UUID, UUID, DATE, UUID, TEXT, TEXT, UUID, TEXT
) IS 'Atomically records salary payment for one batch item and derives batch status from posted payments.';

COMMENT ON FUNCTION public.lock_payroll_run_atomic(UUID, UUID, UUID) IS
  'Locks an approved payroll run using controlled mutation context.';
