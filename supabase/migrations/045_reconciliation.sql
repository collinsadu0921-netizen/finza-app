-- Migration: Bank/Mobile Money Reconciliation System
-- Adds reconciliation capabilities for asset accounts

-- ============================================================================
-- ADD is_reconcilable FLAG TO ACCOUNTS
-- ============================================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_reconcilable BOOLEAN DEFAULT FALSE;

-- Update existing asset accounts to be reconcilable by default
UPDATE accounts
SET is_reconcilable = TRUE
WHERE type = 'asset'
  AND code IN ('1010', '1020') -- Bank and Mobile Money
  AND is_reconcilable IS NULL;

-- ============================================================================
-- BANK_TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  external_ref TEXT,
  status TEXT DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'matched', 'ignored')),
  matches JSONB, -- Array of matched journal_entry_ids or payment_ids
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for bank_transactions
CREATE INDEX IF NOT EXISTS idx_bank_transactions_business_id ON bank_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_external_ref ON bank_transactions(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_transactions_deleted_at ON bank_transactions(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- RECONCILIATION_PERIODS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS reconciliation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  bank_ending_balance NUMERIC,
  system_ending_balance NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  reconciled_by UUID REFERENCES auth.users(id),
  reconciled_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for reconciliation_periods
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_business_id ON reconciliation_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_account_id ON reconciliation_periods(account_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_period ON reconciliation_periods(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_deleted_at ON reconciliation_periods(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- FUNCTION: Get system transactions for an account
-- ============================================================================
CREATE OR REPLACE FUNCTION get_system_transactions_for_account(
  p_business_id UUID,
  p_account_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  date DATE,
  description TEXT,
  amount NUMERIC,
  type TEXT,
  reference_type TEXT,
  reference_id UUID,
  journal_entry_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jel.id,
    je.date,
    COALESCE(jel.description, je.description) as description,
    CASE
      WHEN jel.debit > 0 THEN jel.debit
      ELSE jel.credit
    END as amount,
    CASE
      WHEN jel.debit > 0 THEN 'debit'
      ELSE 'credit'
    END as type,
    je.reference_type,
    je.reference_id,
    je.id as journal_entry_id
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = p_business_id
    AND jel.account_id = p_account_id
    AND (p_start_date IS NULL OR je.date >= p_start_date)
    AND (p_end_date IS NULL OR je.date <= p_end_date)
  ORDER BY je.date ASC, je.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate account balance as of date
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_account_balance_as_of(
  p_business_id UUID,
  p_account_id UUID,
  p_as_of_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  account_type TEXT;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  balance NUMERIC := 0;
BEGIN
  -- Get account type
  SELECT type INTO account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id;

  IF account_type IS NULL THEN
    RETURN 0;
  END IF;

  -- Sum debits and credits up to as_of_date
  SELECT
    COALESCE(SUM(jel.debit), 0),
    COALESCE(SUM(jel.credit), 0)
  INTO total_debit, total_credit
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = p_business_id
    AND jel.account_id = p_account_id
    AND je.date <= p_as_of_date;

  -- Calculate balance based on account type
  IF account_type IN ('asset', 'expense') THEN
    balance := total_debit - total_credit;
  ELSE
    -- liability, equity, income
    balance := total_credit - total_debit;
  END IF;

  RETURN COALESCE(balance, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUTO-UPDATE updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS update_bank_transactions_updated_at ON bank_transactions;
CREATE TRIGGER update_bank_transactions_updated_at
  BEFORE UPDATE ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reconciliation_periods_updated_at ON reconciliation_periods;
CREATE TRIGGER update_reconciliation_periods_updated_at
  BEFORE UPDATE ON reconciliation_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on bank_transactions
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bank transactions for their business"
  ON bank_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bank_transactions.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert bank transactions for their business"
  ON bank_transactions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bank_transactions.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update bank transactions for their business"
  ON bank_transactions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bank_transactions.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete bank transactions for their business"
  ON bank_transactions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bank_transactions.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on reconciliation_periods
ALTER TABLE reconciliation_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view reconciliation periods for their business"
  ON reconciliation_periods FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = reconciliation_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert reconciliation periods for their business"
  ON reconciliation_periods FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = reconciliation_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update reconciliation periods for their business"
  ON reconciliation_periods FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = reconciliation_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete reconciliation periods for their business"
  ON reconciliation_periods FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = reconciliation_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );


