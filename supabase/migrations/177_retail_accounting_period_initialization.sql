-- ============================================================================
-- MIGRATION: Track C1.6 - Initial Accounting Period Creation
-- ============================================================================
-- Provides explicit, idempotent initialization for businesses to ensure
-- at least one accounting period exists for Retail onboarding completion.
--
-- This is a ONE-TIME initialization capability, NOT runtime logic.
-- Function must be called explicitly - does NOT auto-run during posting.
--
-- Rules:
-- - Checks if ANY accounting period exists for the business
-- - If YES → returns safely (idempotent)
-- - If NO → creates ONE period for the current month (defaults to today)
-- - Does NOT create future periods
-- - Does NOT modify existing periods
-- - Default start date is CURRENT_DATE (today)
-- ============================================================================

-- ============================================================================
-- FUNCTION: Initialize Business Accounting Period
-- ============================================================================
-- One-time bootstrap function to ensure a business has at least one
-- accounting period. Called during Retail onboarding finalization.
--
-- Behavior:
-- 1. Checks if ANY accounting period exists for the business
--    - If YES → returns safely (idempotent)
-- 2. If NO:
--    - period_start = date_trunc('month', p_start_date)
--    - period_end = last day of that month
--    - status = 'open'
-- 3. Creates exactly ONE period
-- 4. Does NOT create future periods
-- 5. Does NOT modify existing periods
--
-- Why Retail onboarding creates a default accounting period:
-- - Retail businesses need at least one open period to post sales
-- - Future UI can manage periods (close, lock, create new ones)
-- - Posting still enforces period locking via assert_accounting_period_is_open
--
-- Usage:
--   SELECT initialize_business_accounting_period(business_id);
--   SELECT initialize_business_accounting_period(business_id, '2025-01-15'::DATE);
--
CREATE OR REPLACE FUNCTION initialize_business_accounting_period(
  p_business_id UUID,
  p_start_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID AS $$
DECLARE
  period_exists BOOLEAN;
  period_start_date DATE;
  period_end_date DATE;
BEGIN
  -- Guard: Business must exist
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  -- STEP 1: Check if ANY accounting period exists for the business
  SELECT EXISTS (
    SELECT 1 
    FROM accounting_periods 
    WHERE business_id = p_business_id
  ) INTO period_exists;

  -- STEP 2: If period exists, return safely (idempotent)
  IF period_exists THEN
    RETURN;
  END IF;

  -- STEP 3: No period exists - create ONE for the current month
  -- Resolve month from p_start_date
  period_start_date := DATE_TRUNC('month', p_start_date)::DATE;
  period_end_date := (DATE_TRUNC('month', p_start_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Insert ONE period with status = 'open'
  INSERT INTO accounting_periods (
    business_id,
    period_start,
    period_end,
    status
  ) VALUES (
    p_business_id,
    period_start_date,
    period_end_date,
    'open'
  );

  -- Log completion (informational only)
  RAISE NOTICE 'Business accounting period initialized: business_id=%, period_start=%, period_end=%', 
    p_business_id, period_start_date, period_end_date;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION initialize_business_accounting_period IS 
  'TRACK C1.6: One-time bootstrap function to ensure a business has at least one accounting period. Checks if ANY period exists for the business. If NO, creates ONE period for the current month (defaults to today). Idempotent - safe to call multiple times. Does NOT create future periods or modify existing periods. Used during Retail onboarding finalization to guarantee at least one open period exists. Future UI can manage periods (close, lock, create new ones). Posting still enforces period locking via assert_accounting_period_is_open.';
