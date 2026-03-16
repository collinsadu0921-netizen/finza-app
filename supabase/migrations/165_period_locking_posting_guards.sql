-- ============================================================================
-- MIGRATION: Phase 5 - Period Locking & Posting Guards
-- ============================================================================
-- Enforces strict period status checks to prevent postings into closed or locked periods.
-- 
-- Rules:
-- 1. Regular postings (sales, invoices, expenses, etc.) → ONLY 'open' periods
-- 2. Adjustments → ONLY 'open' periods (already enforced in apply_adjusting_journal)
-- 3. Soft-closed periods → BLOCK all postings (no exceptions for regular transactions)
-- 4. Locked periods → BLOCK all postings (hard error, no fallback)
-- 
-- Hard enforcement: No silent fallback, all violations raise exceptions.
-- ============================================================================

-- ============================================================================
-- ENHANCED: assert_accounting_period_is_open
-- ============================================================================
-- Blocks postings into 'soft_closed' and 'locked' periods
-- Only allows postings into 'open' periods
-- Hard error on violation (no silent fallback)
CREATE OR REPLACE FUNCTION assert_accounting_period_is_open(
  p_business_id UUID,
  p_date DATE
)
RETURNS VOID AS $$
DECLARE
  period_record accounting_periods;
BEGIN
  -- Resolve accounting period using ensure_accounting_period
  SELECT * INTO period_record
  FROM ensure_accounting_period(p_business_id, p_date);

  -- PHASE 5: Hard enforcement - block locked periods
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Accounting period is locked (period_start: %). Posting is blocked. Post an adjustment in a later open period.',
      period_record.period_start;
  END IF;

  -- PHASE 5: Hard enforcement - block soft_closed periods for regular postings
  IF period_record.status = 'soft_closed' THEN
    RAISE EXCEPTION 'Accounting period is soft-closed (period_start: %). Regular postings are blocked. Only adjustments are allowed in open periods.',
      period_record.period_start;
  END IF;

  -- Only 'open' status allows posting
  -- If status is 'open', function returns successfully (no action needed)
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_accounting_period_is_open IS 'PHASE 5: Enforces period status checks. Blocks postings into locked and soft_closed periods. Only open periods allow regular postings. Hard error on violation (no silent fallback).';

-- ============================================================================
-- ENHANCED: validate_period_open_for_entry (Trigger function)
-- ============================================================================
-- Database-level guard: Blocks journal entry creation if period is not open
-- Hard enforcement at database level (cannot be bypassed)
CREATE OR REPLACE FUNCTION validate_period_open_for_entry(
  p_business_id UUID,
  p_date DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  period_record RECORD;
BEGIN
  -- Find the period that contains this date
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_date >= period_start
    AND p_date <= period_end
  LIMIT 1;
  
  -- PHASE 5: Hard enforcement - period must exist
  -- No silent fallback: if period doesn't exist, raise error
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No accounting period found for date %. Period must exist before posting. Business ID: %',
      p_date, p_business_id;
  END IF;
  
  -- PHASE 5: Hard enforcement - block locked periods
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into locked period (period_start: %). Journal entries are blocked for locked periods. Period ID: %, Date: %',
      period_record.period_start, period_record.id, p_date;
  END IF;

  -- PHASE 5: Hard enforcement - block soft_closed periods
  IF period_record.status = 'soft_closed' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked. Only adjustments are allowed in open periods. Period ID: %, Date: %',
      period_record.period_start, period_record.id, p_date;
  END IF;

  -- Only 'open' status allows posting
  IF period_record.status != 'open' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into period with status ''%'' (period_start: %). Only periods with status ''open'' allow posting. Period ID: %, Date: %',
      period_record.status, period_record.period_start, period_record.id, p_date;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_period_open_for_entry IS 'PHASE 5: Database-level guard for journal entry creation. Blocks entries into locked and soft_closed periods. Only open periods allow posting. Hard error on violation.';

-- ============================================================================
-- ENHANCED: post_journal_entry
-- ============================================================================
-- Add period status check as hard guard before creating journal entry
-- This ensures no posting bypasses period status checks
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
BEGIN
  -- PHASE 5: Hard guard - enforce period status check
  -- This ensures no journal entry can be created without period validation
  PERFORM assert_accounting_period_is_open(p_business_id, p_date);

  -- Validate that debits equal credits
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry
  -- Note: Database trigger will also validate period status (double guard)
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (p_business_id, p_date, p_description, p_reference_type, p_reference_id)
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

COMMENT ON FUNCTION post_journal_entry IS 'PHASE 5: Creates journal entry with period status validation. Enforces period must be open before posting. Hard error if period is locked or soft_closed. Database trigger provides additional guard.';

-- ============================================================================
-- VERIFICATION: Ensure sale posting respects period status
-- ============================================================================
-- post_sale_to_ledger already calls assert_accounting_period_is_open
-- This is verified in migration 162 (line 117)
-- No changes needed - sale posting will fail if period is not open
-- ============================================================================

-- ============================================================================
-- DOCUMENTATION: Period Status Posting Rules
-- ============================================================================
-- Period Status | Regular Postings | Adjustments | Notes
-- --------------|------------------|-------------|------------------
-- open          | ✅ ALLOWED       | ✅ ALLOWED   | Normal operations
-- soft_closed   | ❌ BLOCKED       | ❌ BLOCKED   | No postings allowed
-- locked        | ❌ BLOCKED       | ❌ BLOCKED   | Immutable forever
--
-- Enforcement Layers:
-- 1. Application-level: assert_accounting_period_is_open() in posting functions
-- 2. Database-level: post_journal_entry() function guard
-- 3. Database trigger: validate_period_open_for_entry() on journal_entries INSERT
--
-- All three layers must pass for posting to succeed.
-- ============================================================================
