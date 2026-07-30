-- ============================================================================
-- Migration 563: Payroll payment identity, allocation and audit-attribution hardening
-- Focused correction to migration 562. Does NOT edit migrations 552–562.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Pre-flight duplicate link scan (fail closed)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dup_payment_links INT;
  v_dup_item_links INT;
  v_detail TEXT := '';
BEGIN
  SELECT COUNT(*) INTO v_dup_payment_links
  FROM (
    SELECT i.payroll_payment_id
    FROM public.payroll_payment_batch_items i
    WHERE i.payroll_payment_id IS NOT NULL
      AND i.deleted_at IS NULL
    GROUP BY i.payroll_payment_id
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*) INTO v_dup_item_links
  FROM (
    SELECT pp.batch_item_id
    FROM public.payroll_payments pp
    WHERE pp.batch_item_id IS NOT NULL
      AND pp.deleted_at IS NULL
      AND pp.reversed_at IS NULL
    GROUP BY pp.batch_item_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_dup_payment_links > 0 OR v_dup_item_links > 0 THEN
    v_detail := format(
      'payment_id_duplicates=%s batch_item_duplicates=%s',
      v_dup_payment_links,
      v_dup_item_links
    );
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_LINK_CONFLICT',
      'Conflicting historical batch/payment links must be resolved before migration 563',
      jsonb_build_object('detail', v_detail)
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Schema extensions
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_payments
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key_sha256 TEXT;

COMMENT ON COLUMN public.payroll_payments.idempotency_scope IS
  'manual_payroll_payment | batch_item_payment — distinguishes idempotency identity.';
COMMENT ON COLUMN public.payroll_payments.request_fingerprint IS
  'Server-computed SHA-256 of immutable payment inputs for idempotency conflict detection.';
COMMENT ON COLUMN public.payroll_payments.idempotency_key_sha256 IS
  'SHA-256 of idempotency key for audit attribution without storing the raw key.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_payment_batch_items_active_payment
  ON public.payroll_payment_batch_items(payroll_payment_id)
  WHERE payroll_payment_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_payments_active_batch_item
  ON public.payroll_payments(batch_item_id)
  WHERE batch_item_id IS NOT NULL AND deleted_at IS NULL AND reversed_at IS NULL;

CREATE OR REPLACE FUNCTION public.finza_clear_payroll_mutation_context()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('finza.payroll_mutation_context', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.finza_clear_payroll_mutation_context() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finza_clear_payroll_mutation_context() TO postgres;

-- ---------------------------------------------------------------------------
-- 3) Idempotency / fingerprint helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_normalize_payment_reference(p_reference TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(TRIM(COALESCE(p_reference, '')), '');
$$;

CREATE OR REPLACE FUNCTION public.payroll_idempotency_key_sha256(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(TRIM(COALESCE(p_key, '')), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.payroll_validate_idempotency_key(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_key TEXT := NULLIF(TRIM(COALESCE(p_key, '')), '');
BEGIN
  IF v_key IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED',
      'A stable idempotency key is required'
    );
  END IF;

  IF v_key !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency key must be 16–128 characters (letters, numbers, hyphen, underscore, colon, period)'
    );
  END IF;

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_validate_idempotency_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_validate_idempotency_key(TEXT) TO postgres;

CREATE OR REPLACE FUNCTION public.payroll_payment_request_fingerprint(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_payment_date DATE,
  p_amount NUMERIC,
  p_payment_account_id UUID,
  p_reference TEXT,
  p_batch_id UUID,
  p_batch_item_id UUID,
  p_idempotency_scope TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(
    digest(
      jsonb_build_object(
        'business_id', p_business_id,
        'payroll_run_id', p_payroll_run_id,
        'payment_date', p_payment_date,
        'amount', ROUND(COALESCE(p_amount, 0), 2),
        'payment_account_id', p_payment_account_id,
        'reference', public.payroll_normalize_payment_reference(p_reference),
        'batch_id', p_batch_id,
        'batch_item_id', p_batch_item_id,
        'idempotency_scope', p_idempotency_scope
      )::TEXT,
      'sha256'
    ),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.payroll_payment_request_fingerprint(UUID, UUID, DATE, NUMERIC, UUID, TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_payment_request_fingerprint(UUID, UUID, DATE, NUMERIC, UUID, TEXT, UUID, UUID, TEXT)
  TO postgres;

-- ---------------------------------------------------------------------------
-- 4) Reciprocal identity + batch reconciliation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_verify_batch_item_payment_reciprocal(
  p_item_id UUID,
  p_payment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.payroll_payment_batch_items%ROWTYPE;
  v_payment public.payroll_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_item
  FROM public.payroll_payment_batch_items i
  WHERE i.id = p_item_id AND i.deleted_at IS NULL;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_IDENTITY_MISMATCH',
      'Batch item not found for reciprocal verification'
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.payroll_payments pp
  WHERE pp.id = p_payment_id;

  IF NOT FOUND
     OR v_payment.deleted_at IS NOT NULL
     OR v_payment.reversed_at IS NOT NULL
     OR v_payment.journal_entry_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_IDENTITY_MISMATCH',
      'Batch item payment must reference an active posted payroll payment'
    );
  END IF;

  IF v_item.payroll_payment_id IS NOT NULL
     AND v_item.payroll_payment_id IS DISTINCT FROM p_payment_id THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_LINK_CONFLICT',
      'Batch item payroll_payment_id does not match payment'
    );
  END IF;

  IF v_payment.batch_item_id IS DISTINCT FROM p_item_id THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_IDENTITY_MISMATCH',
      'Payment batch_item_id does not match batch item'
    );
  END IF;

  IF v_payment.batch_id IS DISTINCT FROM v_item.batch_id
     OR v_payment.payroll_run_id IS DISTINCT FROM v_item.payroll_run_id
     OR v_payment.business_id IS DISTINCT FROM v_item.business_id THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_IDENTITY_MISMATCH',
      'Payment and batch item business/run/batch mismatch'
    );
  END IF;

  IF ROUND(COALESCE(v_payment.amount, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_item.amount, 0), 2) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_AMOUNT_MISMATCH',
      format(
        'Payment amount (%s) must exactly match batch item amount (%s)',
        ROUND(COALESCE(v_payment.amount, 0), 2),
        ROUND(COALESCE(v_item.amount, 0), 2)
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_verify_batch_item_payment_reciprocal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_verify_batch_item_payment_reciprocal(UUID, UUID) TO postgres;

CREATE OR REPLACE FUNCTION public.payroll_verify_batch_payment_integrity(p_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_sum NUMERIC := 0;
  v_payment_sum NUMERIC := 0;
  v_payable_sum NUMERIC := 0;
  v_paid_count INT := 0;
  v_all_paid BOOLEAN;
  v_item RECORD;
BEGIN
  SELECT COALESCE(SUM(ROUND(i.amount, 2)), 0), COUNT(*)
  INTO v_item_sum, v_paid_count
  FROM public.payroll_payment_batch_items i
  WHERE i.batch_id = p_batch_id
    AND i.deleted_at IS NULL
    AND i.status = 'paid';

  SELECT COALESCE(SUM(sub.amount), 0)
  INTO v_payment_sum
  FROM (
    SELECT DISTINCT ON (pp.id) ROUND(pp.amount, 2) AS amount
    FROM public.payroll_payment_batch_items i
    JOIN public.payroll_payments pp ON pp.id = i.payroll_payment_id
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status = 'paid'
      AND pp.deleted_at IS NULL
      AND pp.reversed_at IS NULL
      AND pp.journal_entry_id IS NOT NULL
    ORDER BY pp.id
  ) sub;

  IF v_paid_count > 0 AND v_item_sum IS DISTINCT FROM v_payment_sum THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED',
      format(
        'Paid batch item amounts (%s) do not reconcile to linked payment amounts (%s)',
        v_item_sum,
        v_payment_sum
      )
    );
  END IF;

  FOR v_item IN
    SELECT i.id, i.payroll_payment_id
    FROM public.payroll_payment_batch_items i
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status = 'paid'
  LOOP
    IF v_item.payroll_payment_id IS NULL THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED',
        'Paid batch item missing payroll_payment_id'
      );
    END IF;
    PERFORM public.payroll_verify_batch_item_payment_reciprocal(v_item.id, v_item.payroll_payment_id);
  END LOOP;

  SELECT COALESCE(bool_and(s = 'paid'), FALSE)
  INTO v_all_paid
  FROM (
    SELECT i.status AS s
    FROM public.payroll_payment_batch_items i
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('skipped', 'cancelled')
  ) q;

  IF v_all_paid THEN
    SELECT COALESCE(SUM(ROUND(i.amount, 2)), 0)
    INTO v_payable_sum
    FROM public.payroll_payment_batch_items i
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('skipped', 'cancelled');

    IF v_payable_sum IS DISTINCT FROM v_payment_sum THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED',
        format(
          'Fully paid batch payable total (%s) does not reconcile to payment total (%s)',
          v_payable_sum,
          v_payment_sum
        )
      );
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_verify_batch_payment_integrity(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_verify_batch_payment_integrity(UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- 5) Schema-drift-safe payroll_runs immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_run_mutation_allowed_columns(p_context TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_context
    WHEN 'approve' THEN ARRAY[
      'status', 'approved_at', 'approved_by', 'journal_entry_id', 'updated_at'
    ]
    WHEN 'lock' THEN ARRAY['status', 'updated_at']
    WHEN 'reverse' THEN ARRAY[
      'status', 'reversed_at', 'reversed_by', 'reversal_journal_id', 'reversal_reason', 'updated_at'
    ]
    WHEN 'correction_link' THEN ARRAY['corrected_by_run_id', 'updated_at']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_runs_enforce_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
  v_stripped_old JSONB;
  v_stripped_new JSONB;
  v_col TEXT;
  v_allowed TEXT[];
BEGIN
  IF TG_OP <> 'UPDATE' THEN
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
    v_stripped_old := v_old - 'notes' - 'updated_at';
    v_stripped_new := v_new - 'notes' - 'updated_at';
    IF v_stripped_old = v_stripped_new AND NEW.notes IS DISTINCT FROM OLD.notes THEN
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'approved' AND NEW.status = 'locked' AND v_ctx = 'lock' THEN
        NULL;
      ELSIF OLD.status IN ('approved', 'locked') AND NEW.status = 'reversed' AND v_ctx = 'reverse' THEN
        NULL;
      ELSIF OLD.status = 'reversed' AND NEW.status = 'reversed' AND v_ctx = 'correction_link'
            AND NEW.corrected_by_run_id IS DISTINCT FROM OLD.corrected_by_run_id THEN
        NULL;
      ELSIF OLD.status IN ('approved', 'locked') AND NEW.status = OLD.status AND v_ctx = 'approve' THEN
        NULL;
      ELSE
        PERFORM public.raise_payroll_payment_error(
          'PAYROLL_RUN_INVALID_STATUS_TRANSITION',
          format('Invalid payroll run status transition from %s to %s', OLD.status, NEW.status)
        );
      END IF;
    END IF;

    IF v_ctx IS NOT NULL AND v_ctx <> '' THEN
      v_allowed := public.payroll_run_mutation_allowed_columns(v_ctx);
      v_stripped_old := v_old;
      v_stripped_new := v_new;
      FOREACH v_col IN ARRAY v_allowed LOOP
        v_stripped_old := v_stripped_old - v_col;
        v_stripped_new := v_stripped_new - v_col;
      END LOOP;
      IF v_stripped_old = v_stripped_new THEN
        RETURN NEW;
      END IF;
    END IF;

    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_RUN_IMMUTABLE',
      format('Payroll run in status %s cannot be mutated outside controlled payroll RPCs', OLD.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Harden batch item paid trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payment_batch_items_enforce_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
  v_protected TEXT[] := ARRAY[
    'status', 'payroll_payment_id', 'paid_at', 'paid_by', 'amount',
    'business_id', 'payroll_run_id', 'batch_id', 'payroll_entry_id', 'staff_id'
  ];
  v_col TEXT;
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
  v_stripped_old JSONB;
  v_stripped_new JSONB;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid' THEN
    v_stripped_old := v_old - 'updated_at';
    v_stripped_new := v_new - 'updated_at';
    IF v_stripped_old IS DISTINCT FROM v_stripped_new THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'Paid batch items are immutable'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid' AND v_ctx IS DISTINCT FROM 'batch_item_payment' THEN
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

-- ---------------------------------------------------------------------------
-- 7) Batch status derivation + batch header guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_derive_batch_status_from_items(p_batch_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
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
    PERFORM public.payroll_verify_batch_payment_integrity(p_batch_id);
    RETURN 'paid';
  END IF;

  IF v_any_paid THEN
    PERFORM public.payroll_verify_batch_payment_integrity(p_batch_id);
    IF v_any_pending OR v_any_failed THEN
      RETURN 'partially_paid';
    END IF;
    RETURN 'partially_paid';
  END IF;

  IF v_any_failed AND NOT v_any_pending THEN
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

CREATE OR REPLACE FUNCTION public.payroll_payment_batches_enforce_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF public.finza_payroll_mutation_context() IS DISTINCT FROM 'batch_item_payment' THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED',
        'Batch status may only change via controlled batch-item settlement'
      );
    END IF;

    IF NEW.status IN ('paid', 'partially_paid') THEN
      PERFORM public.payroll_verify_batch_payment_integrity(NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_payment_batches_enforce_status ON public.payroll_payment_batches;
CREATE TRIGGER trg_payroll_payment_batches_enforce_status
  BEFORE UPDATE ON public.payroll_payment_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payment_batches_enforce_status();

-- ---------------------------------------------------------------------------
-- 8) Harden posted payroll_payments immutability (batch identity fields)
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
         OR NEW.idempotency_scope IS DISTINCT FROM OLD.idempotency_scope
         OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
         OR NEW.idempotency_key_sha256 IS DISTINCT FROM OLD.idempotency_key_sha256
         OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
         OR NEW.batch_item_id IS DISTINCT FROM OLD.batch_item_id
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

-- ---------------------------------------------------------------------------
-- 9) Drop legacy public RPC signatures (562 actor_id / batch on manual path)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_payroll_payment_atomic(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.record_payroll_batch_item_payment_atomic(
  UUID, UUID, UUID, UUID, DATE, UUID, TEXT, TEXT, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.lock_payroll_run_atomic(UUID, UUID, UUID);

-- ---------------------------------------------------------------------------
-- 10) Internal atomic payment recorder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._record_payroll_payment_atomic_impl(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_payment_date DATE,
  p_amount NUMERIC,
  p_payment_account_id UUID,
  p_reference TEXT,
  p_notes TEXT,
  p_batch_id UUID,
  p_batch_item_id UUID,
  p_idempotency_key TEXT,
  p_idempotency_scope TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_fingerprint TEXT;
  v_key_hash TEXT;
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

  v_key := public.payroll_validate_idempotency_key(p_idempotency_key);
  v_fingerprint := public.payroll_payment_request_fingerprint(
    p_business_id, p_payroll_run_id, p_payment_date, v_amount, p_payment_account_id,
    p_reference, p_batch_id, p_batch_item_id, p_idempotency_scope
  );
  v_key_hash := public.payroll_idempotency_key_sha256(v_key);

  IF p_actor_id IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_ACTOR_IDENTITY_MISMATCH',
      'Actor identity must match authenticated user'
    );
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
    AND pp.idempotency_key = v_key
    AND pp.deleted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id
       OR v_existing.payment_date IS DISTINCT FROM p_payment_date
       OR v_existing.amount IS DISTINCT FROM v_amount
       OR v_existing.payment_account_id IS DISTINCT FROM p_payment_account_id
       OR COALESCE(v_existing.reference, '') IS DISTINCT FROM COALESCE(public.payroll_normalize_payment_reference(p_reference), '')
       OR COALESCE(v_existing.batch_id::TEXT, '') IS DISTINCT FROM COALESCE(p_batch_id::TEXT, '')
       OR COALESCE(v_existing.batch_item_id::TEXT, '') IS DISTINCT FROM COALESCE(p_batch_item_id::TEXT, '')
       OR COALESCE(v_existing.idempotency_scope, '') IS DISTINCT FROM COALESCE(p_idempotency_scope, '')
       OR COALESCE(v_existing.request_fingerprint, '') IS DISTINCT FROM v_fingerprint THEN
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
      p_business_id, p_actor_id, v_audit_action, 'payroll_payment', v_existing.id,
      NULL,
      jsonb_build_object(
        'payroll_run_id', p_payroll_run_id,
        'journal_entry_id', v_existing.journal_entry_id,
        'amount', v_existing.amount,
        'batch_id', v_existing.batch_id,
        'batch_item_id', v_existing.batch_item_id,
        'idempotency_scope', v_existing.idempotency_scope,
        'request_fingerprint', v_existing.request_fingerprint,
        'idempotency_key_sha256', v_existing.idempotency_key_sha256
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

  IF p_batch_item_id IS NOT NULL THEN
    PERFORM 1
    FROM public.payroll_payments pp
    WHERE pp.batch_item_id = p_batch_item_id
      AND pp.deleted_at IS NULL
      AND pp.reversed_at IS NULL
    FOR UPDATE;

    IF EXISTS (
      SELECT 1 FROM public.payroll_payment_batch_items i
      WHERE i.id = p_batch_item_id
        AND i.deleted_at IS NULL
        AND i.payroll_payment_id IS NOT NULL
    ) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_BATCH_LINK_CONFLICT',
        'Batch item is already linked to a payroll payment'
      );
    END IF;
  END IF;

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

  IF p_batch_item_id IS NOT NULL AND p_batch_id IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'batch_id is required when batch_item_id is set');
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('payment_record');

  INSERT INTO public.payroll_payments (
    business_id, payroll_run_id, payment_date, amount, payment_account_id,
    reference, notes, batch_id, batch_item_id, created_by, idempotency_key,
    idempotency_scope, request_fingerprint, idempotency_key_sha256
  )
  VALUES (
    p_business_id, p_payroll_run_id, p_payment_date, v_amount, p_payment_account_id,
    public.payroll_normalize_payment_reference(p_reference),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    p_batch_id, p_batch_item_id, p_actor_id, v_key,
    p_idempotency_scope, v_fingerprint, v_key_hash
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
    public.payroll_normalize_payment_reference(p_reference),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    v_journal_id, p_actor_id, v_payment_id
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
    p_business_id, p_actor_id, v_audit_action, 'payroll_payment', v_payment_id,
    NULL,
    jsonb_build_object(
      'payroll_run_id', p_payroll_run_id,
      'journal_entry_id', v_journal_id,
      'obligation_id', v_obligation.id,
      'obligation_payment_id', v_obligation_payment_id,
      'amount', v_amount,
      'payment_date', p_payment_date,
      'payment_account_id', p_payment_account_id,
      'reference', public.payroll_normalize_payment_reference(p_reference),
      'batch_id', p_batch_id,
      'batch_item_id', p_batch_item_id,
      'idempotency_scope', p_idempotency_scope,
      'request_fingerprint', v_fingerprint,
      'idempotency_key_sha256', v_key_hash
    ),
    NULL, NULL,
    format('Payroll salary payment recorded for run %s', LEFT(p_payroll_run_id::TEXT, 8))
  );

  PERFORM public.finza_clear_payroll_mutation_context();

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

REVOKE ALL ON FUNCTION public._record_payroll_payment_atomic_impl(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_payroll_payment_atomic_impl(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT, UUID
) TO postgres;

-- ---------------------------------------------------------------------------
-- 11) Public RPCs (auth.uid() actor; no p_actor_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payroll_payment_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
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
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Authentication required');
  END IF;

  RETURN public._record_payroll_payment_atomic_impl(
    p_business_id,
    p_payroll_run_id,
    p_payment_date,
    p_amount,
    p_payment_account_id,
    p_reference,
    p_notes,
    NULL,
    NULL,
    p_idempotency_key,
    'manual_payroll_payment',
    v_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payroll_payment_atomic(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_payment_atomic(
  UUID, UUID, DATE, NUMERIC, UUID, TEXT, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_payroll_batch_item_payment_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_batch_id UUID,
  p_batch_item_id UUID,
  p_payment_date DATE,
  p_payment_account_id UUID,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item public.payroll_payment_batch_items%ROWTYPE;
  v_batch public.payroll_payment_batches%ROWTYPE;
  v_payment JSONB;
  v_payment_id UUID;
  v_new_batch_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Authentication required');
  END IF;

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

  PERFORM 1
  FROM public.payroll_payments pp
  WHERE pp.business_id = p_business_id
    AND pp.batch_id = p_batch_id
    AND pp.deleted_at IS NULL
  FOR UPDATE;

  IF v_item.status = 'paid' AND v_item.payroll_payment_id IS NOT NULL THEN
    PERFORM public.payroll_verify_batch_item_payment_reciprocal(v_item.id, v_item.payroll_payment_id);
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

  IF v_item.payroll_payment_id IS NOT NULL THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_BATCH_LINK_CONFLICT',
      'Batch item already references a payroll payment'
    );
  END IF;

  PERFORM 1
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id
    AND pr.deleted_at IS NULL
  FOR UPDATE;

  v_payment := public._record_payroll_payment_atomic_impl(
    p_business_id,
    p_payroll_run_id,
    p_payment_date,
    v_item.amount,
    p_payment_account_id,
    p_reference,
    p_notes,
    p_batch_id,
    p_batch_item_id,
    p_idempotency_key,
    'batch_item_payment',
    v_uid
  );

  v_payment_id := (v_payment->>'payment_id')::UUID;

  PERFORM public.payroll_verify_batch_item_payment_reciprocal(p_batch_item_id, v_payment_id);

  PERFORM public.finza_set_payroll_mutation_context('batch_item_payment');
  UPDATE public.payroll_payment_batch_items
  SET status = 'paid',
      payroll_payment_id = v_payment_id,
      paid_at = NOW(),
      paid_by = v_uid,
      payment_reference = public.payroll_normalize_payment_reference(p_reference),
      updated_at = NOW()
  WHERE id = p_batch_item_id;

  PERFORM public.payroll_verify_batch_item_payment_reciprocal(p_batch_item_id, v_payment_id);

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
      'reference', public.payroll_normalize_payment_reference(p_reference),
      'batch_status', v_new_batch_status,
      'idempotency_scope', 'batch_item_payment',
      'request_fingerprint', (
        SELECT request_fingerprint FROM public.payroll_payments WHERE id = v_payment_id
      ),
      'idempotency_key_sha256', (
        SELECT idempotency_key_sha256 FROM public.payroll_payments WHERE id = v_payment_id
      )
    ),
    NULL, NULL,
    'Batch item salary payment recorded atomically'
  );

  PERFORM public.finza_clear_payroll_mutation_context();

  RETURN v_payment || jsonb_build_object(
    'batch_item_id', p_batch_item_id,
    'batch_id', p_batch_id,
    'batch_status', v_new_batch_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payroll_batch_item_payment_atomic(
  UUID, UUID, UUID, UUID, DATE, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_batch_item_payment_atomic(
  UUID, UUID, UUID, UUID, DATE, UUID, TEXT, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.lock_payroll_run_atomic(
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

  PERFORM public.finza_clear_payroll_mutation_context();

  RETURN jsonb_build_object('reused', false, 'status', 'locked');
END;
$$;

REVOKE ALL ON FUNCTION public.lock_payroll_run_atomic(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_payroll_run_atomic(UUID, UUID) TO authenticated;
