-- Trusted server bootstrap for Hubtel/MoMo verify paths (service_role has no auth.uid()).
-- Same idempotent bootstrap as ensure_accounting_initialized without caller membership check.

CREATE OR REPLACE FUNCTION ensure_accounting_initialized_system(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE;
  v_period_exists BOOLEAN;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business_id is required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM create_system_accounts(p_business_id);
  PERFORM initialize_business_chart_of_accounts(p_business_id);

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE business_id = p_business_id
  ) INTO v_period_exists;

  IF NOT v_period_exists THEN
    SELECT COALESCE(
      (SELECT (b.start_date)::DATE FROM businesses b WHERE b.id = p_business_id),
      DATE_TRUNC('month', CURRENT_DATE)::DATE
    ) INTO v_start_date;

    PERFORM initialize_business_accounting_period(p_business_id, v_start_date);
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION ensure_accounting_initialized_system(UUID) IS
  'Idempotent accounting bootstrap for trusted server jobs (Hubtel invoice verify). No auth.uid() check. service_role only.';

REVOKE ALL ON FUNCTION ensure_accounting_initialized_system(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_accounting_initialized_system(UUID) TO service_role;

-- Hubtel: paid at provider but Finza could not post payment (accounting bootstrap failed).
ALTER TABLE public.payment_provider_transactions
  DROP CONSTRAINT IF EXISTS payment_provider_transactions_status_check;

ALTER TABLE public.payment_provider_transactions
  ADD CONSTRAINT payment_provider_transactions_status_check
  CHECK (status IN (
    'initiated',
    'pending',
    'requires_action',
    'pending_verification',
    'pending_accounting_setup',
    'successful',
    'failed',
    'cancelled'
  ));

COMMENT ON COLUMN public.payment_provider_transactions.status IS
  'Provider session lifecycle. pending_verification = Hubtel paid but status API unavailable. pending_accounting_setup = Hubtel paid but payment row could not post (accounting bootstrap).';
