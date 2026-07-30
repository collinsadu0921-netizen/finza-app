-- ============================================================================
-- Migration 564: Payroll payment UI and batch workflow integration
-- Controlled batch/item status RPCs for UI workflows. Does NOT edit 552–563.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_batch_item_destination_complete(p_item public.payroll_payment_batch_items)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(LOWER(p_item.destination_method_type), '')
    WHEN 'cash' THEN TRUE
    WHEN 'bank' THEN
      NULLIF(TRIM(COALESCE(p_item.destination_bank_name, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(p_item.destination_account_number, '')), '') IS NOT NULL
    WHEN 'momo' THEN
      NULLIF(TRIM(COALESCE(p_item.destination_momo_provider, '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(p_item.destination_momo_number, '')), '') IS NOT NULL
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION public.payroll_batch_item_destination_complete(public.payroll_payment_batch_items)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_batch_item_destination_complete(public.payroll_payment_batch_items) TO postgres;

CREATE OR REPLACE FUNCTION public.payroll_batch_has_posted_item_payments(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_payment_batch_items i
    JOIN public.payroll_payments pp ON pp.id = i.payroll_payment_id
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status = 'paid'
      AND pp.deleted_at IS NULL
      AND pp.reversed_at IS NULL
      AND pp.journal_entry_id IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.payroll_batch_has_posted_item_payments(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_batch_has_posted_item_payments(UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- 2) Batch status transition RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_payroll_payment_batch_status_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_batch_id UUID,
  p_next_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_batch public.payroll_payment_batches%ROWTYPE;
  v_next TEXT := NULLIF(TRIM(COALESCE(p_next_status, '')), '');
  v_item_sum NUMERIC := 0;
  v_active_count INT := 0;
  v_all_complete BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Authentication required');
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Not authorized for this business');
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'payroll.pay') THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'payroll.pay permission required');
  END IF;

  IF v_next IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'next_status is required');
  END IF;

  IF v_next IN ('paid', 'partially_paid', 'failed') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
      format('Batch status %s must be derived from item payments', v_next)
    );
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

  PERFORM 1
  FROM public.payroll_payment_batch_items i
  WHERE i.batch_id = p_batch_id
    AND i.deleted_at IS NULL
  FOR UPDATE;

  IF v_next = v_batch.status THEN
    RETURN jsonb_build_object('reused', true, 'batch_id', p_batch_id, 'status', v_batch.status);
  END IF;

  IF v_batch.status IN ('paid', 'cancelled') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
      format('Batch status %s cannot be changed', v_batch.status)
    );
  END IF;

  IF v_next = 'cancelled' THEN
    IF public.payroll_batch_has_posted_item_payments(p_batch_id) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_HAS_POSTED_PAYMENTS',
        'Cannot cancel a batch with recorded item payments'
      );
    END IF;
    IF v_batch.status NOT IN ('draft', 'ready', 'processing', 'failed', 'pending_authorization') THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Cannot cancel batch from status %s', v_batch.status)
      );
    END IF;
  ELSIF v_next = 'ready' THEN
    IF v_batch.status <> 'draft' THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Cannot mark batch ready from status %s', v_batch.status)
      );
    END IF;
    SELECT COUNT(*), COALESCE(SUM(ROUND(i.amount, 2)), 0)
    INTO v_active_count, v_item_sum
    FROM public.payroll_payment_batch_items i
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('skipped', 'cancelled');

    IF v_active_count = 0 THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        'Batch must have at least one active item to mark ready'
      );
    END IF;

    IF ABS(v_item_sum - ROUND(COALESCE(v_batch.total_amount_snapshot, 0), 2)) > 0.01 THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_TOTAL_MISMATCH',
        format('Item totals (%s) do not match batch snapshot (%s)', v_item_sum, v_batch.total_amount_snapshot)
      );
    END IF;

    SELECT bool_and(public.payroll_batch_item_destination_complete(i))
    INTO v_all_complete
    FROM public.payroll_payment_batch_items i
    WHERE i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status NOT IN ('skipped', 'cancelled');

    IF NOT COALESCE(v_all_complete, FALSE) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_DESTINATION_INCOMPLETE',
        'All active batch items must have complete payout destinations before marking ready'
      );
    END IF;
  ELSIF v_next = 'draft' THEN
    IF v_batch.status <> 'ready' THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Cannot return batch to draft from status %s', v_batch.status)
      );
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.payroll_payment_batch_items i
      WHERE i.batch_id = p_batch_id AND i.deleted_at IS NULL AND i.status = 'paid'
    ) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_HAS_POSTED_PAYMENTS',
        'Cannot return batch to draft after item payments were recorded'
      );
    END IF;
  ELSIF v_next = 'processing' THEN
    IF v_batch.status <> 'ready' THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
        format('Cannot start processing from status %s', v_batch.status)
      );
    END IF;
  ELSE
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
      format('Unsupported batch status transition: %s → %s', v_batch.status, v_next)
    );
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('batch_status_transition');
  UPDATE public.payroll_payment_batches
  SET status = v_next,
      updated_at = NOW()
  WHERE id = p_batch_id;

  PERFORM public.finza_clear_payroll_mutation_context();

  PERFORM public.create_audit_log(
    p_business_id, v_uid, 'payroll.batch_status_transition', 'payroll_payment_batch', p_batch_id,
    jsonb_build_object('status', v_batch.status),
    jsonb_build_object('status', v_next),
    NULL, NULL,
    format('Payroll payment batch status %s → %s', v_batch.status, v_next)
  );

  RETURN jsonb_build_object(
    'reused', false,
    'batch_id', p_batch_id,
    'status', v_next,
    'previous_status', v_batch.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_payroll_payment_batch_status_atomic(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_payroll_payment_batch_status_atomic(UUID, UUID, UUID, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Batch item status transition RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_payroll_payment_batch_item_status_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_batch_id UUID,
  p_batch_item_id UUID,
  p_next_status TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_batch public.payroll_payment_batches%ROWTYPE;
  v_item public.payroll_payment_batch_items%ROWTYPE;
  v_next TEXT := NULLIF(TRIM(COALESCE(p_next_status, '')), '');
  v_new_batch_status TEXT;
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Authentication required');
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'Not authorized for this business');
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'payroll.pay') THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_PERMISSION_DENIED', 'payroll.pay permission required');
  END IF;

  IF v_next IS NULL THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'next_status is required');
  END IF;

  IF v_next = 'paid' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
      'Use record_payroll_batch_item_payment_atomic to record item payment'
    );
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
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Cannot update items on a cancelled batch');
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

  IF v_item.status = 'paid' THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_ITEM_INVALID_STATUS_TRANSITION',
      'Paid batch items are immutable'
    );
  END IF;

  IF v_batch.status = 'paid' THEN
    PERFORM public.raise_payroll_payment_error('PAYROLL_PAYMENT_INVALID_INPUT', 'Cannot update items on a completed batch');
  END IF;

  IF v_next = v_item.status THEN
    RETURN jsonb_build_object(
      'reused', true,
      'batch_item_id', p_batch_item_id,
      'item_status', v_item.status,
      'batch_status', v_batch.status
    );
  END IF;

  v_allowed := CASE
    WHEN v_item.status = 'pending' AND v_next IN ('failed', 'skipped', 'cancelled') THEN TRUE
    WHEN v_item.status = 'failed' AND v_next IN ('pending', 'skipped', 'cancelled') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_ITEM_INVALID_STATUS_TRANSITION',
      format('Invalid batch item status transition: %s → %s', v_item.status, v_next)
    );
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('batch_item_status');
  UPDATE public.payroll_payment_batch_items
  SET status = v_next,
      failure_reason = CASE
        WHEN v_next = 'failed' THEN NULLIF(TRIM(COALESCE(p_failure_reason, '')), '')
        WHEN v_next IN ('pending', 'skipped', 'cancelled') THEN NULL
        ELSE failure_reason
      END,
      updated_at = NOW()
  WHERE id = p_batch_item_id;

  v_new_batch_status := public.payroll_derive_batch_status_from_items(p_batch_id);

  UPDATE public.payroll_payment_batches
  SET status = v_new_batch_status,
      updated_at = NOW()
  WHERE id = p_batch_id;

  PERFORM public.finza_clear_payroll_mutation_context();

  PERFORM public.create_audit_log(
    p_business_id, v_uid, 'payroll.batch_item_status_transition', 'payroll_payment_batch_item', p_batch_item_id,
    jsonb_build_object('status', v_item.status, 'batch_status', v_batch.status),
    jsonb_build_object('status', v_next, 'batch_status', v_new_batch_status, 'failure_reason', NULLIF(TRIM(COALESCE(p_failure_reason, '')), '')),
    NULL, NULL,
    format('Batch item status %s → %s', v_item.status, v_next)
  );

  RETURN jsonb_build_object(
    'reused', false,
    'batch_item_id', p_batch_item_id,
    'item_status', v_next,
    'batch_id', p_batch_id,
    'batch_status', v_new_batch_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_payroll_payment_batch_item_status_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_payroll_payment_batch_item_status_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Harden batch header status trigger (564 contexts)
-- ---------------------------------------------------------------------------
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

    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_PAYMENT_RECONCILIATION_FAILED',
      'Batch status may only change via controlled payroll batch workflows'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Harden batch item status trigger (require controlled context)
-- ---------------------------------------------------------------------------
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
  ) AND v_ctx NOT IN ('batch_item_payment', 'batch_item_status') THEN
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

-- ---------------------------------------------------------------------------
-- 6) Batch status derivation — preserve in-progress when items are mixed failed/pending
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
    RETURN 'partially_paid';
  END IF;

  IF v_any_failed AND NOT v_any_pending THEN
    RETURN 'failed';
  END IF;

  IF v_any_failed AND v_any_pending THEN
    RETURN 'processing';
  END IF;

  SELECT bool_and(public.payroll_batch_item_destination_complete(i))
  INTO v_all_complete
  FROM public.payroll_payment_batch_items i
  WHERE i.batch_id = p_batch_id AND i.deleted_at IS NULL;

  IF COALESCE(v_all_complete, FALSE) THEN
    RETURN 'ready';
  END IF;

  RETURN 'draft';
END;
$$;
