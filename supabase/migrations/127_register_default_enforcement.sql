-- Migration: Register Default Enforcement
-- Adds is_default column and ensures exactly one default register per store

-- ============================================================================
-- STEP 1: Add is_default column to registers table
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'registers' AND column_name = 'is_default'
  ) THEN
    ALTER TABLE registers ADD COLUMN is_default BOOLEAN DEFAULT false NOT NULL;
    COMMENT ON COLUMN registers.is_default IS 'Indicates if this is the default register for the store. Exactly one default per store.';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create index for default register lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_registers_is_default_store ON registers(store_id, is_default) 
  WHERE is_default = true;

-- ============================================================================
-- STEP 3: Backfill existing data - set default register for each store
-- ============================================================================
DO $$
DECLARE
  store_record RECORD;
  default_register_id UUID;
BEGIN
  -- For each store (or business if store_id is null), find and set default register
  FOR store_record IN 
    SELECT DISTINCT COALESCE(store_id, business_id::text) as store_key, 
           store_id, 
           business_id
    FROM registers
    WHERE store_id IS NOT NULL OR business_id IS NOT NULL
  LOOP
    -- Find the earliest created register for this store
    -- If multiple exist, pick the one with "Main Register" name, otherwise earliest
    SELECT id INTO default_register_id
    FROM registers
    WHERE (store_record.store_id IS NOT NULL AND store_id = store_record.store_id)
       OR (store_record.store_id IS NULL AND business_id = store_record.business_id)
    ORDER BY 
      CASE WHEN name ILIKE '%main register%' THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1;
    
    -- Set this register as default
    IF default_register_id IS NOT NULL THEN
      UPDATE registers
      SET is_default = true
      WHERE id = default_register_id;
    END IF;
  END LOOP;
  
  -- Handle registers with NULL store_id (legacy data)
  -- Set default for each business that has registers without store_id
  FOR store_record IN 
    SELECT DISTINCT business_id
    FROM registers
    WHERE store_id IS NULL
  LOOP
    SELECT id INTO default_register_id
    FROM registers
    WHERE business_id = store_record.business_id
      AND store_id IS NULL
    ORDER BY 
      CASE WHEN name ILIKE '%main register%' THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1;
    
    IF default_register_id IS NOT NULL THEN
      UPDATE registers
      SET is_default = true
      WHERE id = default_register_id;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 4: Fix multiple defaults - ensure only one default per store
-- ============================================================================
DO $$
DECLARE
  store_record RECORD;
  default_count INTEGER;
  keep_default_id UUID;
BEGIN
  -- For each store, check if multiple defaults exist
  FOR store_record IN 
    SELECT DISTINCT COALESCE(store_id, business_id::text) as store_key, 
           store_id, 
           business_id
    FROM registers
    WHERE is_default = true
  LOOP
    -- Count defaults for this store
    SELECT COUNT(*) INTO default_count
    FROM registers
    WHERE is_default = true
      AND (
        (store_record.store_id IS NOT NULL AND store_id = store_record.store_id)
        OR (store_record.store_id IS NULL AND business_id = store_record.business_id)
      );
    
    -- If multiple defaults, keep the earliest created one
    IF default_count > 1 THEN
      SELECT id INTO keep_default_id
      FROM registers
      WHERE is_default = true
        AND (
          (store_record.store_id IS NOT NULL AND store_id = store_record.store_id)
          OR (store_record.store_id IS NULL AND business_id = store_record.business_id)
        )
      ORDER BY created_at ASC
      LIMIT 1;
      
      -- Clear other defaults
      UPDATE registers
      SET is_default = false
      WHERE is_default = true
        AND (
          (store_record.store_id IS NOT NULL AND store_id = store_record.store_id)
          OR (store_record.store_id IS NULL AND business_id = store_record.business_id)
        )
        AND id != keep_default_id;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 5: Create function to enforce single default per store
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_single_default_register()
RETURNS TRIGGER AS $$
DECLARE
  existing_default_id UUID;
BEGIN
  -- Only check if this register is being set as default
  IF NEW.is_default = true THEN
    -- Find existing default for the same store
    SELECT id INTO existing_default_id
    FROM registers
    WHERE is_default = true
      AND id != NEW.id
      AND (
        (NEW.store_id IS NOT NULL AND store_id = NEW.store_id)
        OR (NEW.store_id IS NULL AND business_id = NEW.business_id)
      )
    LIMIT 1;
    
    -- If another default exists, clear it
    IF existing_default_id IS NOT NULL THEN
      UPDATE registers
      SET is_default = false
      WHERE id = existing_default_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 6: Create trigger to enforce single default
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_enforce_single_default_register ON registers;
CREATE TRIGGER trigger_enforce_single_default_register
  BEFORE INSERT OR UPDATE ON registers
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_default_register();

-- ============================================================================
-- STEP 7: Add unique partial index to prevent multiple defaults per store
-- ============================================================================
-- Note: This is a soft constraint - the trigger handles enforcement
-- The index helps with performance and provides an additional safety net
-- For registers with store_id: one default per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_one_default_per_store 
  ON registers(store_id) 
  WHERE is_default = true AND store_id IS NOT NULL;

-- For registers without store_id (legacy): one default per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_registers_one_default_per_business
  ON registers(business_id)
  WHERE is_default = true AND store_id IS NULL;

