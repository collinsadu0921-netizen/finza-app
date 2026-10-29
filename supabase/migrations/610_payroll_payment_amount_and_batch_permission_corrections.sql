-- ============================================================================
-- Migration 610: Payroll payment amount precision and batch permission fixes
-- ============================================================================
-- Corrects two Phase 1 review findings without rewriting migrations 608/609:
--
--   1. Batch item amounts must equal the approved payroll entry net salary
--      exactly to two decimal places. Values with unsupported fractional
--      pesewas are rejected, not rounded or tolerated.
--
--   2. payroll.export may read/export batches but may not update batch headers
--      or batch state. Batch header writes require payroll.pay. Export filename
--      recording moves to a restricted, audited SECURITY DEFINER RPC.
--
-- Does not change payroll calculations, rounding rules, approved/locked
-- snapshots, payment idempotency or salary expense accounting.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Store four decimals so invalid precision can be detected, never rounded
-- ----------------------------------------------------------------------------
ALTER TABLE public.payroll_payment_batch_items
  ALTER COLUMN amount TYPE NUMERIC(14, 4) USING amount::NUMERIC(14, 4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_payment_batch_items_amount_two_decimal_check'
      AND conrelid = 'public.payroll_payment_batch_items'::regclass
  ) THEN
    ALTER TABLE public.payroll_payment_batch_items
      ADD CONSTRAINT payroll_payment_batch_items_amount_two_decimal_check
      CHECK (amount = ROUND(amount, 2)) NOT VALID;
  END IF;
END;
$$;

COMMENT ON COLUMN public.payroll_payment_batch_items.amount IS
  'Frozen employee net salary instruction. Must match payroll_entries.net_salary exactly to two decimal places; four-decimal storage exists only to reject unsupported pesewa fractions.';

-- ----------------------------------------------------------------------------
-- 2) Exact instruction validation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payment_batch_items_enforce_instruction_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_status TEXT;
  v_batch_item_count INT;
  v_existing_count INT;
  v_entry_net NUMERIC;
  v_entry_staff UUID;
  v_entry_included BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.payroll_payment_id IS NOT NULL
       OR NEW.paid_at IS NOT NULL
       OR NEW.paid_by IS NOT NULL
       OR NEW.payment_reference IS NOT NULL
       OR NEW.provider_reference IS NOT NULL
       OR NEW.failure_reason IS NOT NULL
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED',
        'New batch items must be pending and must not reference a payment.'
      );
    END IF;

    IF NEW.amount IS NULL
       OR NEW.amount <= 0
       OR NEW.amount IS DISTINCT FROM ROUND(NEW.amount, 2)
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_AMOUNT_PRECISION_INVALID',
        'Batch item amount must be a positive amount with no fractional pesewas beyond two decimal places.'
      );
    END IF;

    SELECT b.status, b.item_count
    INTO v_batch_status, v_batch_item_count
    FROM public.payroll_payment_batches b
    WHERE b.id = NEW.batch_id
      AND b.business_id = NEW.business_id
      AND b.payroll_run_id = NEW.payroll_run_id
      AND b.deleted_at IS NULL;

    IF NOT FOUND OR v_batch_status NOT IN ('draft', 'ready') THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INSTRUCTION_IMMUTABLE',
        'Batch items can only be added while the batch is draft or ready.'
      );
    END IF;

    SELECT COUNT(*) INTO v_existing_count
    FROM public.payroll_payment_batch_items i
    WHERE i.batch_id = NEW.batch_id
      AND i.deleted_at IS NULL;

    IF v_batch_item_count <= 0 OR v_existing_count >= v_batch_item_count THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INSTRUCTION_IMMUTABLE',
        'This batch already contains its full set of payment instructions.'
      );
    END IF;

    SELECT pe.net_salary, pe.staff_id, pe.is_included
    INTO v_entry_net, v_entry_staff, v_entry_included
    FROM public.payroll_entries pe
    WHERE pe.id = NEW.payroll_entry_id
      AND pe.payroll_run_id = NEW.payroll_run_id;

    IF NOT FOUND
       OR v_entry_included IS FALSE
       OR v_entry_staff IS DISTINCT FROM NEW.staff_id
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_AMOUNT_MISMATCH',
        'Batch item does not match an included payroll entry for this staff member and run.'
      );
    END IF;

    IF NEW.amount IS DISTINCT FROM ROUND(COALESCE(v_entry_net, 0), 2) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_AMOUNT_MISMATCH',
        format(
          'Batch item amount (%s) must equal the approved payroll entry net salary (%s) exactly to two decimal places.',
          NEW.amount,
          ROUND(COALESCE(v_entry_net, 0), 2)
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE: identity, amount and destination snapshots are frozen for the
  -- life of the instruction. Corrections require cancelling and recreating an
  -- unpaid batch through the audited batch workflow.
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.payroll_entry_id IS DISTINCT FROM OLD.payroll_entry_id
     OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.employee_name IS DISTINCT FROM OLD.employee_name
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.destination_method_type IS DISTINCT FROM OLD.destination_method_type
     OR NEW.destination_provider_name IS DISTINCT FROM OLD.destination_provider_name
     OR NEW.destination_bank_name IS DISTINCT FROM OLD.destination_bank_name
     OR NEW.destination_bank_code IS DISTINCT FROM OLD.destination_bank_code
     OR NEW.destination_branch_name IS DISTINCT FROM OLD.destination_branch_name
     OR NEW.destination_account_number IS DISTINCT FROM OLD.destination_account_number
     OR NEW.destination_account_name IS DISTINCT FROM OLD.destination_account_name
     OR NEW.destination_momo_provider IS DISTINCT FROM OLD.destination_momo_provider
     OR NEW.destination_momo_number IS DISTINCT FROM OLD.destination_momo_number
     OR NEW.legacy_destination_source IS DISTINCT FROM OLD.legacy_destination_source
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INSTRUCTION_IMMUTABLE',
      'Batch item amount, employee identity and payout destination are frozen. Cancel and recreate an unpaid batch to correct them.'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3) Batch header updates require payroll.pay; export-only cannot edit state
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "payroll_payment_batches_update"
  ON public.payroll_payment_batches;

CREATE POLICY "payroll_payment_batches_update"
  ON public.payroll_payment_batches FOR UPDATE
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  )
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  );

-- ----------------------------------------------------------------------------
-- 4) Export filename recording without general batch-header edit authority
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payroll_payment_batch_export(
  p_business_id UUID,
  p_batch_id UUID,
  p_export_filename TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_filename TEXT := NULLIF(BTRIM(COALESCE(p_export_filename, '')), '');
  v_batch public.payroll_payment_batches%ROWTYPE;
  v_previous TEXT;
BEGIN
  IF v_uid IS NULL
     OR p_business_id IS NULL
     OR p_batch_id IS NULL
     OR v_filename IS NULL
     OR length(v_filename) > 255
     OR v_filename ~ '[\\/\x00]'
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_EXPORT_INVALID_INPUT',
      'A safe export filename of 1-255 characters is required.'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id)
     OR NOT (
       public.finza_user_has_permission(p_business_id, 'payroll.export')
       OR public.finza_user_has_permission(p_business_id, 'payroll.pay')
     )
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_EXPORT_PERMISSION_DENIED',
      'payroll.export or payroll.pay permission required'
    );
  END IF;

  SELECT * INTO v_batch
  FROM public.payroll_payment_batches b
  WHERE b.id = p_batch_id
    AND b.business_id = p_business_id
    AND b.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_EXPORT_NOT_FOUND',
      'Payment batch not found'
    );
  END IF;

  v_previous := v_batch.export_filename;

  IF v_previous IS DISTINCT FROM v_filename THEN
    UPDATE public.payroll_payment_batches
    SET export_filename = v_filename,
        updated_at = NOW()
    WHERE id = v_batch.id
      AND business_id = p_business_id;

    PERFORM public.create_audit_log(
      p_business_id,
      v_uid,
      'payroll.batch_exported',
      'payroll_payment_batch',
      v_batch.id,
      jsonb_build_object('export_filename', v_previous),
      jsonb_build_object('export_filename', v_filename),
      NULL,
      NULL,
      format('Payment batch %s export prepared', LEFT(v_batch.id::TEXT, 8))
    );
  END IF;

  RETURN jsonb_build_object(
    'reused', v_previous IS NOT DISTINCT FROM v_filename,
    'batch_id', v_batch.id,
    'export_filename', v_filename
  );
END;
$$;

COMMENT ON FUNCTION public.record_payroll_payment_batch_export(UUID, UUID, TEXT) IS
  'Records a payment batch export filename. Requires payroll.export or payroll.pay and cannot change batch state or payment instructions.';

REVOKE ALL ON FUNCTION public.record_payroll_payment_batch_export(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_payment_batch_export(UUID, UUID, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
