-- ============================================================================
-- Migration 463: Salary advance repayment lifecycle + payroll accounting clearing
-- ============================================================================

ALTER TABLE public.salary_advances
  ADD COLUMN IF NOT EXISTS repaid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'outstanding',
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'salary_advances_status_check'
      AND conrelid = 'public.salary_advances'::regclass
  ) THEN
    ALTER TABLE public.salary_advances
      ADD CONSTRAINT salary_advances_status_check
      CHECK (status IN ('outstanding', 'partially_repaid', 'cleared', 'cancelled'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'salary_advances_repaid_amount_nonnegative'
      AND conrelid = 'public.salary_advances'::regclass
  ) THEN
    ALTER TABLE public.salary_advances
      ADD CONSTRAINT salary_advances_repaid_amount_nonnegative
      CHECK (repaid_amount >= 0);
  END IF;
END;
$$;

UPDATE public.salary_advances
SET
  repaid_amount = LEAST(COALESCE(repaid_amount, 0), amount),
  status = CASE
    WHEN cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN LEAST(COALESCE(repaid_amount, 0), amount) >= amount THEN 'cleared'
    WHEN LEAST(COALESCE(repaid_amount, 0), amount) > 0 THEN 'partially_repaid'
    ELSE 'outstanding'
  END,
  cleared_at = CASE
    WHEN cancelled_at IS NULL AND LEAST(COALESCE(repaid_amount, 0), amount) >= amount THEN COALESCE(cleared_at, NOW())
    ELSE NULL
  END;

CREATE TABLE IF NOT EXISTS public.salary_advance_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  salary_advance_id UUID NOT NULL REFERENCES public.salary_advances(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payroll_entry_id UUID REFERENCES public.payroll_entries(id) ON DELETE SET NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'voided')),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_business_id
  ON public.salary_advance_repayments(business_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_salary_advance_id
  ON public.salary_advance_repayments(salary_advance_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_staff_id
  ON public.salary_advance_repayments(staff_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_payroll_run_id
  ON public.salary_advance_repayments(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_status
  ON public.salary_advance_repayments(status);

DROP INDEX IF EXISTS public.idx_salary_advance_repayments_unique_active;
DROP INDEX IF EXISTS public.idx_salary_advance_repayments_unique_posted;

CREATE UNIQUE INDEX IF NOT EXISTS salary_advance_repayments_unique_entry
  ON public.salary_advance_repayments(salary_advance_id, payroll_run_id, payroll_entry_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deductions_unique_advance_id
  ON public.deductions(advance_id)
  WHERE advance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.salary_advance_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salary_advance_repayments: business members select" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members select"
  ON public.salary_advance_repayments FOR SELECT
  USING (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP POLICY IF EXISTS "salary_advance_repayments: business members insert" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members insert"
  ON public.salary_advance_repayments FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP POLICY IF EXISTS "salary_advance_repayments: business members update" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members update"
  ON public.salary_advance_repayments FOR UPDATE
  USING (public.finza_user_can_access_business(salary_advance_repayments.business_id))
  WITH CHECK (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP POLICY IF EXISTS "salary_advance_repayments: business members delete" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members delete"
  ON public.salary_advance_repayments FOR DELETE
  USING (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP TRIGGER IF EXISTS update_salary_advances_updated_at ON public.salary_advances;
CREATE TRIGGER update_salary_advances_updated_at
  BEFORE UPDATE ON public.salary_advances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_salary_advance_repayments_updated_at ON public.salary_advance_repayments;
CREATE TRIGGER update_salary_advance_repayments_updated_at
  BEFORE UPDATE ON public.salary_advance_repayments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_run_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id                      UUID;
  v_payroll_month                    DATE;
  v_total_gross                      NUMERIC;
  v_total_deductions                 NUMERIC;
  v_total_ssnit_employer             NUMERIC;
  v_total_paye                       NUMERIC;
  v_total_ssnit_employee             NUMERIC;
  v_total_net                        NUMERIC;
  v_advance_repayment_total          NUMERIC := 0;
  v_payroll_expense_account_id       UUID;
  v_ssnit_employer_expense_id        UUID;
  v_paye_liability_account_id        UUID;
  v_ssnit_liability_account_id       UUID;
  v_net_salaries_payable_account_id  UUID;
  v_deductions_payable_account_id    UUID;
  v_staff_advances_account_id        UUID;
  v_journal_entry_id                 UUID;
BEGIN
  SELECT
    business_id,
    payroll_month,
    total_gross_salary,
    COALESCE(total_deductions, 0),
    COALESCE(total_ssnit_employer, 0),
    COALESCE(total_paye, 0),
    COALESCE(total_ssnit_employee, 0),
    COALESCE(total_net_salary, 0)
  INTO
    v_business_id,
    v_payroll_month,
    v_total_gross,
    v_total_deductions,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found: %', p_payroll_run_id;
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_business_id, v_payroll_month);

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_repayment_total
  FROM public.salary_advance_repayments sar
  WHERE sar.payroll_run_id = p_payroll_run_id
    AND sar.business_id = v_business_id
    AND sar.status = 'pending';

  -- 5600 Payroll Expense
  SELECT id INTO v_payroll_expense_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '5600' AND deleted_at IS NULL;
  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Gross salaries, wages and allowances', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  -- 5610 Employer Pension Expense
  SELECT id INTO v_ssnit_employer_expense_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '5610' AND deleted_at IS NULL;
  IF v_ssnit_employer_expense_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employer Pension Expense', '5610', 'expense', 'Employer pension / SSNIT contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_id;
  END IF;

  -- 2230 PAYE Tax Payable
  SELECT id INTO v_paye_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2230' AND deleted_at IS NULL;
  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE income tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  -- 2231 SSNIT Payable
  SELECT id INTO v_ssnit_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2231' AND deleted_at IS NULL;
  IF v_ssnit_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT / Tier 1 Pension Payable', '2231', 'liability', 'SSNIT / Tier 1 pension contributions payable', TRUE)
    RETURNING id INTO v_ssnit_liability_account_id;
  END IF;

  -- 2240 Net Salaries Payable
  SELECT id INTO v_net_salaries_payable_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2240' AND deleted_at IS NULL;
  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  -- 2241 Employee Deductions Payable
  SELECT id INTO v_deductions_payable_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2241' AND deleted_at IS NULL;
  IF v_deductions_payable_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability', 'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
    RETURNING id INTO v_deductions_payable_account_id;
  END IF;

  -- 1110 Staff Advances
  SELECT id INTO v_staff_advances_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '1110' AND deleted_at IS NULL;
  IF v_staff_advances_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Staff Advances', '1110', 'asset', 'Salary advances issued to employees', TRUE)
    RETURNING id INTO v_staff_advances_account_id;
  END IF;

  INSERT INTO public.journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (
    v_business_id,
    v_payroll_month,
    'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'),
    'payroll',
    p_payroll_run_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_payroll_expense_account_id,      v_total_gross,                                   0, 'Gross Salaries and Allowances'),
    (v_journal_entry_id, v_ssnit_employer_expense_id,       v_total_ssnit_employer,                          0, 'Employer SSNIT Contribution'),
    (v_journal_entry_id, v_paye_liability_account_id,       0, v_total_paye,                                    'PAYE Tax Payable'),
    (v_journal_entry_id, v_ssnit_liability_account_id,      0, v_total_ssnit_employee + v_total_ssnit_employer, 'SSNIT Payable'),
    (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net,                                     'Net Salaries Payable'),
    (v_journal_entry_id, v_deductions_payable_account_id,   0, v_total_deductions,                              'Employee Deductions Payable');

  IF v_advance_repayment_total > 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_journal_entry_id, v_deductions_payable_account_id, v_advance_repayment_total, 0, 'Clear salary advance deductions payable'),
      (v_journal_entry_id, v_staff_advances_account_id, 0, v_advance_repayment_total, 'Clear staff advances receivable');
  END IF;

  WITH posted_rows AS (
    UPDATE public.salary_advance_repayments sar
    SET
      status = 'posted',
      journal_entry_id = v_journal_entry_id,
      posted_at = NOW()
    WHERE sar.payroll_run_id = p_payroll_run_id
      AND sar.business_id = v_business_id
      AND sar.status = 'pending'
    RETURNING sar.salary_advance_id, sar.amount
  ),
  repayment_totals AS (
    SELECT salary_advance_id, SUM(amount) AS amount
    FROM posted_rows
    GROUP BY salary_advance_id
  )
  UPDATE public.salary_advances sa
  SET
    repaid_amount = LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount),
    status = CASE
      WHEN sa.cancelled_at IS NOT NULL THEN 'cancelled'
      WHEN LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount) >= sa.amount THEN 'cleared'
      WHEN LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount) > 0 THEN 'partially_repaid'
      ELSE 'outstanding'
    END,
    cleared_at = CASE
      WHEN sa.cancelled_at IS NULL AND LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount) >= sa.amount
        THEN COALESCE(sa.cleared_at, NOW())
      ELSE NULL
    END
  FROM repayment_totals rt
  WHERE sa.id = rt.salary_advance_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;
