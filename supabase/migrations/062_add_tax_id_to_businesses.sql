-- Migration to add tax_id column to businesses table
-- This is an alias for 'tin' to maintain backward compatibility

DO $$
BEGIN
  -- Add tax_id column if it doesn't exist
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS tax_id TEXT;

  -- Copy data from tin to tax_id if tax_id is null
  UPDATE businesses
  SET tax_id = tin
  WHERE tax_id IS NULL AND tin IS NOT NULL;

  -- Create triggers to keep tax_id and tin in sync (bidirectional)
  DROP TRIGGER IF EXISTS sync_tax_id_on_tin_update ON businesses;
  DROP TRIGGER IF EXISTS sync_tin_on_tax_id_update ON businesses;
  
  -- Function to sync tax_id when tin changes
  CREATE OR REPLACE FUNCTION sync_tax_id_with_tin()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.tin IS DISTINCT FROM OLD.tin THEN
      NEW.tax_id := NEW.tin;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  -- Function to sync tin when tax_id changes
  CREATE OR REPLACE FUNCTION sync_tin_with_tax_id()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.tax_id IS DISTINCT FROM OLD.tax_id THEN
      NEW.tin := NEW.tax_id;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  -- Trigger: when tin is updated, update tax_id
  CREATE TRIGGER sync_tax_id_on_tin_update
    BEFORE UPDATE ON businesses
    FOR EACH ROW
    WHEN (NEW.tin IS DISTINCT FROM OLD.tin)
    EXECUTE FUNCTION sync_tax_id_with_tin();

  -- Trigger: when tax_id is updated, update tin
  CREATE TRIGGER sync_tin_on_tax_id_update
    BEFORE UPDATE ON businesses
    FOR EACH ROW
    WHEN (NEW.tax_id IS DISTINCT FROM OLD.tax_id)
    EXECUTE FUNCTION sync_tin_with_tax_id();
END $$;

