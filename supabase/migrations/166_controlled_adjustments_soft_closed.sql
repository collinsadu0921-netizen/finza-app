-- ============================================================================
-- MIGRATION: Phase 6 - Controlled Adjustments in Soft-Closed Periods
-- ============================================================================
-- Allows ONLY explicitly permitted adjusting journal entries in soft_closed periods,
-- while keeping all normal postings blocked.
--
-- Rules:
-- 1. Regular postings (sales, invoices, expenses, etc.) → ONLY 'open' periods
-- 2. Adjustments → 'open' OR 'soft_closed' periods (with proper metadata)
-- 3. Locked periods → BLOCK all postings (hard error, no exceptions)
--
-- Enforcement: Multiple layers (function, trigger, metadata validation)
-- ============================================================================

-- ============================================================================
-- STEP 1: ADD ADJUSTMENT METADATA COLUMNS TO journal_entries
-- ============================================================================
-- Add columns to support adjustment identification and audit trail
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS is_adjustment BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_ref TEXT;

-- Add constraint: if is_adjustment = true, adjustment_reason must be provided
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_adjustment_reason_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_adjustment_reason_check
  CHECK (
    (is_adjustment = FALSE AND adjustment_reason IS NULL) OR
    (is_adjustment = TRUE AND adjustment_reason IS NOT NULL AND TRIM(adjustment_reason) != '')
  );

-- Add constraint: adjustments must have reference_type = 'adjustment'
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_adjustment_reference_type_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_adjustment_reference_type_check
  CHECK (
    (is_adjustment = FALSE) OR
    (is_adjustment = TRUE AND reference_type = 'adjustment')
  );

-- Add constraint: adjustments cannot have operational reference_types
-- This prevents disguising operational posts as adjustments
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_adjustment_no_operational_ref_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_adjustment_no_operational_ref_check
  CHECK (
    (is_adjustment = FALSE) OR
    (is_adjustment = TRUE AND reference_type = 'adjustment' AND reference_id IS NULL)
  );

-- Indexes for adjustment queries
CREATE INDEX IF NOT EXISTS idx_journal_entries_is_adjustment ON journal_entries(is_adjustment) WHERE is_adjustment = TRUE;
CREATE INDEX IF NOT EXISTS idx_journal_entries_adjustment_reason ON journal_entries(adjustment_reason) WHERE is_adjustment = TRUE;

COMMENT ON COLUMN journal_entries.is_adjustment IS 'PHASE 6: TRUE if this is an adjusting journal entry (allowed in soft_closed periods)';
COMMENT ON COLUMN journal_entries.adjustment_reason IS 'PHASE 6: Required non-empty text explaining why this adjustment was made';
COMMENT ON COLUMN journal_entries.adjustment_ref IS 'PHASE 6: Optional external ticket/audit reference for this adjustment';

-- ============================================================================
-- STEP 2: CREATE ADJUSTMENT AUDIT TABLE
-- ============================================================================
-- Audit trail for all adjustment entries (mandatory logging)
CREATE TABLE IF NOT EXISTS accounting_adjustment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  adjustment_reason TEXT NOT NULL,
  adjustment_ref TEXT,
  affected_accounts JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {account_code, account_name, debit, credit}
  total_debit NUMERIC NOT NULL DEFAULT 0,
  total_credit NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_adjustment_audit_business_id ON accounting_adjustment_audit(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustment_audit_period_id ON accounting_adjustment_audit(period_id);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustment_audit_journal_entry_id ON accounting_adjustment_audit(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustment_audit_actor_user_id ON accounting_adjustment_audit(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustment_audit_created_at ON accounting_adjustment_audit(created_at);

COMMENT ON TABLE accounting_adjustment_audit IS 'PHASE 6: Mandatory audit trail for all adjustment journal entries';
COMMENT ON COLUMN accounting_adjustment_audit.affected_accounts IS 'PHASE 6: JSONB array of affected accounts with amounts for audit trail';

-- ============================================================================
-- STEP 3: ENHANCED assert_accounting_period_is_open
-- ============================================================================
-- Updated to allow adjustments in soft_closed periods
-- Regular postings still blocked in soft_closed
-- 
-- Drop old 2-parameter version to avoid function overloading ambiguity
DROP FUNCTION IF EXISTS assert_accounting_period_is_open(UUID, DATE);

CREATE OR REPLACE FUNCTION assert_accounting_period_is_open(
  p_business_id UUID,
  p_date DATE,
  p_is_adjustment BOOLEAN DEFAULT FALSE
)
RETURNS VOID AS $$
DECLARE
  period_record accounting_periods;
BEGIN
  -- Resolve accounting period using ensure_accounting_period
  SELECT * INTO period_record
  FROM ensure_accounting_period(p_business_id, p_date);

  -- PHASE 6: Hard enforcement - block locked periods (always)
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Accounting period is locked (period_start: %). Posting is blocked for all entries including adjustments. Post an adjustment in a later open period.',
      period_record.period_start;
  END IF;

  -- PHASE 6: Allow adjustments in soft_closed periods
  IF period_record.status = 'soft_closed' THEN
    IF p_is_adjustment = TRUE THEN
      -- Adjustments allowed in soft_closed
      RETURN;
    ELSE
      -- Regular postings blocked in soft_closed
      RAISE EXCEPTION 'Accounting period is soft-closed (period_start: %). Regular postings are blocked. Only adjustments are allowed in soft-closed periods.',
        period_record.period_start;
    END IF;
  END IF;

  -- Only 'open' status allows all postings
  -- If status is 'open', function returns successfully (no action needed)
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_accounting_period_is_open IS 'PHASE 6: Enforces period status checks. Blocks regular postings into locked and soft_closed periods. Allows adjustments in soft_closed periods. Only open periods allow all postings. Hard error on violation.';

-- ============================================================================
-- STEP 4: ENHANCED post_journal_entry
-- ============================================================================
-- Updated to accept and validate adjustment context
-- Passes adjustment flag to period guard
-- 
-- Drop old 6-parameter version to avoid function overloading ambiguity
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
BEGIN
  -- PHASE 6: Validate adjustment metadata
  IF p_is_adjustment = TRUE THEN
    -- Adjustments must have reason
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    
    -- Adjustments must have reference_type = 'adjustment'
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    
    -- Adjustments must have reference_id = NULL
    IF p_reference_id IS NOT NULL THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL. Adjustments are standalone entries.';
    END IF;
  ELSE
    -- Non-adjustments cannot have adjustment metadata
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  -- PHASE 6: Hard guard - enforce period status check with adjustment context
  PERFORM assert_accounting_period_is_open(p_business_id, p_date, p_is_adjustment);

  -- Validate that debits equal credits
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry with adjustment metadata
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    created_by
  )
  VALUES (
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_created_by
  )
  RETURNING id INTO journal_id;

  -- Create journal entry lines with validation
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := (line->>'account_id')::UUID;
    
    -- Validate account_id is not NULL
    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account ID is NULL in journal entry line. Description: %', line->>'description';
    END IF;
    
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->>'debit')::NUMERIC, 0),
      COALESCE((line->>'credit')::NUMERIC, 0),
      line->>'description'
    );
  END LOOP;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry IS 'PHASE 6: Creates journal entry with period status validation and adjustment support. Enforces period must be open (or soft_closed for adjustments). Hard error if period is locked or if regular posting attempted in soft_closed.';

-- ============================================================================
-- STEP 5: ENHANCED validate_period_open_for_entry (Trigger function)
-- ============================================================================
-- Database-level guard: Allows adjustments in soft_closed, blocks regular entries
-- 
-- Drop old 2-parameter version to avoid function overloading ambiguity
DROP FUNCTION IF EXISTS validate_period_open_for_entry(UUID, DATE);

CREATE OR REPLACE FUNCTION validate_period_open_for_entry()
RETURNS TRIGGER AS $$
DECLARE
  period_record RECORD;
BEGIN
  -- Find the period that contains this date
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = NEW.business_id
    AND NEW.date >= period_start
    AND NEW.date <= period_end
  LIMIT 1;
  
  -- PHASE 6: Hard enforcement - period must exist
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No accounting period found for date %. Period must exist before posting. Business ID: %',
      NEW.date, NEW.business_id;
  END IF;
  
  -- PHASE 6: Hard enforcement - block locked periods (always)
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into locked period (period_start: %). Journal entries are blocked for locked periods. Period ID: %, Date: %',
      period_record.period_start, period_record.id, NEW.date;
  END IF;

  -- PHASE 6: Allow adjustments in soft_closed periods
  IF period_record.status = 'soft_closed' THEN
    IF COALESCE(NEW.is_adjustment, FALSE) = TRUE THEN
      -- Adjustments allowed in soft_closed
      -- Validate adjustment metadata
      IF NEW.adjustment_reason IS NULL OR TRIM(NEW.adjustment_reason) = '' THEN
        RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
      END IF;
      IF NEW.reference_type != 'adjustment' THEN
        RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', NEW.reference_type;
      END IF;
      IF NEW.reference_id IS NOT NULL THEN
        RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL';
      END IF;
      -- Allow the insert
      RETURN NEW;
    ELSE
      -- Regular postings blocked in soft_closed
      RAISE EXCEPTION 'Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked. Only adjustments are allowed in soft-closed periods. Period ID: %, Date: %',
        period_record.period_start, period_record.id, NEW.date;
    END IF;
  END IF;

  -- Only 'open' status allows all postings
  IF period_record.status != 'open' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into period with status ''%'' (period_start: %). Only periods with status ''open'' allow regular postings. Period ID: %, Date: %',
      period_record.status, period_record.period_start, period_record.id, NEW.date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_period_open_for_entry IS 'PHASE 6: Database-level guard for journal entry creation. Blocks regular entries into locked and soft_closed periods. Allows adjustments in soft_closed periods with proper metadata. Hard error on violation.';

-- Ensure trigger is active
DROP TRIGGER IF EXISTS trigger_enforce_period_state_on_entry ON journal_entries;
CREATE TRIGGER trigger_enforce_period_state_on_entry
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION validate_period_open_for_entry();

-- ============================================================================
-- STEP 6: ENHANCED apply_adjusting_journal
-- ============================================================================
-- Updated to allow soft_closed periods and set adjustment metadata
-- This is the adjustment-only creation path
-- Drop old 7-parameter version from migration 137 to avoid function overloading ambiguity
DROP FUNCTION IF EXISTS apply_adjusting_journal(UUID, DATE, DATE, TEXT, JSONB, UUID);

CREATE OR REPLACE FUNCTION apply_adjusting_journal(
  p_business_id UUID,
  p_period_start DATE,
  p_entry_date DATE,
  p_description TEXT,
  p_lines JSONB,
  p_created_by UUID,
  p_adjustment_reason TEXT,
  p_adjustment_ref TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_period RECORD;
  v_account RECORD;
  v_journal_entry_id UUID;
  v_line JSONB;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_line_count INTEGER := 0;
  v_affected_accounts JSONB := '[]'::jsonb;
  v_account_code TEXT;
  v_account_name TEXT;
  v_period_id UUID;
BEGIN
  -- ========================================================================
  -- VALIDATION 1: Period exists and status allows adjustments
  -- ========================================================================
  SELECT * INTO v_period
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = p_period_start;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found for period_start: %', p_period_start;
  END IF;

  v_period_id := v_period.id;

  -- PHASE 6: Allow adjustments in 'open' OR 'soft_closed' periods
  -- Block adjustments in 'locked' periods
  IF v_period.status = 'locked' THEN
    RAISE EXCEPTION 'Adjusting journals cannot be posted into locked periods. Period status: %.', v_period.status;
  END IF;

  IF v_period.status NOT IN ('open', 'soft_closed') THEN
    RAISE EXCEPTION 'Adjusting journals can only be posted into periods with status ''open'' or ''soft_closed''. Period status: %.', v_period.status;
  END IF;

  -- ========================================================================
  -- VALIDATION 2: entry_date must fall within period [period_start, period_end]
  -- ========================================================================
  IF p_entry_date < v_period.period_start OR p_entry_date > v_period.period_end THEN
    RAISE EXCEPTION 'Entry date % must fall within period [%, %]', p_entry_date, v_period.period_start, v_period.period_end;
  END IF;

  -- ========================================================================
  -- VALIDATION 3: adjustment_reason is required
  -- ========================================================================
  IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
    RAISE EXCEPTION 'Adjustment reason is required and cannot be empty';
  END IF;

  -- ========================================================================
  -- VALIDATION 4: At least 2 lines required
  -- ========================================================================
  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Adjusting journal must have at least 2 lines. Found: %', v_line_count;
  END IF;

  -- ========================================================================
  -- VALIDATION 5: Validate accounts and compute totals
  -- ========================================================================
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- Validate required fields
    IF NOT (v_line ? 'account_id') THEN
      RAISE EXCEPTION 'Each line must have an account_id';
    END IF;

    v_account_id := (v_line->>'account_id')::UUID;

    -- Validate account exists and belongs to business
    SELECT * INTO v_account
    FROM accounts
    WHERE id = v_account_id
      AND business_id = p_business_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found or does not belong to business: %', v_account_id;
    END IF;

    v_account_code := v_account.code;
    v_account_name := v_account.name;

    -- Validate amounts
    v_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);

    -- Exactly one of debit or credit must be > 0
    IF v_debit <= 0 AND v_credit <= 0 THEN
      RAISE EXCEPTION 'Each line must have either debit > 0 or credit > 0';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'Each line must have either debit OR credit, not both';
    END IF;

    -- Accumulate totals
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;

    -- Build affected accounts array for audit
    v_affected_accounts := v_affected_accounts || jsonb_build_object(
      'account_code', v_account_code,
      'account_name', v_account_name,
      'debit', v_debit,
      'credit', v_credit
    );
  END LOOP;

  -- ========================================================================
  -- VALIDATION 6: Debit/credit totals must balance exactly
  -- ========================================================================
  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Adjusting journal entry must balance. Debit: %, Credit: %, Difference: %', v_total_debit, v_total_credit, ABS(v_total_debit - v_total_credit);
  END IF;

  -- ========================================================================
  -- CREATE JOURNAL ENTRY (using enhanced post_journal_entry function)
  -- ========================================================================
  -- PHASE 6: Use adjustment-only path with proper metadata
  SELECT post_journal_entry(
    p_business_id,
    p_entry_date,
    p_description,
    'adjustment',  -- reference_type marks this as adjustment
    NULL,  -- reference_id is NULL (adjustments are standalone entries)
    p_lines,
    TRUE,  -- is_adjustment = TRUE
    p_adjustment_reason,  -- adjustment_reason (required)
    p_adjustment_ref,  -- adjustment_ref (optional)
    p_created_by  -- created_by
  ) INTO v_journal_entry_id;

  -- ========================================================================
  -- PHASE 6: MANDATORY AUDIT LOGGING
  -- ========================================================================
  INSERT INTO accounting_adjustment_audit (
    business_id,
    period_id,
    journal_entry_id,
    actor_user_id,
    adjustment_reason,
    adjustment_ref,
    affected_accounts,
    total_debit,
    total_credit
  )
  VALUES (
    p_business_id,
    v_period_id,
    v_journal_entry_id,
    p_created_by,
    p_adjustment_reason,
    p_adjustment_ref,
    v_affected_accounts,
    v_total_debit,
    v_total_credit
  );

  -- ========================================================================
  -- RETURN JOURNAL ENTRY ID
  -- ========================================================================
  RETURN v_journal_entry_id;

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise with context
    RAISE EXCEPTION 'Failed to apply adjusting journal: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION apply_adjusting_journal IS 'PHASE 6: Atomically validates and applies adjusting journal entry. Enforces period status = ''open'' or ''soft_closed'' (not locked), entry_date within period, account validation, balanced entry, minimum 2 lines, and required adjustment_reason. Creates new journal entry marked with is_adjustment=TRUE and reference_type=''adjustment''. Logs to accounting_adjustment_audit table. Adjustments are permanent and auditable.';

-- ============================================================================
-- STEP 7: VERIFICATION - Ensure operational postings cannot bypass guards
-- ============================================================================
-- All operational posting functions (post_sale_to_ledger, post_invoice_to_ledger, etc.)
-- call assert_accounting_period_is_open() WITHOUT the p_is_adjustment parameter
-- This means they default to FALSE, which blocks them in soft_closed periods
-- 
-- Only apply_adjusting_journal() can create adjustments, and it:
-- 1. Forces is_adjustment = TRUE
-- 2. Forces reference_type = 'adjustment'
-- 3. Requires adjustment_reason
-- 4. Prevents operational reference_types
--
-- This ensures no operational posting can be forced through by setting a flag
-- ============================================================================

-- ============================================================================
-- DOCUMENTATION: Period Status Posting Rules (Updated for Phase 6)
-- ============================================================================
-- Period Status | Regular Postings | Adjustments | Notes
-- --------------|------------------|-------------|------------------
-- open          | ✅ ALLOWED       | ✅ ALLOWED   | Normal operations
-- soft_closed   | ❌ BLOCKED       | ✅ ALLOWED   | Adjustments only (with metadata)
-- locked        | ❌ BLOCKED       | ❌ BLOCKED   | Immutable forever
--
-- Enforcement Layers:
-- 1. Application-level: assert_accounting_period_is_open() in posting functions
-- 2. Database-level: post_journal_entry() function guard
-- 3. Database trigger: validate_period_open_for_entry() on journal_entries INSERT
-- 4. Schema constraints: is_adjustment, adjustment_reason, reference_type checks
--
-- All layers must pass for posting to succeed.
-- ============================================================================
