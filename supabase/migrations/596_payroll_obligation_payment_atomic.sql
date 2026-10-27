-- ============================================================================
-- Migration 596: Atomic payroll obligation remittance
-- ============================================================================
-- Problem:
--   Migration 562 removed the authenticated INSERT policy from
--   payroll_obligation_payments. The obligation-payment API still inserted a
--   payment row directly, so PAYE, SSNIT/Tier 1, Tier 2, and other employee
--   deduction remittances failed with an RLS error.
--
-- This migration:
--   1. Adds a business-scoped idempotency key to obligation payments.
--   2. Adds one atomic SECURITY DEFINER RPC that validates authority, run,
--      obligation, outstanding balance, payment account, liability account and
--      open period; inserts exactly one payment; posts exactly one balanced
--      liability-clearing journal; updates the obligation; and writes audit.
--   3. Leaves direct authenticated INSERT disabled. Only the trusted RPC and
--      service-role posting path can create obligation payments.
--
-- Does not change PAYE rates, payroll approval, salary-net payments, or any
-- historical ledger row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Idempotency key for obligation payments
-- ----------------------------------------------------------------------------
ALTER TABLE public.payroll_obligation_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payroll_obligation_payments_idempotency_key_check'
      AND conrelid = 'public.payroll_obligation_payments'::regclass
  ) THEN
    ALTER TABLE public.payroll_obligation_payments
      ADD CONSTRAINT payroll_obligation_payments_idempotency_key_check
      CHECK (
        idempotency_key IS NULL
        OR length(BTRIM(idempotency_key)) BETWEEN 1 AND 128
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_obligation_payments_business_idempotency
  ON public.payroll_obligation_payments (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.payroll_obligation_payments.idempotency_key IS
  'Business-scoped retry key for the atomic obligation remittance RPC. Null on historical rows.';

-- ----------------------------------------------------------------------------
-- 2) Atomic obligation remittance RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payroll_obligation_payment_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_payroll_obligation_id UUID,
  p_payment_date DATE,
  p_amount NUMERIC,
  p_payment_account_id UUID,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tol NUMERIC := 0.01;
  v_key TEXT := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  v_amount NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
  v_run public.payroll_runs%ROWTYPE;
  v_obligation public.payroll_obligations%ROWTYPE;
  v_existing public.payroll_obligation_payments%ROWTYPE;
  v_payment_id UUID;
  v_journal_id UUID;
  v_paid_total NUMERIC := 0;
  v_outstanding NUMERIC := 0;
  v_status TEXT;
  v_liability_account_id UUID;
  v_payment_account RECORD;
  v_latest_payment RECORD;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_PERMISSION_DENIED',
      'Authentication required'
    );
  END IF;

  IF p_business_id IS NULL
     OR p_payroll_run_id IS NULL
     OR p_payroll_obligation_id IS NULL
     OR p_payment_account_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_INVALID_INPUT',
      'business_id, payroll_run_id, payroll_obligation_id and payment_account_id are required'
    );
  END IF;

  IF p_payment_date IS NULL OR v_amount <= 0 THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_INVALID_INPUT',
      'payment_date and a positive amount are required'
    );
  END IF;

  IF v_key IS NULL OR length(v_key) > 128 THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_IDEMPOTENCY_REQUIRED',
      'A 1-128 character idempotency_key is required'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_PERMISSION_DENIED',
      'Not authorized for this business'
    );
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'payroll.pay') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_PERMISSION_DENIED',
      'payroll.pay permission required'
    );
  END IF;

  -- Serialize retries with the same key, then serialize payments against the
  -- payroll run and obligation. Different keys for the same obligation wait on
  -- the obligation row and re-check outstanding after the lock.
  PERFORM pg_advisory_xact_lock(
    hashtext('payroll_obligation_payment_key'),
    hashtext(p_business_id::TEXT || ':' || v_key)
  );

  SELECT * INTO v_existing
  FROM public.payroll_obligation_payments pop
  WHERE pop.business_id = p_business_id
    AND pop.idempotency_key = v_key
    AND pop.deleted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id
       OR v_existing.payroll_obligation_id IS DISTINCT FROM p_payroll_obligation_id
       OR v_existing.payment_date IS DISTINCT FROM p_payment_date
       OR v_existing.amount IS DISTINCT FROM v_amount
       OR v_existing.payment_account_id IS DISTINCT FROM p_payment_account_id
       OR COALESCE(v_existing.reference, '') IS DISTINCT FROM COALESCE(public.payroll_normalize_payment_reference(p_reference), '')
       OR COALESCE(v_existing.notes, '') IS DISTINCT FROM COALESCE(NULLIF(BTRIM(COALESCE(p_notes, '')), ''), '') THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_OBLIGATION_PAYMENT_IDEMPOTENCY_CONFLICT',
        'Idempotency key reused with different payment inputs'
      );
    END IF;

    IF v_existing.journal_entry_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_OBLIGATION_PAYMENT_INCONSISTENT_STATE',
        'Existing obligation payment is missing journal linkage'
      );
    END IF;

    SELECT * INTO v_obligation
    FROM public.payroll_obligations po
    WHERE po.id = v_existing.payroll_obligation_id
      AND po.business_id = p_business_id
      AND po.payroll_run_id = p_payroll_run_id
      AND po.deleted_at IS NULL;

    IF NOT FOUND THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_OBLIGATION_PAYMENT_INCONSISTENT_STATE',
        'Existing obligation payment is not linked to the expected obligation'
      );
    END IF;

    v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);
    v_status := public.payroll_obligation_status(v_obligation.amount_due, v_paid_total);

    RETURN jsonb_build_object(
      'reused', true,
      'payment_id', v_existing.id,
      'journal_entry_id', v_existing.journal_entry_id,
      'obligation_id', v_obligation.id,
      'amount', v_existing.amount,
      'amount_paid', v_paid_total,
      'outstanding', GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - v_paid_total, 2)),
      'obligation_status', v_status,
      'latest_payment_date', v_obligation.latest_payment_date,
      'latest_payment_reference', v_obligation.latest_payment_reference
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id
    AND pr.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_INVALID_INPUT',
      'Payroll run not found'
    );
  END IF;

  IF v_run.status NOT IN ('approved', 'locked') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_RUN_NOT_PAYABLE',
      format('Payroll run status %s is not payable', v_run.status)
    );
  END IF;

  SELECT * INTO v_obligation
  FROM public.payroll_obligations po
  WHERE po.id = p_payroll_obligation_id
    AND po.business_id = p_business_id
    AND po.payroll_run_id = p_payroll_run_id
    AND po.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_NOT_FOUND',
      'Payroll obligation not found'
    );
  END IF;

  IF v_obligation.obligation_type = 'salary_net' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_SALARY_NET_REQUIRES_SALARY_PAYMENT',
      'Net salary must be paid through the payroll salary-payment RPC'
    );
  END IF;

  IF v_obligation.reversed_at IS NOT NULL OR v_obligation.status = 'reversed' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_OBLIGATION_REVERSED',
      'Reversed payroll obligations cannot accept payments'
    );
  END IF;

  v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);
  v_outstanding := GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - v_paid_total, 2));

  IF v_outstanding <= v_tol THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_ALREADY_PAID',
      'This payroll obligation has no outstanding balance'
    );
  END IF;

  IF v_amount - v_outstanding > v_tol THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_EXCEEDS_OUTSTANDING',
      format('Payment amount exceeds outstanding obligation (outstanding=%s)', v_outstanding)
    );
  END IF;

  SELECT id, code, sub_type, type, deleted_at
  INTO v_payment_account
  FROM public.accounts a
  WHERE a.id = p_payment_account_id
    AND a.business_id = p_business_id;

  IF NOT FOUND
     OR v_payment_account.deleted_at IS NOT NULL
     OR v_payment_account.type <> 'asset'
     OR NOT (
       COALESCE(LOWER(v_payment_account.sub_type), '') IN ('cash', 'bank', 'momo', 'mobile_money')
       OR v_payment_account.code IN ('1000', '1010', '1020')
     ) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_INVALID_ACCOUNT',
      'Selected payment account is invalid. Must be an active cash/bank/momo asset account for this business.'
    );
  END IF;

  SELECT a.id INTO v_liability_account_id
  FROM public.accounts a
  WHERE a.business_id = p_business_id
    AND a.code = COALESCE(v_obligation.liability_account_code, '')
    AND a.type = 'liability'
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF v_liability_account_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_LIABILITY_ACCOUNT_MISSING',
      format('Liability account code %s is not configured for this business', v_obligation.liability_account_code)
    );
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(p_business_id, p_payment_date);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_PERIOD_CLOSED',
      'The payment accounting period is closed',
      jsonb_build_object('cause', SQLERRM)
    );
  END;

  INSERT INTO public.payroll_obligation_payments (
    business_id,
    payroll_run_id,
    payroll_obligation_id,
    payment_date,
    amount,
    payment_account_id,
    reference,
    notes,
    created_by,
    idempotency_key
  ) VALUES (
    p_business_id,
    p_payroll_run_id,
    p_payroll_obligation_id,
    p_payment_date,
    v_amount,
    p_payment_account_id,
    public.payroll_normalize_payment_reference(p_reference),
    NULLIF(BTRIM(COALESCE(p_notes, '')), ''),
    v_uid,
    v_key
  )
  RETURNING id INTO v_payment_id;

  v_journal_id := public.post_payroll_obligation_payment_to_ledger(v_payment_id);

  IF v_journal_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_OBLIGATION_PAYMENT_JOURNAL_REQUIRED',
      'Obligation payment journal was not created'
    );
  END IF;

  v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);
  v_status := public.payroll_obligation_status(v_obligation.amount_due, v_paid_total);

  SELECT pop.payment_date, pop.reference, pop.payment_account_id
  INTO v_latest_payment
  FROM public.payroll_obligation_payments pop
  WHERE pop.business_id = p_business_id
    AND pop.payroll_obligation_id = v_obligation.id
    AND pop.deleted_at IS NULL
    AND pop.journal_entry_id IS NOT NULL
  ORDER BY pop.payment_date DESC, pop.created_at DESC
  LIMIT 1;

  PERFORM public.finza_set_payroll_mutation_context('payment_settle');

  UPDATE public.payroll_obligations
  SET amount_paid = LEAST(COALESCE(amount_due, 0), v_paid_total),
      status = v_status,
      latest_payment_date = v_latest_payment.payment_date,
      latest_payment_reference = v_latest_payment.reference,
      payment_account_id = v_latest_payment.payment_account_id,
      journal_entry_id = v_journal_id,
      updated_at = NOW()
  WHERE id = v_obligation.id;

  PERFORM public.finza_clear_payroll_mutation_context();

  PERFORM public.create_audit_log(
    p_business_id,
    v_uid,
    'payroll.obligation_payment_recorded',
    'payroll_obligation_payment',
    v_payment_id,
    NULL,
    jsonb_build_object(
      'payroll_run_id', p_payroll_run_id,
      'payroll_obligation_id', v_obligation.id,
      'obligation_type', v_obligation.obligation_type,
      'journal_entry_id', v_journal_id,
      'amount', v_amount,
      'payment_date', p_payment_date,
      'payment_account_id', p_payment_account_id,
      'reference', public.payroll_normalize_payment_reference(p_reference),
      'amount_paid', v_paid_total,
      'outstanding', GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - v_paid_total, 2)),
      'obligation_status', v_status,
      'idempotency_key', v_key
    ),
    NULL,
    NULL,
    format('Payroll obligation payment recorded for %s', v_obligation.obligation_type)
  );

  RETURN jsonb_build_object(
    'reused', false,
    'payment_id', v_payment_id,
    'journal_entry_id', v_journal_id,
    'obligation_id', v_obligation.id,
    'amount', v_amount,
    'amount_paid', v_paid_total,
    'outstanding', GREATEST(0, ROUND(COALESCE(v_obligation.amount_due, 0) - v_paid_total, 2)),
    'obligation_status', v_status,
    'latest_payment_date', v_latest_payment.payment_date,
    'latest_payment_reference', v_latest_payment.reference
  );
END;
$$;

COMMENT ON FUNCTION public.record_payroll_obligation_payment_atomic(
  UUID, UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, TEXT
) IS
  'Atomically records a non-salary payroll obligation remittance (PAYE, pension, deductions): payment + balanced liability-clearing journal + obligation status + audit, with idempotency and concurrency locks.';

REVOKE ALL ON FUNCTION public.record_payroll_obligation_payment_atomic(
  UUID, UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_obligation_payment_atomic(
  UUID, UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- The legacy helper remains callable only as the trusted implementation detail.
REVOKE ALL ON FUNCTION public.post_payroll_obligation_payment_to_ledger(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_payroll_obligation_payment_to_ledger(UUID)
  TO authenticated, service_role;
