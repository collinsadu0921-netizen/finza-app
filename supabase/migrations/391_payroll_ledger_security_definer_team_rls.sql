-- ============================================================================
-- Migration 391: Payroll posts to ledger for business members + visible ledger
-- ============================================================================
-- Problem:
--   post_payroll_to_ledger (migration 360) is SECURITY INVOKER. RLS on
--   accounts / journal_entries / journal_entry_lines is owner-only (043).
--   Payroll tables allow any business_users member (382). A non-owner who
--   approves payroll either cannot complete posting (RLS) or, if posting
--   somehow ran as owner, cannot SEE journal lines in the ledger UI.
--
-- Fix:
--   1. post_payroll_to_ledger: SECURITY DEFINER + SET search_path = public,
--      with caller check finza_user_can_access_business(business_id).
--   2. SELECT on journal_entries, journal_entry_lines, accounts: allow
--      finza_user_can_access_business (owner OR business_users), same as
--      payroll RLS. Firm engagement SELECT policies (279) remain as OR.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_payroll_to_ledger(p_payroll_run_id UUID)
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
  v_payroll_expense_account_id       UUID;
  v_ssnit_employer_expense_id        UUID;
  v_paye_liability_account_id        UUID;
  v_ssnit_liability_account_id       UUID;
  v_net_salaries_payable_account_id  UUID;
  v_deductions_payable_account_id    UUID;
  v_journal_entry_id                 UUID;
  v_existing_journal_id              UUID;
BEGIN
  SELECT
    business_id,
    payroll_month,
    total_gross_salary,
    COALESCE(total_deductions, 0),
    COALESCE(total_ssnit_employer, 0),
    COALESCE(total_paye, 0),
    COALESCE(total_ssnit_employee, 0),
    COALESCE(total_net_salary, 0),
    journal_entry_id
  INTO
    v_business_id,
    v_payroll_month,
    v_total_gross,
    v_total_deductions,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net,
    v_existing_journal_id
  FROM payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found: %', p_payroll_run_id;
  END IF;

  IF NOT public.finza_user_can_access_business(v_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post payroll for this business';
  END IF;

  IF v_existing_journal_id IS NOT NULL THEN
    RETURN v_existing_journal_id;
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_payroll_month);

  -- ── Resolve / auto-create accounts ────────────────────────────────────────

  SELECT id INTO v_payroll_expense_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '5600' AND deleted_at IS NULL;
  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Gross salaries, wages and allowances', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  SELECT id INTO v_ssnit_employer_expense_id
  FROM accounts WHERE business_id = v_business_id AND code = '5610' AND deleted_at IS NULL;
  IF v_ssnit_employer_expense_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employer Expense', '5610', 'expense', 'Employer SSNIT contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_id;
  END IF;

  SELECT id INTO v_paye_liability_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2230' AND deleted_at IS NULL;
  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE income tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  SELECT id INTO v_ssnit_liability_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2231' AND deleted_at IS NULL;
  IF v_ssnit_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Payable', '2231', 'liability', 'SSNIT contributions payable', TRUE)
    RETURNING id INTO v_ssnit_liability_account_id;
  END IF;

  SELECT id INTO v_net_salaries_payable_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2240' AND deleted_at IS NULL;
  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  SELECT id INTO v_deductions_payable_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2241' AND deleted_at IS NULL;
  IF v_deductions_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employee Deductions Payable', '2241', 'liability', 'Loan repayments and other employee deductions held by employer', TRUE)
    RETURNING id INTO v_deductions_payable_account_id;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (
    v_business_id,
    v_payroll_month,
    'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'),
    'payroll',
    p_payroll_run_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_payroll_expense_account_id,      v_total_gross,                                   0, 'Gross Salaries and Allowances'),
    (v_journal_entry_id, v_ssnit_employer_expense_id,       v_total_ssnit_employer,                          0, 'Employer SSNIT Contribution'),
    (v_journal_entry_id, v_paye_liability_account_id,       0, v_total_paye,                                    'PAYE Tax Payable'),
    (v_journal_entry_id, v_ssnit_liability_account_id,      0, v_total_ssnit_employee + v_total_ssnit_employer, 'SSNIT Payable'),
    (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net,                                     'Net Salaries Payable'),
    (v_journal_entry_id, v_deductions_payable_account_id,   0, v_total_deductions,                              'Employee Deductions Payable');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION post_payroll_to_ledger(UUID) IS
'Posts payroll run to ledger (SECURITY DEFINER). Caller must be owner or business_users member for the run''s business. Balanced journal: DR 5600+5610, CR 2230+2231+2240+2241.';

REVOKE ALL ON FUNCTION public.post_payroll_to_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_to_ledger(UUID) TO authenticated;

-- ── RLS: business members can read ledger + chart (firm policies unchanged) ─

DROP POLICY IF EXISTS "Users can view journal entries for their business" ON public.journal_entries;
CREATE POLICY "Users can view journal entries for their business"
  ON public.journal_entries FOR SELECT
  USING (public.finza_user_can_access_business(journal_entries.business_id));

DROP POLICY IF EXISTS "Users can view journal entry lines for their business" ON public.journal_entry_lines;
CREATE POLICY "Users can view journal entry lines for their business"
  ON public.journal_entry_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND public.finza_user_can_access_business(je.business_id)
    )
  );

DROP POLICY IF EXISTS "Users can view accounts for their business" ON public.accounts;
CREATE POLICY "Users can view accounts for their business"
  ON public.accounts FOR SELECT
  USING (public.finza_user_can_access_business(accounts.business_id));
