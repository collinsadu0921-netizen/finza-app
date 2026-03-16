-- ============================================================================
-- Migration 327: Material usage status + post ledger only when consumed
-- ============================================================================
-- Phase 0 adjustment: posting happens when status becomes 'consumed', not on insert.
-- - Add status column: allocated (default) | consumed | returned
-- - Remove AFTER INSERT trigger
-- - Add AFTER UPDATE OF status trigger when NEW.status = 'consumed'
-- ============================================================================

-- 1. Add status column to service_job_material_usage
ALTER TABLE service_job_material_usage
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'allocated'
    CHECK (status IN ('allocated', 'consumed', 'returned'));

COMMENT ON COLUMN service_job_material_usage.status IS
  'allocated = reserved for job (no ledger); consumed = actually used (posts to ledger); returned = allocation cancelled (no ledger).';

-- 2. Drop the INSERT trigger (from migration 326)
DROP TRIGGER IF EXISTS trigger_service_job_material_usage_post_ledger ON service_job_material_usage;

-- 3. Trigger function: post to ledger only when status becomes 'consumed'
CREATE OR REPLACE FUNCTION trg_service_job_material_usage_post_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only post when status transitions to consumed
  IF NEW.status = 'consumed' THEN
    PERFORM post_service_job_material_usage_to_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_service_job_material_usage_post_ledger() IS
  'Trigger: after update of status on service_job_material_usage, when NEW.status = consumed, posts to ledger. Idempotency inside RPC.';

-- 4. Create trigger: AFTER UPDATE OF status, when NEW.status = 'consumed'
CREATE TRIGGER trigger_service_job_material_usage_post_ledger
  AFTER UPDATE OF status ON service_job_material_usage
  FOR EACH ROW
  WHEN (NEW.status = 'consumed')
  EXECUTE FUNCTION trg_service_job_material_usage_post_ledger();
