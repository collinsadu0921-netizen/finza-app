-- ============================================================================
-- MIGRATION 365: Loans Register + Interest Payment Intent
-- ============================================================================
-- 1. Add Interest Expense account (6300) to system accounts + backfill
-- 2. Add LOAN_INTEREST_PAYMENT to post_service_intent_to_ledger RPC
-- 3. Create loans table for tracking active loans with interest rates
-- ============================================================================


-- ── 1. Add 6300 Interest Expense to system accounts ─────────────────────────

CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash',                       '1000', 'asset',     'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                       '1010', 'asset',     'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',               '1020', 'asset',     'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',        '1100', 'asset',     'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Fixed Assets',               '1600', 'asset',     'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation',   '1650', 'asset',     'Accumulated depreciation on fixed assets',                              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities — Current
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'Amounts owed to suppliers',                        TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'VAT output tax minus input tax',                   TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'NHIL output tax minus input tax',                  TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'GETFund output tax minus input tax',               TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'COVID-19 Health Recovery Levy payable',            TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'Other tax obligations',                           TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'PAYE tax payable to GRA',                         TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable',            TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable',            TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'Net salaries payable to employees',               TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities — Loan
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',      '2300', 'liability', 'Loans and overdrafts repayable within 12 months',   TRUE),
    (p_business_id, 'Long-term Bank Loan',  '2310', 'liability', 'Loans repayable after 12 months',                   TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',  '3000', 'equity', 'Owner investment',       TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', 'Accumulated profits',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', 'Revenue from services',                    TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets',      TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',               '5000', 'expense', 'Direct costs',                                  TRUE),
    (p_business_id, 'Operating Expenses',          '5100', 'expense', 'General operating expenses',                    TRUE),
    (p_business_id, 'Supplier Bills',              '5200', 'expense', 'Supplier invoices',                             TRUE),
    (p_business_id, 'Administrative Expenses',     '5300', 'expense', 'Admin and overhead',                            TRUE),
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;


-- ── 2. Backfill 6300 for existing businesses ─────────────────────────────────

INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT b.id, 'Interest Expense', '6300', 'expense', 'Interest on loans and borrowings', TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.business_id = b.id AND a.code = '6300' AND a.deleted_at IS NULL
);


-- ── 3. Extend post_service_intent_to_ledger with LOAN_INTEREST_PAYMENT ────────

DROP FUNCTION IF EXISTS post_service_intent_to_ledger(UUID, DATE, JSONB, UUID);

CREATE OR REPLACE FUNCTION post_service_intent_to_ledger(
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
  v_description        TEXT;
  v_journal_entry_id   UUID;
BEGIN
  -- 1) Authorise: business owner only
  SELECT owner_id INTO v_owner_id FROM businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
  IF v_owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the business owner can post service intents';
  END IF;

  -- 2) Resolve period; enforce not locked
  SELECT id, status INTO v_period_id, v_period_status
  FROM accounting_periods
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

  -- 3) Parse intent
  v_intent_type        := p_intent->>'intent_type';
  v_amount             := (p_intent->>'amount')::NUMERIC;
  v_bank_account_id    := (p_intent->>'bank_or_cash_account_id')::UUID;
  v_equity_account_id  := (p_intent->>'equity_account_id')::UUID;
  v_loan_account_id    := (p_intent->>'loan_account_id')::UUID;
  v_expense_account_id := (p_intent->>'expense_account_id')::UUID;
  v_description        := NULLIF(TRIM(COALESCE(p_intent->>'description', '')), '');

  IF v_intent_type IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid intent: intent_type and a positive amount are required';
  END IF;
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Invalid intent: bank_or_cash_account_id is required';
  END IF;

  -- Per-type second-account validation
  IF v_intent_type IN ('OWNER_CONTRIBUTION', 'OWNER_WITHDRAWAL') THEN
    IF v_equity_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: equity_account_id is required for %', v_intent_type;
    END IF;
  ELSIF v_intent_type IN ('LOAN_DRAWDOWN', 'LOAN_REPAYMENT') THEN
    IF v_loan_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: loan_account_id is required for %', v_intent_type;
    END IF;
  ELSIF v_intent_type = 'LOAN_INTEREST_PAYMENT' THEN
    IF v_expense_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid intent: expense_account_id is required for LOAN_INTEREST_PAYMENT';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported intent_type: %', v_intent_type;
  END IF;

  -- 4) Insert journal entry header
  INSERT INTO journal_entries (
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
      WHEN 'LOAN_DRAWDOWN'          THEN 'Loan Drawdown'
      WHEN 'LOAN_REPAYMENT'         THEN 'Loan Repayment'
      WHEN 'LOAN_INTEREST_PAYMENT'  THEN 'Loan Interest Payment'
      ELSE 'Service Intent'
    END),
    'manual', NULL,
    'service_intent', v_period_id,
    p_user_id, p_user_id, 'system'
  )
  RETURNING id INTO v_journal_entry_id;

  -- 5) Insert lines (single INSERT enforces double-entry trigger)
  IF v_intent_type = 'OWNER_CONTRIBUTION' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_bank_account_id,   v_amount, 0,        'Owner Contribution'),
      (v_journal_entry_id, v_equity_account_id, 0,        v_amount, 'Owner Contribution');

  ELSIF v_intent_type = 'OWNER_WITHDRAWAL' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_equity_account_id, v_amount, 0,        'Owner Withdrawal'),
      (v_journal_entry_id, v_bank_account_id,   0,        v_amount, 'Owner Withdrawal');

  ELSIF v_intent_type = 'LOAN_DRAWDOWN' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_bank_account_id,  v_amount, 0,        'Loan Drawdown'),
      (v_journal_entry_id, v_loan_account_id,  0,        v_amount, 'Loan Drawdown');

  ELSIF v_intent_type = 'LOAN_REPAYMENT' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_loan_account_id,  v_amount, 0,        'Loan Repayment'),
      (v_journal_entry_id, v_bank_account_id,  0,        v_amount, 'Loan Repayment');

  ELSIF v_intent_type = 'LOAN_INTEREST_PAYMENT' THEN
    -- Dr Interest Expense, Cr Bank/Cash
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_journal_entry_id, v_expense_account_id, v_amount, 0,        'Loan Interest Payment'),
      (v_journal_entry_id, v_bank_account_id,    0,        v_amount, 'Loan Interest Payment');

  END IF;

  RETURN v_journal_entry_id;
END;
$$;

COMMENT ON FUNCTION post_service_intent_to_ledger(UUID, DATE, JSONB, UUID) IS
'Service workspace intent posting. Engine-controlled debit/credit. Owner-only. Period must not be locked.
Supported intents:
  OWNER_CONTRIBUTION     — Dr Bank/Cash,       Cr Equity          (equity_account_id required)
  OWNER_WITHDRAWAL       — Dr Equity,           Cr Bank/Cash       (equity_account_id required)
  LOAN_DRAWDOWN          — Dr Bank/Cash,       Cr Loan Liability   (loan_account_id required)
  LOAN_REPAYMENT         — Dr Loan Liability,   Cr Bank/Cash       (loan_account_id required)
  LOAN_INTEREST_PAYMENT  — Dr Interest Expense, Cr Bank/Cash       (expense_account_id required)';


-- ── 4. Create loans table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loans (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lender_name               TEXT,
  principal_amount          NUMERIC(15,2) NOT NULL,
  interest_rate_pct         NUMERIC(6,4),   -- annual %, e.g. 18.5 for 18.5% p.a.
  start_date                DATE        NOT NULL,
  loan_account_id           UUID        REFERENCES accounts(id),
  drawdown_journal_entry_id UUID,           -- JE created on drawdown
  notes                     TEXT,
  created_at                TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loans_business_id ON loans(business_id);

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loans: business members" ON loans;
CREATE POLICY "loans: business members" ON loans
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE loans IS 'Tracks active loans per business: lender, principal, interest rate, and drawdown JE reference.';
COMMENT ON COLUMN loans.interest_rate_pct IS 'Annual interest rate in percent, e.g. 18.5 means 18.5% p.a.';
