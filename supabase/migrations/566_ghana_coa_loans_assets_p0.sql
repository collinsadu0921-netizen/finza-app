-- ============================================================================
-- Migration 566: Ghana COA / Loans / Assets P0 alignment
-- ============================================================================
-- A) Restore loan sub_type on system accounts + authoritative create_system_accounts
-- B) Loan principal subledger for per-loan outstanding
-- C) Atomic loan drawdown RPC
-- D) Loan repayment requires loan_id + subledger entry
-- Does NOT modify historical migrations 349 or 469.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Loan principal subledger (per-loan outstanding; GL remains aggregate)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loan_principal_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  entry_kind TEXT NOT NULL CHECK (
    entry_kind IN ('drawdown', 'repayment', 'reversal_drawdown', 'reversal_repayment')
  ),
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (journal_entry_id, entry_kind)
);

CREATE INDEX IF NOT EXISTS idx_loan_principal_ledger_loan_id
  ON public.loan_principal_ledger (loan_id);

CREATE INDEX IF NOT EXISTS idx_loan_principal_ledger_business_id
  ON public.loan_principal_ledger (business_id);

COMMENT ON TABLE public.loan_principal_ledger IS
  'Per-loan principal subledger. GL loan liability account may be shared; outstanding per loan is derived here.';

ALTER TABLE public.loan_principal_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_principal_ledger: business members" ON public.loan_principal_ledger;
CREATE POLICY "loan_principal_ledger: business members"
  ON public.loan_principal_ledger
  FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_users WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Outstanding helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_loan_outstanding(p_loan_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    COALESCE(SUM(
      CASE lpl.entry_kind
        WHEN 'drawdown' THEN lpl.amount
        WHEN 'reversal_repayment' THEN lpl.amount
        WHEN 'repayment' THEN -lpl.amount
        WHEN 'reversal_drawdown' THEN -lpl.amount
        ELSE 0
      END
    ), 0)
  )
  FROM public.loan_principal_ledger lpl
  WHERE lpl.loan_id = p_loan_id;
$$;

COMMENT ON FUNCTION public.finza_loan_outstanding(UUID) IS
  'Principal outstanding for one loan register row (excludes interest expense).';

GRANT EXECUTE ON FUNCTION public.finza_loan_outstanding(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Backfill drawdown rows for existing loans (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.loan_principal_ledger (
  business_id,
  loan_id,
  journal_entry_id,
  entry_kind,
  amount,
  entry_date
)
SELECT
  l.business_id,
  l.id,
  l.drawdown_journal_entry_id,
  'drawdown',
  l.principal_amount,
  l.start_date
FROM public.loans l
WHERE l.drawdown_journal_entry_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.loan_principal_ledger lpl
    WHERE lpl.loan_id = l.id
      AND lpl.entry_kind = 'drawdown'
  );

-- ---------------------------------------------------------------------------
-- 4) Safe backfill: system loan accounts missing sub_type = loan
--    Excludes historical Deferred Revenue collision at code 2300.
-- ---------------------------------------------------------------------------
UPDATE public.accounts AS a
SET sub_type = 'loan',
    updated_at = NOW()
WHERE a.code IN ('2300', '2310')
  AND a.type = 'liability'
  AND a.is_system = TRUE
  AND a.deleted_at IS NULL
  AND a.sub_type IS NULL
  AND a.name NOT ILIKE '%deferred revenue%'
  AND (
    a.code = '2310'
    OR (
      a.code = '2300'
      AND (
        a.name IN ('Short-term Loan', 'Short term Loan')
        OR a.name ILIKE '%short%term%loan%'
        OR a.description ILIKE '%Loans and overdrafts%'
        OR a.description ILIKE '%repayable within 12 months%'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5) create_system_accounts — preserve 469 payroll labels + semantic sub_types
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cash',                     '1000', 'asset',     'cash',              'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                     '1010', 'asset',     'bank',              'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',             '1020', 'asset',     'mobile_money',      'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',      '1100', 'asset',     NULL,                'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Staff Advances',           '1110', 'asset',     NULL,                'Salary advances issued to employees',                                   TRUE),
    (p_business_id, 'WHT Receivable',           '2155', 'asset',     NULL,                'Withholding tax deducted from your payments by customers',               TRUE),
    (p_business_id, 'Fixed Assets',             '1600', 'asset',     NULL,                'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation', '1650', 'asset',     NULL,                'Accumulated depreciation on fixed assets',                              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'payable',         'Amounts owed to suppliers',                        TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'tax_payable',     'VAT output tax minus input tax',                   TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'tax_payable',     'NHIL output tax minus input tax',                  TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'tax_payable',     'GETFund output tax minus input tax',               TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'tax_payable',     'COVID-19 Health Recovery Levy payable',            TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'tax_payable',     'Other tax obligations',                           TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'tax_payable',     'PAYE tax payable to GRA',                         TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'payroll_payable', 'SSNIT employee contributions payable',            TRUE),
    (p_business_id, 'PAYE Tax Payable',                    '2230', 'liability', 'payroll_payable', 'PAYE income tax payable to GRA',                  TRUE),
    (p_business_id, 'SSNIT / Tier 1 Pension Payable',      '2231', 'liability', 'payroll_payable', 'SSNIT / Tier 1 pension contributions payable',  TRUE),
    (p_business_id, 'Tier 2 Pension Payable',             '2232', 'liability', 'payroll_payable', 'Tier 2 pension contributions payable to trustee', TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'payroll_payable', 'Net salaries payable to employees',               TRUE),
    (p_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability', 'payroll_payable',
     'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',     '2300', 'liability', 'loan', 'Loans and overdrafts repayable within 12 months', TRUE),
    (p_business_id, 'Long-term Bank Loan', '2310', 'liability', 'loan', 'Loans repayable after 12 months',                 TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',   '3000', 'equity', NULL, 'Owner investment',       TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', NULL, 'Accumulated profits',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', NULL, 'Revenue from services',               TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', NULL, 'Gains from disposal of fixed assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',               '5000', 'expense', NULL, 'Direct costs',                                  TRUE),
    (p_business_id, 'Operating Expenses',          '5100', 'expense', NULL, 'General operating expenses',                    TRUE),
    (p_business_id, 'Supplier Bills',              '5200', 'expense', NULL, 'Supplier invoices',                             TRUE),
    (p_business_id, 'Administrative Expenses',     '5300', 'expense', NULL, 'Admin and overhead',                            TRUE),
    (p_business_id, 'Employer Pension Expense',    '5610', 'expense', NULL, 'Employer pension / SSNIT contribution expense', TRUE),
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', NULL, 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', NULL, 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', NULL, 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', NULL, 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', NULL, 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.create_system_accounts(UUID) IS
  'Idempotent system COA bootstrap. Semantic sub_types on funding + loan accounts (566). Preserves 469 payroll labels.';

-- ---------------------------------------------------------------------------
-- 6) Atomic loan drawdown: loan row + JE + subledger in one transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_loan_with_drawdown(
  p_business_id       UUID,
  p_user_id           UUID,
  p_entry_date        DATE,
  p_intent            JSONB,
  p_lender_name       TEXT DEFAULT NULL,
  p_interest_rate_pct NUMERIC DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_period_id          UUID;
  v_period_status      TEXT;
  v_owner_id           UUID;
  v_amount             NUMERIC;
  v_bank_account_id    UUID;
  v_loan_account_id    UUID;
  v_description        TEXT;
  v_journal_entry_id   UUID;
  v_loan_id            UUID;
BEGIN
  IF COALESCE(p_intent->>'intent_type', '') <> 'LOAN_DRAWDOWN' THEN
    RAISE EXCEPTION 'intent_type must be LOAN_DRAWDOWN';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
  IF v_owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the business owner can post service intents';
  END IF;

  SELECT id, status INTO v_period_id, v_period_status
  FROM public.accounting_periods
  WHERE business_id = p_business_id
    AND p_entry_date >= period_start
    AND p_entry_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for date %. Ensure the period exists.', p_entry_date;
  END IF;
  IF v_period_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post to a locked period. Choose another date.';
  END IF;

  v_amount          := (p_intent->>'amount')::NUMERIC;
  v_bank_account_id := (p_intent->>'bank_or_cash_account_id')::UUID;
  v_loan_account_id := (p_intent->>'loan_account_id')::UUID;
  v_description     := NULLIF(TRIM(COALESCE(p_intent->>'description', '')), '');

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid intent: a positive amount is required';
  END IF;
  IF v_bank_account_id IS NULL OR v_loan_account_id IS NULL THEN
    RAISE EXCEPTION 'Invalid intent: bank_or_cash_account_id and loan_account_id are required';
  END IF;

  -- Loan row first so journal reference_id can be set on INSERT (journal entries are immutable after insert).
  INSERT INTO public.loans (
    business_id,
    lender_name,
    principal_amount,
    interest_rate_pct,
    start_date,
    loan_account_id,
    drawdown_journal_entry_id,
    notes
  ) VALUES (
    p_business_id,
    NULLIF(TRIM(COALESCE(p_lender_name, '')), ''),
    v_amount,
    p_interest_rate_pct,
    p_entry_date,
    v_loan_account_id,
    NULL,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_loan_id;

  INSERT INTO public.journal_entries (
    business_id, date, description,
    reference_type, reference_id,
    source_type, period_id,
    created_by, posted_by, posting_source
  ) VALUES (
    p_business_id,
    p_entry_date,
    COALESCE(v_description, 'Loan Drawdown'),
    'loan', v_loan_id,
    'service_intent', v_period_id,
    p_user_id, p_user_id, 'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_journal_entry_id, v_bank_account_id, v_amount, 0, 'Loan Drawdown'),
    (v_journal_entry_id, v_loan_account_id, 0, v_amount, 'Loan Drawdown');

  UPDATE public.loans
  SET drawdown_journal_entry_id = v_journal_entry_id
  WHERE id = v_loan_id;

  INSERT INTO public.loan_principal_ledger (
    business_id, loan_id, journal_entry_id, entry_kind, amount, entry_date
  ) VALUES (
    p_business_id, v_loan_id, v_journal_entry_id, 'drawdown', v_amount, p_entry_date
  );

  RETURN jsonb_build_object(
    'loan_id', v_loan_id,
    'journal_entry_id', v_journal_entry_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_loan_with_drawdown(UUID, UUID, DATE, JSONB, TEXT, NUMERIC, TEXT) IS
  'Atomic loan register drawdown: balanced JE + loans row + loan_principal_ledger drawdown.';

GRANT EXECUTE ON FUNCTION public.create_loan_with_drawdown(UUID, UUID, DATE, JSONB, TEXT, NUMERIC, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) post_service_intent_to_ledger — repayment subledger; block drawdown here
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.post_service_intent_to_ledger(UUID, DATE, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.post_service_intent_to_ledger(
  p_business_id UUID,
  p_entry_date  DATE,
  p_intent      JSONB,
  p_user_id     UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_period_id          UUID;
  v_period_status      TEXT;
  v_owner_id           UUID;
  v_intent_type        TEXT;
  v_amount             NUMERIC;
  v_bank_account_id    UUID;
  v_equity_account_id  UUID;
  v_loan_account_id    UUID;
  v_expense_account_id UUID;
  v_loan_id            UUID;
  v_outstanding        NUMERIC;
  v_description        TEXT;
  v_journal_entry_id   UUID;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
  IF v_owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the business owner can post service intents';
  END IF;

  SELECT id, status INTO v_period_id, v_period_status
  FROM public.accounting_periods
  WHERE business_id = p_business_id
    AND p_entry_date >= period_start
    AND p_entry_date <= period_end
  ORDER BY period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for date %. Ensure the period exists.', p_entry_date;
  END IF;
  IF v_period_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post to a locked period. Choose another date.';
  END IF;

  v_intent_type        := p_intent->>'intent_type';
  v_amount             := (p_intent->>'amount')::NUMERIC;
  v_bank_account_id    := (p_intent->>'bank_or_cash_account_id')::UUID;
  v_equity_account_id  := (p_intent->>'equity_account_id')::UUID;
  v_loan_account_id    := (p_intent->>'loan_account_id')::UUID;
  v_expense_account_id := (p_intent->>'expense_account_id')::UUID;
  v_loan_id            := NULLIF(TRIM(COALESCE(p_intent->>'loan_id', '')), '')::UUID;
  v_description        := NULLIF(TRIM(COALESCE(p_intent->>'description', '')), '');

  IF v_intent_type = 'LOAN_DRAWDOWN' THEN
    RAISE EXCEPTION 'LOAN_DRAWDOWN must use create_loan_with_drawdown for atomic loan register posting';
  END IF;

  IF v_intent_type IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid intent: intent_type and a positive amount are required';
  END IF;
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Invalid intent: bank_or_cash_account_id is required';
  END IF;

  IF v_intent_type IN ('OWNER_CONTRIBUTION', 'OWNER_WITHDRAWAL') THEN
    IF v_equity_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: equity_account_id is required for %', v_intent_type;
    END IF;
  ELSIF v_intent_type = 'LOAN_REPAYMENT' THEN
    IF v_loan_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: loan_id is required for LOAN_REPAYMENT';
    END IF;
    IF v_loan_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: loan_account_id is required for LOAN_REPAYMENT';
    END IF;
    PERFORM 1
    FROM public.loans l
    WHERE l.id = v_loan_id
      AND l.business_id = p_business_id
      AND l.loan_account_id = v_loan_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Loan not found or loan_account_id does not match the selected loan';
    END IF;
    v_outstanding := public.finza_loan_outstanding(v_loan_id);
    IF v_amount > v_outstanding + 0.01 THEN
      RAISE EXCEPTION 'Repayment amount % exceeds loan outstanding %', v_amount, v_outstanding;
    END IF;
  ELSIF v_intent_type = 'LOAN_INTEREST_PAYMENT' THEN
    IF v_expense_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: expense_account_id is required for LOAN_INTEREST_PAYMENT';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported intent_type: %', v_intent_type;
  END IF;

  INSERT INTO public.journal_entries (
    business_id, date, description,
    reference_type, reference_id,
    source_type, period_id,
    created_by, posted_by, posting_source
  ) VALUES (
    p_business_id,
    p_entry_date,
    COALESCE(v_description, CASE v_intent_type
      WHEN 'OWNER_CONTRIBUTION'     THEN 'Owner Contribution'
      WHEN 'OWNER_WITHDRAWAL'       THEN 'Owner Withdrawal'
      WHEN 'LOAN_REPAYMENT'         THEN 'Loan Repayment'
      WHEN 'LOAN_INTEREST_PAYMENT'  THEN 'Loan Interest Payment'
      ELSE 'Service Intent'
    END),
    CASE WHEN v_loan_id IS NOT NULL THEN 'loan' ELSE 'manual' END,
    v_loan_id,
    'service_intent', v_period_id,
    p_user_id, p_user_id, 'system'
  )
  RETURNING id INTO v_journal_entry_id;

  IF v_intent_type = 'OWNER_CONTRIBUTION' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_bank_account_id,   v_amount, 0,        'Owner Contribution'),
      (v_journal_entry_id, v_equity_account_id, 0,        v_amount, 'Owner Contribution');

  ELSIF v_intent_type = 'OWNER_WITHDRAWAL' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_equity_account_id, v_amount, 0,        'Owner Withdrawal'),
      (v_journal_entry_id, v_bank_account_id,   0,        v_amount, 'Owner Withdrawal');

  ELSIF v_intent_type = 'LOAN_REPAYMENT' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_loan_account_id,  v_amount, 0,        'Loan Repayment'),
      (v_journal_entry_id, v_bank_account_id,  0,        v_amount, 'Loan Repayment');

    INSERT INTO public.loan_principal_ledger (
      business_id, loan_id, journal_entry_id, entry_kind, amount, entry_date
    ) VALUES (
      p_business_id, v_loan_id, v_journal_entry_id, 'repayment', v_amount, p_entry_date
    );

  ELSIF v_intent_type = 'LOAN_INTEREST_PAYMENT' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_expense_account_id, v_amount, 0,        'Loan Interest Payment'),
      (v_journal_entry_id, v_bank_account_id,    0,        v_amount, 'Loan Interest Payment');
  END IF;

  RETURN v_journal_entry_id;
END;
$$;

COMMENT ON FUNCTION public.post_service_intent_to_ledger(UUID, DATE, JSONB, UUID) IS
  'Service workspace intents (excludes LOAN_DRAWDOWN — use create_loan_with_drawdown). Repayment requires loan_id + subledger row.';

GRANT EXECUTE ON FUNCTION public.post_service_intent_to_ledger(UUID, DATE, JSONB, UUID) TO authenticated;
