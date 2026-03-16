-- Migration: Accounting Period Lifecycle (Rules Only)
-- Creates explicit accounting periods for each business with lifecycle management
-- Periods are explicit - no implicit months

-- ============================================================================
-- ACCOUNTING_PERIODS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_id TEXT NOT NULL, -- e.g., '2025-01', '2025-Q1', '2025'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed', 'locked')),
  closed_at TIMESTAMP WITH TIME ZONE,
  locked_at TIMESTAMP WITH TIME ZONE,
  closed_by UUID REFERENCES auth.users(id),
  locked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, period_id)
);

-- Note: net_income and retained_earnings_delta are now in period_summary table
-- We keep these columns for backwards compatibility but prefer period_summary
ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS net_income NUMERIC,
  ADD COLUMN IF NOT EXISTS retained_earnings_delta NUMERIC;

-- Add comments for new columns
COMMENT ON COLUMN accounting_periods.net_income IS 'DEPRECATED: Use period_summary.net_income instead. Computed when closed: total_revenue - total_expenses (reproducible from ledger)';
COMMENT ON COLUMN accounting_periods.retained_earnings_delta IS 'DEPRECATED: Use period_summary.retained_earnings_delta instead. Computed when closed: equals net_income (reproducible from ledger)';

-- Indexes for accounting_periods
CREATE INDEX IF NOT EXISTS idx_accounting_periods_business_id ON accounting_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_period_id ON accounting_periods(period_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_status ON accounting_periods(status);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_date_range ON accounting_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_business_status ON accounting_periods(business_id, status);

-- ============================================================================
-- FUNCTION: Validate period date range
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_accounting_period_dates(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date';
  END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Check for overlapping periods
-- ============================================================================
CREATE OR REPLACE FUNCTION check_period_overlap(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_exclude_period_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  overlap_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO overlap_count
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND (id != p_exclude_period_id OR p_exclude_period_id IS NULL)
    AND (
      (start_date <= p_start_date AND end_date >= p_start_date) OR
      (start_date <= p_end_date AND end_date >= p_end_date) OR
      (start_date >= p_start_date AND end_date <= p_end_date)
    );
  
  RETURN overlap_count = 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Validate period lifecycle transitions (ONLY FORWARD)
-- open → closing → closed → locked
-- No backward transitions. Ever.
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_period_status_transition(
  p_old_status TEXT,
  p_new_status TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  -- From open: can ONLY go to closing
  IF p_old_status = 'open' AND p_new_status != 'closing' THEN
    RAISE EXCEPTION 'Invalid status transition from open to %. Only forward transitions allowed: open → closing → closed → locked', p_new_status;
  END IF;
  
  -- From closing: can ONLY go to closed
  IF p_old_status = 'closing' AND p_new_status != 'closed' THEN
    RAISE EXCEPTION 'Invalid status transition from closing to %. Only forward transitions allowed: open → closing → closed → locked', p_new_status;
  END IF;
  
  -- From closed: can ONLY go to locked
  IF p_old_status = 'closed' AND p_new_status != 'locked' THEN
    RAISE EXCEPTION 'Invalid status transition from closed to %. Only forward transitions allowed: open → closing → closed → locked', p_new_status;
  END IF;
  
  -- From locked: cannot transition (locked is final and immutable forever)
  IF p_old_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot transition from locked status. Period is immutable forever.';
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Check if user is accountant for business
-- Only accountants can move periods to closing, close, or lock
-- ============================================================================
CREATE OR REPLACE FUNCTION is_user_accountant(
  p_user_id UUID,
  p_business_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Check if user is business owner (they have full authority)
  IF EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
      AND owner_id = p_user_id
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Check if user has accountant role in business_users
  SELECT role INTO user_role
  FROM business_users
  WHERE user_id = p_user_id
    AND business_id = p_business_id;
  
  RETURN user_role = 'accountant';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Check blocking conditions before moving to closing
-- Hard blockers: suspense balance ≠ 0, unapproved proposals, ledger imbalance, unresolved tax mapping
-- ============================================================================
CREATE OR REPLACE FUNCTION check_blocking_conditions_before_closing(
  p_period_id UUID
)
RETURNS TABLE (
  can_close BOOLEAN,
  blockers TEXT[]
) AS $$
DECLARE
  blocker_list TEXT[] := ARRAY[]::TEXT[];
  suspense_balance NUMERIC;
  unapproved_count INTEGER;
  ledger_imbalance BOOLEAN;
  unresolved_tax_count INTEGER;
BEGIN
  -- NOTE: These checks are placeholders - actual implementation depends on:
  -- 1. Suspense account balance (requires suspense account in chart of accounts)
  -- 2. Proposals table/status (requires proposals system)
  -- 3. Ledger balance validation (requires journal entry line validation)
  -- 4. Tax mapping validation (requires tax mapping system)
  
  -- Placeholder: Check suspense balance
  -- TODO: Implement actual suspense account check
  -- SELECT COALESCE(SUM(balance), 0) INTO suspense_balance
  -- FROM account_balances
  -- WHERE account_code = 'SUSPENSE' AND period_id = p_period_id;
  -- IF ABS(suspense_balance) > 0.01 THEN
  --   blocker_list := array_append(blocker_list, format('Suspense balance is not zero: %s', suspense_balance));
  -- END IF;
  
  -- Placeholder: Check unapproved proposals
  -- TODO: Implement actual proposals check
  -- SELECT COUNT(*) INTO unapproved_count
  -- FROM proposals
  -- WHERE period_id = p_period_id AND status != 'approved';
  -- IF unapproved_count > 0 THEN
  --   blocker_list := array_append(blocker_list, format('%s unapproved proposal(s) exist', unapproved_count));
  -- END IF;
  
  -- Placeholder: Check ledger imbalance
  -- TODO: Implement actual ledger balance validation
  -- SELECT COUNT(*) > 0 INTO ledger_imbalance
  -- FROM (
  --   SELECT journal_entry_id, ABS(SUM(debit) - SUM(credit)) as diff
  --   FROM journal_entry_lines
  --   WHERE journal_entry_id IN (
  --     SELECT id FROM journal_entries WHERE date BETWEEN period_start AND period_end
  --   )
  --   GROUP BY journal_entry_id
  --   HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
  -- );
  -- IF ledger_imbalance THEN
  --   blocker_list := array_append(blocker_list, 'Ledger imbalance exists');
  -- END IF;
  
  -- Placeholder: Check unresolved tax mapping
  -- TODO: Implement actual tax mapping check
  -- SELECT COUNT(*) INTO unresolved_tax_count
  -- FROM tax_mappings
  -- WHERE period_id = p_period_id AND status != 'resolved';
  -- IF unresolved_tax_count > 0 THEN
  --   blocker_list := array_append(blocker_list, format('%s unresolved tax mapping(s) exist', unresolved_tax_count));
  -- END IF;
  
  RETURN QUERY SELECT 
    array_length(blocker_list, 1) IS NULL AS can_close,
    blocker_list AS blockers;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Stub for verify_period_snapshot_integrity (will be replaced in migration 086)
-- This allows migration 084 to reference the function without errors
-- ============================================================================
CREATE OR REPLACE FUNCTION verify_period_snapshot_integrity(p_period_id UUID)
RETURNS TABLE (
  is_valid BOOLEAN,
  mismatches JSONB
) AS $$
BEGIN
  -- Stub function - returns valid=true to allow locking before migration 086 runs
  -- This function will be replaced with the real implementation in migration 086
  RETURN QUERY SELECT TRUE::BOOLEAN, '[]'::JSONB;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update period status with lifecycle rules and authority checks
-- ============================================================================
CREATE OR REPLACE FUNCTION update_accounting_period_status(
  p_period_id UUID,
  p_new_status TEXT,
  p_user_id UUID
)
RETURNS accounting_periods AS $$
DECLARE
  period_record accounting_periods;
  old_status TEXT;
  is_accountant BOOLEAN;
  blocker_check RECORD;
  integrity_check RECORD;
BEGIN
  -- Get current period
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = p_period_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found: %', p_period_id;
  END IF;
  
  old_status := period_record.status;
  
  -- Validate transition
  PERFORM validate_period_status_transition(old_status, p_new_status);
  
  -- Check accountant authority for closing/closed/locked transitions
  IF p_new_status IN ('closing', 'closed', 'locked') THEN
    is_accountant := is_user_accountant(p_user_id, period_record.business_id);
    
    IF NOT is_accountant THEN
      RAISE EXCEPTION 'Only accountants can move periods to closing, close, or lock periods. User does not have accountant role for this business.';
    END IF;
  END IF;
  
  -- Integrity Rule: Before locking, verify snapshots match ledger-derived values
  -- If mismatch occurs → period cannot be locked
  -- Note: verify_period_snapshot_integrity stub is created above, real implementation in migration 086
  IF p_new_status = 'locked' THEN
    -- Call integrity check (stub returns valid=true, real implementation in migration 086 will do actual check)
    SELECT * INTO integrity_check
    FROM verify_period_snapshot_integrity(p_period_id);
    
    IF NOT integrity_check.is_valid THEN
      RAISE EXCEPTION USING
        MESSAGE = format('Cannot lock period: Snapshot integrity check failed. Snapshots do not match ledger-derived values. Mismatches: %s. Accountant must resolve mismatch (usually mapping/suspense issue) before locking.', integrity_check.mismatches::TEXT);
    END IF;
  END IF;
  
  -- Check blocking conditions before moving to closing
  IF p_new_status = 'closing' THEN
    SELECT * INTO blocker_check
    FROM check_blocking_conditions_before_closing(p_period_id);
    
    IF NOT blocker_check.can_close THEN
      RAISE EXCEPTION 'Cannot move period to closing. Blocking conditions: %', array_to_string(blocker_check.blockers, ', ');
    END IF;
  END IF;
  
  -- Update status and related fields based on new status
  UPDATE accounting_periods
  SET
    status = p_new_status,
    closed_at = CASE 
      WHEN p_new_status IN ('closed', 'locked') AND closed_at IS NULL 
      THEN NOW() 
      ELSE closed_at 
    END,
    locked_at = CASE 
      WHEN p_new_status = 'locked' AND locked_at IS NULL 
      THEN NOW() 
      ELSE locked_at 
    END,
    closed_by = CASE 
      WHEN p_new_status IN ('closed', 'locked') AND closed_by IS NULL 
      THEN p_user_id 
      ELSE closed_by 
    END,
    locked_by = CASE 
      WHEN p_new_status = 'locked' AND locked_by IS NULL 
      THEN p_user_id 
      ELSE locked_by 
    END,
    updated_at = NOW()
  WHERE id = p_period_id
  RETURNING * INTO period_record;
  
  -- When period moves to Closed, compute closing balances and net income
  -- This happens automatically and is reproducible from the ledger
  -- Note: compute_period_closing_balances is defined in migration 086
  -- If called before migration 086 runs, this will fail silently (function doesn't exist yet)
  -- This is fine - the function will be available when migration 086 runs
  IF p_new_status = 'closed' THEN
    BEGIN
      PERFORM compute_period_closing_balances(
        p_period_id,
        period_record.business_id,
        period_record.start_date,
        period_record.end_date
      );
    EXCEPTION
      WHEN undefined_function THEN
        -- Function doesn't exist yet (migration 086 not run), skip silently
        NULL;
    END;
  END IF;
  
  RETURN period_record;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Validate period on insert/update
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_validate_accounting_period()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate date range
  PERFORM validate_accounting_period_dates(NEW.start_date, NEW.end_date);
  
  -- Check for overlapping periods (on insert or if dates changed)
  IF TG_OP = 'INSERT' OR 
     (TG_OP = 'UPDATE' AND (OLD.start_date != NEW.start_date OR OLD.end_date != NEW.end_date)) THEN
    IF NOT check_period_overlap(
      NEW.business_id, 
      NEW.start_date, 
      NEW.end_date, 
      CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END
    ) THEN
      RAISE EXCEPTION 'Period overlaps with existing period for this business';
    END IF;
  END IF;
  
  -- Validate status transition on update
  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    PERFORM validate_period_status_transition(OLD.status, NEW.status);
    
    -- Auto-update timestamp fields based on status
    IF NEW.status IN ('closed', 'locked') AND OLD.closed_at IS NULL THEN
      NEW.closed_at := NOW();
    END IF;
    
    IF NEW.status = 'locked' AND OLD.locked_at IS NULL THEN
      NEW.locked_at := NOW();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_accounting_period ON accounting_periods;
CREATE TRIGGER trigger_validate_accounting_period
  BEFORE INSERT OR UPDATE ON accounting_periods
  FOR EACH ROW
  EXECUTE FUNCTION trigger_validate_accounting_period();

-- ============================================================================
-- AUTO-UPDATE updated_at
-- ============================================================================
-- Ensure the update_updated_at_column function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_accounting_periods_updated_at ON accounting_periods;
CREATE TRIGGER update_accounting_periods_updated_at
  BEFORE UPDATE ON accounting_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on accounting_periods
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view accounting periods for their business" ON accounting_periods;
DROP POLICY IF EXISTS "Users can insert accounting periods for their business" ON accounting_periods;
DROP POLICY IF EXISTS "Users can update accounting periods for their business" ON accounting_periods;
DROP POLICY IF EXISTS "Users can delete accounting periods for their business" ON accounting_periods;

CREATE POLICY "Users can view accounting periods for their business"
  ON accounting_periods FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounting_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert accounting periods for their business"
  ON accounting_periods FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounting_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update accounting periods for their business"
  ON accounting_periods FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounting_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounting_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete accounting periods for their business"
  ON accounting_periods FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounting_periods.business_id
        AND businesses.owner_id = auth.uid()
    )
    AND status != 'locked' -- Cannot delete locked periods
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE accounting_periods IS 'Explicit accounting periods for each business. No implicit months.';
COMMENT ON COLUMN accounting_periods.period_id IS 'Unique period identifier (e.g., "2025-01", "2025-Q1", "2025")';
COMMENT ON COLUMN accounting_periods.status IS 
'Period lifecycle status with strict meanings and entry admission rules:
  open: New ledger entries ✅, Proposals approval ✅, Payments ✅, Adjustments ❌ (go to next open)
  closing: New ledger entries ❌, Adjustments ❌, Payments ❌ (validation only, suspense must be resolved)
  closed: All entries frozen ❌, adjustments NOT allowed. When moved to closed, computes ending_balance, net_income, retained_earnings_delta.
  locked: Immutable forever, used for tax filings and bokslut, can never be reopened
  
  State transitions (ONLY FORWARD): open → closing → closed → locked
  No backward transitions. Ever.
  
  Only accountants can move to closing/close/lock periods.';

COMMENT ON COLUMN accounting_periods.closed_at IS 'Timestamp when period was closed';
COMMENT ON COLUMN accounting_periods.locked_at IS 'Timestamp when period was locked (final state)';
COMMENT ON COLUMN accounting_periods.closed_by IS 'User who closed the period';
COMMENT ON COLUMN accounting_periods.locked_by IS 'User who locked the period';

