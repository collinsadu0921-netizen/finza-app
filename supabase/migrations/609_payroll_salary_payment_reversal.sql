-- ============================================================================
-- Migration 609: Controlled salary-payment reversal
-- ============================================================================
-- Reverses Finza's accounting record of a salary payment only.
-- It does not refund money, call a bank, or initiate a Paystack transaction.
--
-- Normal reversal:
--   Dr original cash/bank/MoMo asset account
--   Cr 2240 Net Salaries Payable
--
-- The original payment row and journal remain intact. A separate reversal
-- journal is posted. A reversed batch item is returned to pending so a valid
-- replacement payment can be recorded without duplicate settlement.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Reversal metadata
-- ----------------------------------------------------------------------------
ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

ALTER TABLE public.payroll_obligation_payments
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_payments_reversal_reason_check'
      AND conrelid = 'public.payroll_payments'::regclass
  ) THEN
    ALTER TABLE public.payroll_payments
      ADD CONSTRAINT payroll_payments_reversal_reason_check
      CHECK (reversal_reason IS NULL OR length(BTRIM(reversal_reason)) BETWEEN 3 AND 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_obligation_payments_reversal_reason_check'
      AND conrelid = 'public.payroll_obligation_payments'::regclass
  ) THEN
    ALTER TABLE public.payroll_obligation_payments
      ADD CONSTRAINT payroll_obligation_payments_reversal_reason_check
      CHECK (reversal_reason IS NULL OR length(BTRIM(reversal_reason)) BETWEEN 3 AND 500);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_payments_reversal_journal
  ON public.payroll_payments(reversal_journal_id)
  WHERE reversal_journal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_obligation_payments_reversal_journal
  ON public.payroll_obligation_payments(reversal_journal_id)
  WHERE reversal_journal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_entries_one_payroll_payment_reversal
  ON public.journal_entries(business_id, reference_id)
  WHERE reference_type = 'payroll_payment_reversal'
    AND reference_id IS NOT NULL;

COMMENT ON COLUMN public.payroll_payments.reversal_journal_id IS
  'Balanced reversal journal for a salary payment. Null until the payment is reversed.';
COMMENT ON COLUMN public.payroll_obligation_payments.reversal_journal_id IS
  'Reversal journal that removed this salary-net obligation settlement.';

-- ----------------------------------------------------------------------------
-- 2) Authoritative posted salary-net total excludes reversed settlements
-- ----------------------------------------------------------------------------
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
    AND pop.reversed_at IS NULL
    AND pop.journal_entry_id IS NOT NULL
    AND (
      po.obligation_type IS DISTINCT FROM 'salary_net'
      OR pop.payroll_payment_id IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.payroll_obligation_posted_payments_total(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_posted_payments_total(UUID) TO postgres;

-- ----------------------------------------------------------------------------
-- 3) Retired idempotency keys cannot masquerade as successful replacements
-- ----------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def TEXT;
  v_old TEXT;
  v_new TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public._record_payroll_payment_atomic_impl(uuid,uuid,date,numeric,uuid,text,text,uuid,uuid,text,text,uuid)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '609 precondition failed: _record_payroll_payment_atomic_impl is missing';
  END IF;

  v_def := replace(v_def, E'\r\n', E'\n');
  v_def := replace(v_def, E'\r', E'\n');

  IF POSITION('Idempotency key belongs to a reversed payment' IN v_def) = 0 THEN
    v_old := E'  IF FOUND THEN\n    IF v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id';
    v_new := E'  IF FOUND THEN\n' ||
      E'    IF v_existing.reversed_at IS NOT NULL OR v_existing.reversal_journal_id IS NOT NULL THEN\n' ||
      E'      PERFORM public.raise_payroll_payment_error(\n' ||
      E'        ''PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT'',\n' ||
      E'        ''Idempotency key belongs to a reversed payment; use a new idempotency key for a replacement payment''\n' ||
      E'      );\n' ||
      E'    END IF;\n\n' ||
      E'    IF v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id';

    IF POSITION(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION '609: idempotency-reuse anchor missing';
    END IF;

    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
  END IF;

  IF POSITION('Idempotency key belongs to a reversed payment' IN v_def) = 0 THEN
    RAISE EXCEPTION '609 postcondition failed: reversed idempotency guard missing';
  END IF;
END;
$patch$;

-- ----------------------------------------------------------------------------
-- 4) Posted payment immutability, with a one-way reversal context
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payments_enforce_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.journal_entry_id IS NOT NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_REVERSAL_REQUIRED',
        'Posted payroll payments cannot be deleted; use reverse_payroll_payment_atomic'
      );
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_ctx = 'payment_record' AND OLD.journal_entry_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF v_ctx = 'payment_reverse' AND OLD.journal_entry_id IS NOT NULL THEN
      IF OLD.reversed_at IS NOT NULL OR OLD.reversal_journal_id IS NOT NULL THEN
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_PAYMENT_REVERSAL_ALREADY_COMPLETED',
          'Payroll payment is already reversed'
        );
      END IF;

      IF NEW.business_id IS DISTINCT FROM OLD.business_id
         OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
         OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
         OR NEW.amount IS DISTINCT FROM OLD.amount
         OR NEW.payment_account_id IS DISTINCT FROM OLD.payment_account_id
         OR NEW.reference IS DISTINCT FROM OLD.reference
         OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
         OR NEW.idempotency_scope IS DISTINCT FROM OLD.idempotency_scope
         OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
         OR NEW.idempotency_key_sha256 IS DISTINCT FROM OLD.idempotency_key_sha256
         OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
         OR NEW.batch_item_id IS DISTINCT FROM OLD.batch_item_id
         OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
         OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      THEN
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
          'Reversal may only update reversal metadata'
        );
      END IF;

      IF NEW.reversed_at IS NULL
         OR NEW.reversed_by IS NULL
         OR NEW.reversal_journal_id IS NULL
         OR NULLIF(BTRIM(COALESCE(NEW.reversal_reason, '')), '') IS NULL
      THEN
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
          'Reversal requires reversed_at, reversed_by, reversal_journal_id and a reason'
        );
      END IF;

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
         OR NEW.idempotency_scope IS DISTINCT FROM OLD.idempotency_scope
         OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
         OR NEW.idempotency_key_sha256 IS DISTINCT FROM OLD.idempotency_key_sha256
         OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
         OR NEW.batch_item_id IS DISTINCT FROM OLD.batch_item_id
         OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
         OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
         OR NEW.reversed_by IS DISTINCT FROM OLD.reversed_by
         OR NEW.reversal_journal_id IS DISTINCT FROM OLD.reversal_journal_id
         OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason
      THEN
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

-- ----------------------------------------------------------------------------
-- 5) Batch item status may be reopened by the reversal RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payment_batch_items_enforce_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
  v_stripped_old JSONB;
  v_stripped_new JSONB;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid' THEN
    IF v_ctx = 'payment_reverse' THEN
      IF NEW.status <> 'pending'
         OR NEW.payroll_payment_id IS NOT NULL
         OR NEW.paid_at IS NOT NULL
         OR NEW.paid_by IS NOT NULL
         OR NEW.payment_reference IS NOT NULL
      THEN
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
          'A reversed payment must reopen its batch item as pending without a payment link'
        );
      END IF;
      RETURN NEW;
    END IF;

    v_stripped_old := to_jsonb(OLD) - 'updated_at';
    v_stripped_new := to_jsonb(NEW) - 'updated_at';
    IF v_stripped_old IS DISTINCT FROM v_stripped_new THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Paid batch items are immutable'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'paid'
     AND v_ctx IS DISTINCT FROM 'batch_item_payment' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
      'Batch items cannot be marked paid without record_payroll_batch_item_payment_atomic'
    );
  END IF;

  IF NEW.payroll_payment_id IS DISTINCT FROM OLD.payroll_payment_id
     AND v_ctx IS DISTINCT FROM 'batch_item_payment' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_LINK_CONFLICT',
      'Batch item payroll_payment_id may only be set by controlled settlement RPC'
    );
  END IF;

  IF (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason
    OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
  ) AND v_ctx NOT IN ('batch_item_payment', 'batch_item_status', 'payment_reverse') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_ITEM_INVALID_STATUS_TRANSITION',
      'Batch item status may only change via controlled payroll batch workflows'
    );
  END IF;

  IF NEW.status = 'paid' AND v_ctx = 'batch_item_payment' THEN
    IF NEW.payroll_payment_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Paid batch items must reference a posted payroll payment'
      );
    END IF;
    PERFORM public.payroll_verify_batch_item_payment_reciprocal(NEW.id, NEW.payroll_payment_id);
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6) Batch header status may be re-derived by the reversal RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payment_batches_enforce_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF v_ctx = 'batch_item_payment' THEN
      IF NEW.status IN ('paid', 'partially_paid') THEN
        PERFORM public.payroll_verify_batch_payment_integrity(NEW.id);
      END IF;
      RETURN NEW;
    END IF;

    IF v_ctx = 'batch_item_status' THEN
      IF NEW.status IN ('paid', 'partially_paid') THEN
        PERFORM public.payroll_verify_batch_payment_integrity(NEW.id);
      END IF;
      IF NEW.status IN ('draft', 'ready', 'processing', 'cancelled', 'partially_paid', 'failed') THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Derived batch status %s is not allowed via item status workflow', NEW.status)
      );
    END IF;

    IF v_ctx = 'batch_status_transition' THEN
      IF NEW.status IN ('draft', 'ready', 'processing', 'cancelled') THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Batch status %s cannot be set via batch transition RPC', NEW.status)
      );
    END IF;

    IF v_ctx = 'payment_reverse' THEN
      IF NEW.status IN ('draft', 'ready', 'processing', 'partially_paid', 'failed', 'cancelled') THEN
        RETURN NEW;
      END IF;
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Derived batch status %s is not allowed after payment reversal', NEW.status)
      );
    END IF;

    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED',
      'Batch status may only change via controlled payroll batch workflows'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7) Atomic salary-payment reversal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payroll_payment_atomic(
  p_business_id UUID,
  p_payroll_payment_id UUID,
  p_reversal_date DATE,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_payment public.payroll_payments%ROWTYPE;
  v_run public.payroll_runs%ROWTYPE;
  v_obligation public.payroll_obligations%ROWTYPE;
  v_obligation_payment public.payroll_obligation_payments%ROWTYPE;
  v_asset_account_id UUID;
  v_net_salaries_account_id UUID;
  v_original_journal_id UUID;
  v_reversal_journal_id UUID;
  v_paid_total NUMERIC := 0;
  v_batch_status TEXT;
  v_latest_payment_date DATE;
  v_latest_payment_reference TEXT;
  v_latest_payment_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
BEGIN
  IF v_uid IS NULL
     OR p_business_id IS NULL
     OR p_payroll_payment_id IS NULL
     OR p_reversal_date IS NULL
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INVALID_INPUT',
      'Authentication, business, payment and reversal date are required'
    );
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INVALID_INPUT',
      'Reversal reason must contain between 3 and 500 characters'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.reverse')
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_PERMISSION_DENIED',
      'payroll.reverse permission required'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('payroll_payment_reverse'),
    hashtext(p_business_id::TEXT || ':' || p_payroll_payment_id::TEXT)
  );

  SELECT * INTO v_payment
  FROM public.payroll_payments pp
  WHERE pp.id = p_payroll_payment_id
    AND pp.business_id = p_business_id
    AND pp.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_NOT_FOUND',
      'Payroll payment not found'
    );
  END IF;

  IF v_payment.journal_entry_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'Payroll payment has no posted journal'
    );
  END IF;

  IF v_payment.reversed_at IS NOT NULL OR v_payment.reversal_journal_id IS NOT NULL THEN
    IF v_payment.reversal_journal_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
        'Payroll payment has incomplete reversal metadata'
      );
    END IF;

    RETURN jsonb_build_object(
      'reused', TRUE,
      'payment_id', v_payment.id,
      'reversal_journal_id', v_payment.reversal_journal_id,
      'original_journal_id', v_payment.journal_entry_id,
      'reversal_date', v_payment.reversed_at,
      'reversal_reason', v_payment.reversal_reason
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs pr
  WHERE pr.id = v_payment.payroll_run_id
    AND pr.business_id = p_business_id
    AND pr.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_run.status NOT IN ('approved', 'locked') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_CONFLICT',
      'Only payments on approved or locked payroll runs can be reversed'
    );
  END IF;

  SELECT je.id INTO v_original_journal_id
  FROM public.journal_entries je
  WHERE je.id = v_payment.journal_entry_id
    AND je.business_id = p_business_id
    AND je.reference_type = 'payroll_payment'
    AND je.reference_id = v_payment.id;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'Original payroll payment journal does not match the payment'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries r
    WHERE r.reverses_entry_id = v_original_journal_id
  ) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_ALREADY_COMPLETED',
      'Payroll payment journal is already reversed'
    );
  END IF;

  SELECT a.id INTO v_asset_account_id
  FROM public.accounts a
  WHERE a.id = v_payment.payment_account_id
    AND a.business_id = p_business_id
    AND a.type = 'asset'
    AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'Original payment account is missing or is not an active asset account'
    );
  END IF;

  SELECT a.id INTO v_net_salaries_account_id
  FROM public.accounts a
  WHERE a.business_id = p_business_id
    AND a.code = '2240'
    AND a.type = 'liability'
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF v_net_salaries_account_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'Net Salaries Payable account (2240) is not configured'
    );
  END IF;

  BEGIN
    PERFORM public.assert_accounting_period_is_open(p_business_id, p_reversal_date);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_PERIOD_CLOSED',
      'The reversal accounting period is closed. Choose a current open-period reversal date.',
      jsonb_build_object('cause', SQLERRM)
    );
  END;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    posting_source,
    reverses_entry_id
  ) VALUES (
    p_business_id,
    p_reversal_date,
    'Reversed salary payment - ' || TO_CHAR(v_payment.payment_date, 'DD Mon YYYY'),
    'payroll_payment_reversal',
    v_payment.id,
    'system',
    v_original_journal_id
  )
  RETURNING id INTO v_reversal_journal_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  ) VALUES
    (
      v_reversal_journal_id,
      v_asset_account_id,
      ROUND(v_payment.amount, 2),
      0,
      'Reversal of salary payment (restore payment account)'
    ),
    (
      v_reversal_journal_id,
      v_net_salaries_account_id,
      0,
      ROUND(v_payment.amount, 2),
      'Reversal of salary payment (restore net salaries payable)'
    );

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_reversal_journal_id;

  IF ABS(v_debit - v_credit) > 0.01
     OR ABS(v_debit - ROUND(v_payment.amount, 2)) > 0.01
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'Generated salary-payment reversal journal is unbalanced'
    );
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('payment_reverse');

  UPDATE public.payroll_payments
  SET reversed_at = NOW(),
      reversed_by = v_uid,
      reversal_journal_id = v_reversal_journal_id,
      reversal_reason = v_reason,
      updated_at = NOW()
  WHERE id = v_payment.id;

  SELECT * INTO v_obligation_payment
  FROM public.payroll_obligation_payments pop
  WHERE pop.payroll_payment_id = v_payment.id
    AND pop.business_id = p_business_id
    AND pop.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'Salary payment has no linked obligation settlement to reverse'
    );
  END IF;

  UPDATE public.payroll_obligation_payments
  SET reversed_at = NOW(),
      reversed_by = v_uid,
      reversal_journal_id = v_reversal_journal_id,
      reversal_reason = v_reason
  WHERE id = v_obligation_payment.id;

  SELECT * INTO v_obligation
  FROM public.payroll_obligations po
  WHERE po.business_id = p_business_id
    AND po.payroll_run_id = v_payment.payroll_run_id
    AND po.obligation_type = 'salary_net'
    AND po.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
      'salary_net obligation not found for payroll run'
    );
  END IF;

  v_paid_total := public.payroll_obligation_posted_payments_total(v_obligation.id);

  SELECT pp.payment_date, pp.reference, pp.payment_account_id
  INTO v_latest_payment_date, v_latest_payment_reference, v_latest_payment_account_id
  FROM public.payroll_payments pp
  WHERE pp.business_id = p_business_id
    AND pp.payroll_run_id = v_payment.payroll_run_id
    AND pp.deleted_at IS NULL
    AND pp.journal_entry_id IS NOT NULL
    AND pp.reversed_at IS NULL
  ORDER BY pp.payment_date DESC, pp.created_at DESC
  LIMIT 1;

  PERFORM public.finza_set_payroll_mutation_context('payment_settle');

  UPDATE public.payroll_obligations
  SET amount_paid = LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2)),
      status = public.payroll_obligation_status(
        COALESCE(amount_due, 0),
        LEAST(COALESCE(amount_due, 0), ROUND(v_paid_total, 2))
      ),
      latest_payment_date = v_latest_payment_date,
      latest_payment_reference = v_latest_payment_reference,
      payment_account_id = v_latest_payment_account_id,
      updated_at = NOW()
  WHERE id = v_obligation.id;

  IF v_payment.batch_item_id IS NOT NULL THEN
    IF v_payment.batch_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
        'Batch-item payment is missing its batch id'
      );
    END IF;

    PERFORM public.finza_set_payroll_mutation_context('payment_reverse');

    UPDATE public.payroll_payment_batch_items
    SET status = 'pending',
        payroll_payment_id = NULL,
        paid_at = NULL,
        paid_by = NULL,
        payment_reference = NULL,
        updated_at = NOW()
    WHERE id = v_payment.batch_item_id
      AND business_id = p_business_id
      AND payroll_run_id = v_payment.payroll_run_id
      AND status = 'paid'
      AND payroll_payment_id = v_payment.id;

    IF NOT FOUND THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
        'Linked batch item is not in the expected paid state'
      );
    END IF;

    v_batch_status := public.payroll_derive_batch_status_from_items(v_payment.batch_id);

    UPDATE public.payroll_payment_batches
    SET status = v_batch_status,
        updated_at = NOW()
    WHERE id = v_payment.batch_id
      AND business_id = p_business_id;

    IF NOT FOUND THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_REVERSAL_INCONSISTENT_STATE',
        'Linked payment batch could not be reloaded'
      );
    END IF;
  END IF;

  PERFORM public.finza_clear_payroll_mutation_context();

  PERFORM public.create_audit_log(
    p_business_id,
    v_uid,
    'payroll.payment_reversed',
    'payroll_payment',
    v_payment.id,
    jsonb_build_object(
      'amount', v_payment.amount,
      'payment_date', v_payment.payment_date,
      'journal_entry_id', v_payment.journal_entry_id,
      'batch_id', v_payment.batch_id,
      'batch_item_id', v_payment.batch_item_id,
      'obligation_amount_paid', v_obligation.amount_paid
    ),
    jsonb_build_object(
      'reversal_journal_id', v_reversal_journal_id,
      'reversal_date', p_reversal_date,
      'reversal_reason', v_reason,
      'obligation_amount_paid', LEAST(COALESCE(v_obligation.amount_due, 0), ROUND(v_paid_total, 2)),
      'batch_status', v_batch_status
    ),
    NULL,
    NULL,
    format('Salary payment %s reversed; 2240 liability restored', LEFT(v_payment.id::TEXT, 8))
  );

  RETURN jsonb_build_object(
    'reused', FALSE,
    'payment_id', v_payment.id,
    'reversal_journal_id', v_reversal_journal_id,
    'original_journal_id', v_original_journal_id,
    'reversal_date', p_reversal_date,
    'reversal_reason', v_reason,
    'obligation_id', v_obligation.id,
    'obligation_amount_paid', LEAST(COALESCE(v_obligation.amount_due, 0), ROUND(v_paid_total, 2)),
    'obligation_outstanding', GREATEST(
      0,
      ROUND(COALESCE(v_obligation.amount_due, 0) - ROUND(v_paid_total, 2), 2)
    ),
    'batch_item_status', CASE WHEN v_payment.batch_item_id IS NOT NULL THEN 'pending' ELSE NULL END,
    'batch_status', v_batch_status
  );
END;
$$;

COMMENT ON FUNCTION public.reverse_payroll_payment_atomic(UUID, UUID, DATE, TEXT) IS
  'Reverses a posted salary payment with a separate balanced journal: Dr original payment asset, Cr 2240. Restores salary-net obligation and reopens a linked batch item. Does not move money or reverse salary expense.';

REVOKE ALL ON FUNCTION public.reverse_payroll_payment_atomic(UUID, UUID, DATE, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payroll_payment_atomic(UUID, UUID, DATE, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
