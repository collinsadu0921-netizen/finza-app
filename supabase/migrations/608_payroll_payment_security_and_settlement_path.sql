-- ============================================================================
-- Migration 608: Payroll payment security and settlement-path hardening
-- ============================================================================
-- Scope:
--   1. Make post_payroll_to_ledger internal-only (approval RPC remains the
--      authorised caller).
--   2. Tighten RLS on payment batches, batch items and staff payout methods.
--   3. Freeze batch instructions (amounts, identities, destinations) and
--      validate direct inserts against payroll entries.
--   4. Prevent aggregate run-level payments and employee-level batch payments
--      from overlapping on the same payroll run.
--
-- Does not change payroll calculations, approval accounting, journal lines,
-- salary expense, or the existing payment idempotency/reciprocal checks.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Payroll journal posting is internal to the approved approval RPC
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.post_payroll_to_ledger(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_payroll_to_ledger(UUID) TO postgres;

COMMENT ON FUNCTION public.post_payroll_to_ledger(UUID) IS
  'Internal payroll journal posting. Callable only by trusted database roles; authenticated users must use approve_payroll_run_atomic.';

-- ----------------------------------------------------------------------------
-- 2) RLS: payment batches and batch items
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage payroll_payment_batches for their business"
  ON public.payroll_payment_batches;
DROP POLICY IF EXISTS "Users can manage payroll_payment_batch_items for their business"
  ON public.payroll_payment_batch_items;

CREATE POLICY "payroll_payment_batches_select"
  ON public.payroll_payment_batches FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND (
      public.finza_user_has_permission(business_id, 'payroll.view')
      OR public.finza_user_has_permission(business_id, 'payroll.pay')
      OR public.finza_user_has_permission(business_id, 'payroll.export')
    )
  );

CREATE POLICY "payroll_payment_batches_insert"
  ON public.payroll_payment_batches FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  );

CREATE POLICY "payroll_payment_batches_update"
  ON public.payroll_payment_batches FOR UPDATE
  USING (
    public.finza_user_can_access_business(business_id)
    AND (
      public.finza_user_has_permission(business_id, 'payroll.pay')
      OR public.finza_user_has_permission(business_id, 'payroll.export')
    )
  )
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND (
      public.finza_user_has_permission(business_id, 'payroll.pay')
      OR public.finza_user_has_permission(business_id, 'payroll.export')
    )
  );

CREATE POLICY "payroll_payment_batches_delete"
  ON public.payroll_payment_batches FOR DELETE
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  );

CREATE POLICY "payroll_payment_batch_items_select"
  ON public.payroll_payment_batch_items FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND (
      public.finza_user_has_permission(business_id, 'payroll.view')
      OR public.finza_user_has_permission(business_id, 'payroll.pay')
      OR public.finza_user_has_permission(business_id, 'payroll.export')
    )
  );

CREATE POLICY "payroll_payment_batch_items_insert"
  ON public.payroll_payment_batch_items FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  );

CREATE POLICY "payroll_payment_batch_items_update"
  ON public.payroll_payment_batch_items FOR UPDATE
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  )
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  );

CREATE POLICY "payroll_payment_batch_items_delete"
  ON public.payroll_payment_batch_items FOR DELETE
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.pay')
  );

-- ----------------------------------------------------------------------------
-- 3) RLS: employee payout methods
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage staff_payment_methods for their business staff"
  ON public.staff_payment_methods;

CREATE POLICY "staff_payment_methods_select"
  ON public.staff_payment_methods FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
    AND (
      public.finza_user_has_permission(business_id, 'payroll.view')
      OR public.finza_user_has_permission(business_id, 'payroll.pay')
      OR public.finza_user_has_permission(business_id, 'payroll.export')
      OR public.finza_user_has_permission(business_id, 'staff.manage')
    )
  );

CREATE POLICY "staff_payment_methods_insert"
  ON public.staff_payment_methods FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
    AND public.finza_user_has_permission(business_id, 'staff.manage')
  );

CREATE POLICY "staff_payment_methods_update"
  ON public.staff_payment_methods FOR UPDATE
  USING (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
    AND public.finza_user_has_permission(business_id, 'staff.manage')
  )
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
    AND public.finza_user_has_permission(business_id, 'staff.manage')
  );

CREATE POLICY "staff_payment_methods_delete"
  ON public.staff_payment_methods FOR DELETE
  USING (
    public.finza_user_can_access_business(business_id)
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_payment_methods.staff_id
        AND s.business_id = staff_payment_methods.business_id
    )
    AND public.finza_user_has_permission(business_id, 'staff.manage')
  );

-- ----------------------------------------------------------------------------
-- 4) Settlement-path helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_run_has_unallocated_aggregate_payments(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_payments pp
    WHERE pp.business_id = p_business_id
      AND pp.payroll_run_id = p_payroll_run_id
      AND pp.deleted_at IS NULL
      AND pp.journal_entry_id IS NOT NULL
      AND pp.reversed_at IS NULL
      AND pp.batch_item_id IS NULL
      AND pp.batch_id IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.payroll_run_has_active_batch(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_payment_batches b
    WHERE b.business_id = p_business_id
      AND b.payroll_run_id = p_payroll_run_id
      AND b.deleted_at IS NULL
      AND b.status <> 'cancelled'
  );
$$;

CREATE OR REPLACE FUNCTION public.payroll_run_has_posted_batch_item_payments(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_payments pp
    WHERE pp.business_id = p_business_id
      AND pp.payroll_run_id = p_payroll_run_id
      AND pp.deleted_at IS NULL
      AND pp.journal_entry_id IS NOT NULL
      AND pp.reversed_at IS NULL
      AND pp.batch_item_id IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.payroll_run_has_unallocated_aggregate_payments(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_run_has_active_batch(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_run_has_posted_batch_item_payments(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payroll_run_has_unallocated_aggregate_payments(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_run_has_active_batch(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_run_has_posted_batch_item_payments(UUID, UUID) TO postgres;

-- ----------------------------------------------------------------------------
-- 5) Prevent aggregate and employee-level settlement on the same run
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payments_enforce_settlement_path()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_batch BOOLEAN;
BEGIN
  IF NEW.batch_item_id IS NULL AND NEW.batch_id IS NULL THEN
    IF public.payroll_run_has_active_batch(NEW.business_id, NEW.payroll_run_id)
       OR public.payroll_run_has_posted_batch_item_payments(NEW.business_id, NEW.payroll_run_id)
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_BATCH_SETTLEMENT_ACTIVE',
        'This payroll run is being settled through employee payment batches. Use per-employee batch payments, or cancel the unpaid batch before recording an aggregate payment.'
      );
    END IF;
  ELSIF NEW.batch_item_id IS NOT NULL THEN
    IF public.payroll_run_has_unallocated_aggregate_payments(NEW.business_id, NEW.payroll_run_id) THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_PAYMENT_AGGREGATE_RECONCILIATION_REQUIRED',
        'This payroll run has aggregate salary payments that are not allocated to employees. Reverse those aggregate payments before settling employees individually.'
      );
    END IF;
  ELSE
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_INVALID_INPUT',
      'A batch item id is required when recording a batch payment.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_payments_enforce_settlement_path ON public.payroll_payments;
CREATE TRIGGER trg_payroll_payments_enforce_settlement_path
  BEFORE INSERT ON public.payroll_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payments_enforce_settlement_path();

-- ----------------------------------------------------------------------------
-- 6) Batch header insertion and instruction immutability
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_payment_batches_enforce_instruction_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_status TEXT;
BEGIN
  IF NEW.status NOT IN ('draft', 'ready') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INVALID_STATUS_TRANSITION',
      format('Payment batches must be created as draft or ready (received %s)', NEW.status)
    );
  END IF;

  IF NEW.item_count < 0 OR NEW.total_amount_snapshot < 0 THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INVALID_INPUT',
      'Batch item count and total amount cannot be negative.'
    );
  END IF;

  SELECT pr.status INTO v_run_status
  FROM public.payroll_runs pr
  WHERE pr.id = NEW.payroll_run_id
    AND pr.business_id = NEW.business_id
    AND pr.deleted_at IS NULL;

  IF NOT FOUND OR v_run_status NOT IN ('approved', 'locked') THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_RUN_NOT_PAYABLE',
      'Payment batches can only be created for approved or locked payroll runs.'
    );
  END IF;

  IF public.payroll_run_has_unallocated_aggregate_payments(NEW.business_id, NEW.payroll_run_id) THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_PAYMENT_AGGREGATE_RECONCILIATION_REQUIRED',
      'This payroll run has aggregate salary payments that are not allocated to employees. Reverse those aggregate payments before creating an employee payment batch.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_payment_batches_enforce_instruction_insert
  ON public.payroll_payment_batches;
CREATE TRIGGER trg_payroll_payment_batches_enforce_instruction_insert
  BEFORE INSERT ON public.payroll_payment_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payment_batches_enforce_instruction_insert();

CREATE OR REPLACE FUNCTION public.payroll_payment_batches_enforce_instruction_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.payroll_run_id IS DISTINCT FROM OLD.payroll_run_id
     OR NEW.total_amount_snapshot IS DISTINCT FROM OLD.total_amount_snapshot
     OR NEW.item_count IS DISTINCT FROM OLD.item_count
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.payroll_payment_id IS DISTINCT FROM OLD.payroll_payment_id
  THEN
    PERFORM public.raise_payroll_payment_error(
      'PAYROLL_BATCH_INSTRUCTION_IMMUTABLE',
      'Payment batch amount, scope, currency and payment link are immutable after creation.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_payment_batches_enforce_instruction_immutability
  ON public.payroll_payment_batches;
CREATE TRIGGER trg_payroll_payment_batches_enforce_instruction_immutability
  BEFORE UPDATE ON public.payroll_payment_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payment_batches_enforce_instruction_immutability();

-- ----------------------------------------------------------------------------
-- 7) Batch item insertion validation and instruction immutability
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

    IF NEW.amount <= 0
       OR ABS(ROUND(COALESCE(NEW.amount, 0), 2) - ROUND(COALESCE(v_entry_net, 0), 2)) > 0.01
    THEN
      PERFORM public.raise_payroll_payment_error(
        'PAYROLL_BATCH_AMOUNT_MISMATCH',
        'Batch item amount must equal the approved payroll entry net salary.'
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

DROP TRIGGER IF EXISTS trg_payroll_payment_batch_items_enforce_instruction_integrity
  ON public.payroll_payment_batch_items;
CREATE TRIGGER trg_payroll_payment_batch_items_enforce_instruction_integrity
  BEFORE INSERT OR UPDATE ON public.payroll_payment_batch_items
  FOR EACH ROW
  EXECUTE FUNCTION public.payroll_payment_batch_items_enforce_instruction_integrity();

COMMENT ON FUNCTION public.payroll_payment_batch_items_enforce_instruction_integrity() IS
  'Validates new batch items against payroll entries and freezes amounts, identities and destinations. Corrections use the audited cancel/recreate batch workflow.';

NOTIFY pgrst, 'reload schema';
