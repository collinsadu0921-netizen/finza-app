-- ============================================================================
-- Migration 272: Business lifecycle for firm-created / claimed businesses
-- ============================================================================
-- Adds onboarding_status to businesses: pending_claim (no owner), active (claimed), archived.
-- Ensures default when NULL so firm-created businesses have a consistent state.
-- ============================================================================

-- Add column if not present (may exist from other migrations with different values)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'onboarding_status'
  ) THEN
    ALTER TABLE businesses
      ADD COLUMN onboarding_status TEXT DEFAULT 'active';
  END IF;
END $$;

-- Enforce allowed values (drop existing check if any, then add canonical)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'businesses' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%onboarding_status%'
  LOOP
    EXECUTE format('ALTER TABLE businesses DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_onboarding_status_check
  CHECK (onboarding_status IS NULL OR onboarding_status IN ('pending_claim', 'active', 'archived'));

-- Default NULL to canonical value based on owner
CREATE OR REPLACE FUNCTION set_business_onboarding_status_default()
RETURNS TRIGGER AS $$
BEGIN
  NEW.onboarding_status = COALESCE(NEW.onboarding_status,
    CASE WHEN NEW.owner_id IS NOT NULL THEN 'active' ELSE 'pending_claim' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_business_onboarding_status_default ON businesses;
CREATE TRIGGER trigger_set_business_onboarding_status_default
  BEFORE INSERT OR UPDATE OF owner_id, onboarding_status ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION set_business_onboarding_status_default();

COMMENT ON COLUMN businesses.onboarding_status IS
  'Lifecycle: pending_claim (no owner), active (claimed), archived.';
