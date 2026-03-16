-- ============================================================================
-- Migration 326: Auto-post ledger on service job material usage insert
-- ============================================================================
-- Ensures every insert into service_job_material_usage automatically posts
-- to the ledger (Dr 5110 Cost of Services, Cr 1450 Service Materials Inventory).
-- Idempotency is enforced inside post_service_job_material_usage_to_ledger
-- via reference_type 'service_job_usage' and reference_id = usage.id.
-- If posting fails (e.g. period closed, missing accounts), the trigger raises
-- and the whole transaction (including the usage insert) rolls back.
--
-- Application note: The usage insert should run in the same transaction as
-- the related service_material_inventory update and service_material_movements
-- insert so that a posting failure rolls back all three (no inventory drift).
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_service_job_material_usage_post_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM post_service_job_material_usage_to_ledger(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_service_job_material_usage_post_ledger() IS
  'Trigger: after insert on service_job_material_usage, posts to ledger via post_service_job_material_usage_to_ledger. Idempotency inside RPC. Fails transaction if posting fails.';

-- Only create trigger if table exists (e.g. service workspace migrations applied)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'service_job_material_usage'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_service_job_material_usage_post_ledger ON service_job_material_usage;
    CREATE TRIGGER trigger_service_job_material_usage_post_ledger
      AFTER INSERT ON service_job_material_usage
      FOR EACH ROW
      EXECUTE FUNCTION trg_service_job_material_usage_post_ledger();
  END IF;
END;
$$;
