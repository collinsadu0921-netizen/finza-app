-- ============================================================================
-- Migration 614: Refresh unpaid batch destinations from current defaults
-- ============================================================================
-- Batch destinations were frozen forever. Businesses can now add or correct an
-- employee default payment method after approval and have unpaid instructions
-- refreshed without a new payroll run. Employee identity, approved amounts and
-- active/successful transfers remain immutable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_payment_batch_items_enforce_instruction_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx TEXT := public.finza_payroll_mutation_context();
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

  IF v_ctx = 'batch_destination_refresh' THEN
    IF NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
       OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
       OR NEW.payroll_entry_id IS DISTINCT FROM OLD.payroll_entry_id
       OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
       OR NEW.employee_name IS DISTINCT FROM OLD.employee_name
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INSTRUCTION_IMMUTABLE',
        'Destination refresh cannot change employee identity or the approved amount.'
      );
    END IF;

    IF NEW.status NOT IN ('pending', 'failed')
       OR NEW.payroll_payment_id IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.payroll_paystack_transfers t
         WHERE t.batch_item_id = NEW.id
           AND t.status IN ('initiating', 'awaiting_authorization', 'pending', 'successful', 'requires_attention')
       )
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_INSTRUCTION_IMMUTABLE',
        'Destination refresh is only allowed for unpaid items without an active or successful transfer.'
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
-- Controlled destination refresh RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_payroll_batch_item_destinations_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item public.payroll_payment_batch_items%ROWTYPE;
  v_method public.staff_payment_methods%ROWTYPE;
  v_updated INT := 0;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.pay')
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_REVERSAL_PERMISSION_DENIED',
      'payroll.pay permission required'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payroll_payment_batches b
    WHERE b.id = p_batch_id
      AND b.business_id = p_business_id
      AND b.payroll_run_id = p_payroll_run_id
      AND b.deleted_at IS NULL
      AND b.status <> 'cancelled'
  ) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_NOT_FOUND',
      'Payment batch not found'
    );
  END IF;

  PERFORM public.finza_set_payroll_mutation_context('batch_destination_refresh');

  FOR v_item IN
    SELECT i.* FROM public.payroll_payment_batch_items i
    WHERE i.business_id = p_business_id
      AND i.payroll_run_id = p_payroll_run_id
      AND i.batch_id = p_batch_id
      AND i.deleted_at IS NULL
      AND i.status IN ('pending', 'failed')
      AND i.payroll_payment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payroll_paystack_transfers t
        WHERE t.batch_item_id = i.id
          AND t.status IN ('initiating', 'awaiting_authorization', 'pending', 'successful', 'requires_attention')
      )
    FOR UPDATE
  LOOP
    SELECT m.* INTO v_method
    FROM public.staff_payment_methods m
    WHERE m.business_id = p_business_id
      AND m.staff_id = v_item.staff_id
      AND m.is_default = TRUE
      AND m.deleted_at IS NULL
    ORDER BY m.updated_at DESC
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.payroll_payment_batch_items
      SET staff_payment_method_id = v_method.id,
          destination_method_type = LOWER(NULLIF(TRIM(v_method.method_type), '')),
          destination_provider_name = v_method.provider_name,
          destination_bank_name = v_method.bank_name,
          destination_bank_code = v_method.bank_code,
          destination_branch_name = v_method.branch_name,
          destination_account_number = v_method.account_number,
          destination_account_name = v_method.account_name,
          destination_momo_provider = v_method.momo_provider,
          destination_momo_number = v_method.momo_number,
          legacy_destination_source = 'staff_payment_method',
          updated_at = NOW()
      WHERE id = v_item.id
        AND business_id = p_business_id
        AND payroll_run_id = p_payroll_run_id
        AND batch_id = p_batch_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  PERFORM public.finza_clear_payroll_mutation_context();

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

COMMENT ON FUNCTION public.refresh_payroll_batch_item_destinations_atomic(UUID, UUID, UUID) IS
  'Refreshes unpaid batch payment destinations from current employee default methods. Does not change amounts, statuses, paid items or active/successful transfers.';

REVOKE ALL ON FUNCTION public.refresh_payroll_batch_item_destinations_atomic(UUID, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_payroll_batch_item_destinations_atomic(UUID, UUID, UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
