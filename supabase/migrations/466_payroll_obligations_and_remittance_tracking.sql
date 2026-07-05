-- Phase 1B-B/E: Payroll obligations and remittance tracking.

CREATE TABLE IF NOT EXISTS public.payroll_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  obligation_type TEXT NOT NULL CHECK (obligation_type IN (
    'salary_net',
    'paye_gra',
    'ssnit_tier1',
    'tier2_pension',
    'other_employee_deductions'
  )),
  label TEXT NOT NULL,
  amount_due NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partially_paid', 'paid')),
  due_date DATE,
  liability_account_code TEXT,
  payment_account_id UUID REFERENCES public.accounts(id),
  latest_payment_date DATE,
  latest_payment_reference TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_obligations_unique_active
  ON public.payroll_obligations(business_id, payroll_run_id, obligation_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_obligations_business_id
  ON public.payroll_obligations(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_obligations_payroll_run_id
  ON public.payroll_obligations(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_obligations_obligation_type
  ON public.payroll_obligations(obligation_type);
CREATE INDEX IF NOT EXISTS idx_payroll_obligations_status
  ON public.payroll_obligations(status);
CREATE INDEX IF NOT EXISTS idx_payroll_obligations_due_date
  ON public.payroll_obligations(due_date);

ALTER TABLE public.payroll_obligations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payroll obligations for their business" ON public.payroll_obligations;
CREATE POLICY "Users can view payroll obligations for their business"
  ON public.payroll_obligations FOR SELECT
  USING (public.finza_user_can_access_business(payroll_obligations.business_id));

DROP POLICY IF EXISTS "Users can insert payroll obligations for their business" ON public.payroll_obligations;
CREATE POLICY "Users can insert payroll obligations for their business"
  ON public.payroll_obligations FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(payroll_obligations.business_id));

DROP POLICY IF EXISTS "Users can update payroll obligations for their business" ON public.payroll_obligations;
CREATE POLICY "Users can update payroll obligations for their business"
  ON public.payroll_obligations FOR UPDATE
  USING (public.finza_user_can_access_business(payroll_obligations.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_obligations.business_id));

DROP POLICY IF EXISTS "Users can delete payroll obligations for their business" ON public.payroll_obligations;
CREATE POLICY "Users can delete payroll obligations for their business"
  ON public.payroll_obligations FOR DELETE
  USING (public.finza_user_can_access_business(payroll_obligations.business_id));

DROP TRIGGER IF EXISTS update_payroll_obligations_updated_at ON public.payroll_obligations;
CREATE TRIGGER update_payroll_obligations_updated_at
  BEFORE UPDATE ON public.payroll_obligations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.payroll_obligation_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payroll_obligation_id UUID NOT NULL REFERENCES public.payroll_obligations(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_account_id UUID NOT NULL REFERENCES public.accounts(id),
  reference TEXT,
  notes TEXT,
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payroll_obligation_payments_business_id
  ON public.payroll_obligation_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_obligation_payments_run_id
  ON public.payroll_obligation_payments(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_obligation_payments_obligation_id
  ON public.payroll_obligation_payments(payroll_obligation_id);
CREATE INDEX IF NOT EXISTS idx_payroll_obligation_payments_deleted_at
  ON public.payroll_obligation_payments(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE public.payroll_obligation_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payroll obligation payments for their business" ON public.payroll_obligation_payments;
CREATE POLICY "Users can view payroll obligation payments for their business"
  ON public.payroll_obligation_payments FOR SELECT
  USING (public.finza_user_can_access_business(payroll_obligation_payments.business_id));

DROP POLICY IF EXISTS "Users can insert payroll obligation payments for their business" ON public.payroll_obligation_payments;
CREATE POLICY "Users can insert payroll obligation payments for their business"
  ON public.payroll_obligation_payments FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(payroll_obligation_payments.business_id));

DROP POLICY IF EXISTS "Users can update payroll obligation payments for their business" ON public.payroll_obligation_payments;
CREATE POLICY "Users can update payroll obligation payments for their business"
  ON public.payroll_obligation_payments FOR UPDATE
  USING (public.finza_user_can_access_business(payroll_obligation_payments.business_id))
  WITH CHECK (public.finza_user_can_access_business(payroll_obligation_payments.business_id));

DROP POLICY IF EXISTS "Users can delete payroll obligation payments for their business" ON public.payroll_obligation_payments;
CREATE POLICY "Users can delete payroll obligation payments for their business"
  ON public.payroll_obligation_payments FOR DELETE
  USING (public.finza_user_can_access_business(payroll_obligation_payments.business_id));

CREATE OR REPLACE FUNCTION public.post_payroll_obligation_payment_to_ledger(p_payroll_obligation_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  v_payment RECORD;
  v_obligation RECORD;
  v_business_id UUID;
  v_liability_account_id UUID;
  v_journal_entry_id UUID;
  v_existing_journal_id UUID;
BEGIN
  SELECT
    pop.id,
    pop.business_id,
    pop.payroll_run_id,
    pop.payroll_obligation_id,
    pop.payment_date,
    pop.amount,
    pop.payment_account_id,
    pop.journal_entry_id,
    pop.deleted_at
  INTO v_payment
  FROM public.payroll_obligation_payments pop
  WHERE pop.id = p_payroll_obligation_payment_id;

  IF NOT FOUND OR v_payment.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll obligation payment not found: %', p_payroll_obligation_payment_id;
  END IF;

  v_business_id := v_payment.business_id;

  IF NOT public.finza_user_can_access_business(v_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post payroll obligation payment for this business';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_business_id::TEXT),
    hashtext(p_payroll_obligation_payment_id::TEXT)
  );

  IF v_payment.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll obligation payment % is already posted', p_payroll_obligation_payment_id;
  END IF;

  SELECT je.id
  INTO v_existing_journal_id
  FROM public.journal_entries je
  WHERE je.reference_type = 'payroll_obligation_payment'
    AND je.reference_id = p_payroll_obligation_payment_id
  LIMIT 1;

  IF v_existing_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Payroll obligation payment % already has a journal entry', p_payroll_obligation_payment_id;
  END IF;

  SELECT
    po.id,
    po.business_id,
    po.payroll_run_id,
    po.obligation_type,
    po.label,
    po.liability_account_code
  INTO v_obligation
  FROM public.payroll_obligations po
  WHERE po.id = v_payment.payroll_obligation_id
    AND po.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll obligation not found for payment %', p_payroll_obligation_payment_id;
  END IF;

  IF v_obligation.business_id <> v_business_id OR v_obligation.payroll_run_id <> v_payment.payroll_run_id THEN
    RAISE EXCEPTION 'Payroll obligation payment relationship mismatch';
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_business_id, v_payment.payment_date);

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
  INTO v_liability_account_id
  FROM public.accounts a
  WHERE a.business_id = v_business_id
    AND a.code = COALESCE(v_obligation.liability_account_code, '')
    AND a.type = 'liability'
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF v_liability_account_id IS NULL THEN
    RAISE EXCEPTION 'Liability account code % is not configured for this business', v_obligation.liability_account_code;
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
    'Payroll obligation payment - ' || COALESCE(v_obligation.label, v_obligation.obligation_type),
    'payroll_obligation_payment',
    p_payroll_obligation_payment_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  VALUES
    (v_journal_entry_id, v_liability_account_id, v_payment.amount, 0, 'Settle payroll obligation payable'),
    (v_journal_entry_id, v_payment.payment_account_id, 0, v_payment.amount, 'Payroll obligation payment account');

  UPDATE public.payroll_obligation_payments
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_payroll_obligation_payment_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.post_payroll_obligation_payment_to_ledger(UUID) IS
'Posts payroll obligation remittance/payment: Dr liability account on payroll_obligations.liability_account_code, Cr selected cash/bank/momo asset account.';

REVOKE ALL ON FUNCTION public.post_payroll_obligation_payment_to_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_obligation_payment_to_ledger(UUID) TO authenticated;

