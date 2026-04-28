-- ============================================================================
-- Payroll Phase 2A: Run-level salary payment/disbursement
-- - Adds payroll_payments table
-- - Adds post_payroll_payment_to_ledger(p_payroll_payment_id)
-- - Posts only salary disbursement:
--     Dr 2240 Net Salaries Payable
--     Cr selected asset payment account (cash/bank/momo)
-- - Does NOT settle PAYE/SSNIT/deductions liabilities
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_account_id UUID NOT NULL REFERENCES public.accounts(id),
  reference TEXT,
  notes TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_business_id
  ON public.payroll_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_payroll_run_id
  ON public.payroll_payments(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_journal_entry_id
  ON public.payroll_payments(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_payment_date
  ON public.payroll_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_deleted_at
  ON public.payroll_payments(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payroll payments for their business" ON public.payroll_payments;
CREATE POLICY "Users can view payroll payments for their business"
  ON public.payroll_payments FOR SELECT
  USING (public.finza_user_can_access_business(payroll_payments.business_id));

DROP POLICY IF EXISTS "Users can insert payroll payments for their business" ON public.payroll_payments;
CREATE POLICY "Users can insert payroll payments for their business"
  ON public.payroll_payments FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(payroll_payments.business_id));

DROP POLICY IF EXISTS "Users can update payroll payments for their business" ON public.payroll_payments;
CREATE POLICY "Users can update payroll payments for their business"
  ON public.payroll_payments FOR UPDATE
  USING (public.finza_user_can_access_business(payroll_payments.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_payments.business_id));

DROP POLICY IF EXISTS "Users can delete payroll payments for their business" ON public.payroll_payments;
CREATE POLICY "Users can delete payroll payments for their business"
  ON public.payroll_payments FOR DELETE
  USING (public.finza_user_can_access_business(payroll_payments.business_id));

DROP TRIGGER IF EXISTS update_payroll_payments_updated_at ON public.payroll_payments;
CREATE TRIGGER update_payroll_payments_updated_at
  BEFORE UPDATE ON public.payroll_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.post_payroll_payment_to_ledger(p_payroll_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  v_payment RECORD;
  v_payroll_run RECORD;
  v_business_id UUID;
  v_net_salaries_payable_account_id UUID;
  v_journal_entry_id UUID;
  v_existing_journal_id UUID;
  v_total_paid NUMERIC(14,2);
  v_tolerance NUMERIC := 0.01;
BEGIN
  SELECT
    pp.id,
    pp.business_id,
    pp.payroll_run_id,
    pp.payment_date,
    pp.amount,
    pp.payment_account_id,
    pp.journal_entry_id,
    pp.deleted_at
  INTO v_payment
  FROM public.payroll_payments pp
  WHERE pp.id = p_payroll_payment_id;

  IF NOT FOUND OR v_payment.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll payment not found: %', p_payroll_payment_id;
  END IF;

  v_business_id := v_payment.business_id;

  IF NOT public.finza_user_can_access_business(v_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post payroll payment for this business';
  END IF;

  -- Serialize concurrent posting attempts for exactly-once behavior
  PERFORM pg_advisory_xact_lock(
    hashtext(v_business_id::TEXT),
    hashtext(p_payroll_payment_id::TEXT)
  );

  IF v_payment.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll payment % is already posted', p_payroll_payment_id;
  END IF;

  SELECT je.id
  INTO v_existing_journal_id
  FROM public.journal_entries je
  WHERE je.reference_type = 'payroll_payment'
    AND je.reference_id = p_payroll_payment_id
  LIMIT 1;

  IF v_existing_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll payment % already has a payroll_payment journal entry', p_payroll_payment_id;
  END IF;

  SELECT
    pr.id,
    pr.business_id,
    pr.status,
    pr.total_net_salary,
    pr.payroll_month
  INTO v_payroll_run
  FROM public.payroll_runs pr
  WHERE pr.id = v_payment.payroll_run_id
    AND pr.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found for payment %', p_payroll_payment_id;
  END IF;

  IF v_payroll_run.business_id <> v_business_id THEN
    RAISE EXCEPTION 'Payroll payment and payroll run business mismatch';
  END IF;

  IF v_payroll_run.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot record salary payment for draft payroll run %', v_payroll_run.id;
  END IF;

  IF v_payroll_run.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'Payroll run % status % is not payable', v_payroll_run.id, v_payroll_run.status;
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_business_id, v_payment.payment_date);

  -- Validate selected payment account is an active asset cash/bank/momo account
  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = v_payment.payment_account_id
      AND a.business_id = v_business_id
      AND a.deleted_at IS NULL
      AND a.type = 'asset'
      AND (
        COALESCE(LOWER(a.sub_type), '') IN ('cash', 'bank', 'momo', 'mobile_money')
        OR a.code IN ('1000', '1010', '1020')
      )
  ) THEN
    RAISE EXCEPTION 'Selected payment account is invalid. Must be an active cash/bank/momo asset account for this business.';
  END IF;

  SELECT a.id
  INTO v_net_salaries_payable_account_id
  FROM public.accounts a
  WHERE a.business_id = v_business_id
    AND a.code = '2240'
    AND a.type = 'liability'
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF v_net_salaries_payable_account_id IS NULL THEN
    RAISE EXCEPTION 'Net Salaries Payable account (2240) not found for business %', v_business_id;
  END IF;

  SELECT COALESCE(SUM(pp.amount), 0)
  INTO v_total_paid
  FROM public.payroll_payments pp
  WHERE pp.payroll_run_id = v_payment.payroll_run_id
    AND pp.deleted_at IS NULL;

  IF v_total_paid - COALESCE(v_payroll_run.total_net_salary, 0) > v_tolerance THEN
    RAISE EXCEPTION
      'Payroll payment exceeds run net salary. total_paid=%, run_total_net=%',
      v_total_paid, COALESCE(v_payroll_run.total_net_salary, 0);
  END IF;

  INSERT INTO public.journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    posting_source
  )
  VALUES (
    v_business_id,
    v_payment.payment_date,
    'Payroll salary payment - ' || TO_CHAR(v_payroll_run.payroll_month, 'Mon YYYY'),
    'payroll_payment',
    p_payroll_payment_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  -- Single statement keeps balance enforcement happy
  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  VALUES
    (
      v_journal_entry_id,
      v_net_salaries_payable_account_id,
      v_payment.amount,
      0,
      'Payroll salary disbursement (clear net salaries payable)'
    ),
    (
      v_journal_entry_id,
      v_payment.payment_account_id,
      0,
      v_payment.amount,
      'Payroll salary disbursement (payment account)'
    );

  UPDATE public.payroll_payments
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_payroll_payment_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.post_payroll_payment_to_ledger(UUID) IS
'Posts payroll salary disbursement only: Dr 2240 Net Salaries Payable, Cr selected cash/bank/momo asset account. Requires approved/locked run and open accounting period. Does not settle PAYE/SSNIT/deductions liabilities.';

REVOKE ALL ON FUNCTION public.post_payroll_payment_to_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_payment_to_ledger(UUID) TO authenticated;
