-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 1B Finalization (Integrity)
-- ============================================================================
-- Adds hard database constraints for accounting period integrity
-- 
-- 1. Exclusion constraint to prevent overlapping periods per business
-- 2. Trigger to enforce valid month boundaries (complements CHECK constraints)
--
-- Scope: Accounting Mode ONLY
-- No new concepts, no new statuses, no Service Mode changes
-- ============================================================================

-- ============================================================================
-- STEP 1: ENABLE BTREE_GIST EXTENSION (Required for exclusion constraints)
-- ============================================================================
-- This extension allows exclusion constraints on date ranges
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- STEP 2: EXCLUSION CONSTRAINT - Prevent overlapping periods
-- ============================================================================
-- Ensures no two periods for the same business_id can overlap in date range
-- Applies regardless of status (open, soft_closed, locked)
-- Uses GIST index for efficient range queries

-- Drop existing constraint if it exists
ALTER TABLE accounting_periods DROP CONSTRAINT IF EXISTS exclude_overlapping_periods CASCADE;

-- Create exclusion constraint using EXCLUDE syntax
-- This prevents ANY overlap: [period_start, period_end] cannot overlap with any other period
-- for the same business_id
ALTER TABLE accounting_periods
ADD CONSTRAINT exclude_overlapping_periods
EXCLUDE USING GIST (
  business_id WITH =,
  daterange(period_start, period_end, '[]') WITH &&
);

-- Add comment
COMMENT ON CONSTRAINT exclude_overlapping_periods ON accounting_periods IS
'Exclusion constraint: Prevents overlapping accounting periods for the same business. Enforces that no two periods can have overlapping date ranges regardless of status.';

-- ============================================================================
-- STEP 3: TRIGGER - Enforce valid month boundaries
-- ============================================================================
-- Complements existing CHECK constraints with trigger validation
-- Validates:
-- - period_start is first day of month
-- - period_end is last day of same month
-- - period_start <= period_end
--
-- Note: This is a LIGHT trigger - validates dates only, NOT status transitions

CREATE OR REPLACE FUNCTION trigger_validate_accounting_period_month_boundaries()
RETURNS TRIGGER AS $$
DECLARE
  first_day_of_month DATE;
  last_day_of_month DATE;
BEGIN
  -- Validate period_start is first day of month
  first_day_of_month := DATE_TRUNC('month', NEW.period_start)::DATE;
  IF NEW.period_start != first_day_of_month THEN
    RAISE EXCEPTION 'period_start must be the first day of the month. Expected: %, Got: %',
      first_day_of_month, NEW.period_start;
  END IF;

  -- Validate period_end is last day of same month
  last_day_of_month := (DATE_TRUNC('month', NEW.period_start) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  IF NEW.period_end != last_day_of_month THEN
    RAISE EXCEPTION 'period_end must be the last day of the same month as period_start. Expected: %, Got: %',
      last_day_of_month, NEW.period_end;
  END IF;

  -- Validate period_start <= period_end (defensive check, should be impossible given above)
  IF NEW.period_start > NEW.period_end THEN
    RAISE EXCEPTION 'period_start (%) cannot be after period_end (%)',
      NEW.period_start, NEW.period_end;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_validate_accounting_period_month_boundaries ON accounting_periods;

-- Create trigger BEFORE INSERT OR UPDATE
CREATE TRIGGER trigger_validate_accounting_period_month_boundaries
  BEFORE INSERT OR UPDATE ON accounting_periods
  FOR EACH ROW
  EXECUTE FUNCTION trigger_validate_accounting_period_month_boundaries();

-- Comments
COMMENT ON FUNCTION trigger_validate_accounting_period_month_boundaries() IS
'Trigger: Enforces valid month boundaries for accounting periods. Validates period_start is first day of month, period_end is last day of same month, and period_start <= period_end. Does NOT validate status transitions.';
