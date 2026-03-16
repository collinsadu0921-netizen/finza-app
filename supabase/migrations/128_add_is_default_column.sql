-- Quick migration to add is_default column to registers table
-- This is a minimal version that can be run immediately

-- Add is_default column if it doesn't exist
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

-- Backfill: Set first register as default for each store/business
DO $$
DECLARE
  store_record RECORD;
  default_register_id UUID;
BEGIN
  -- For each store, set the earliest register as default if none exists
  FOR store_record IN 
    SELECT DISTINCT store_id, business_id
    FROM registers
    WHERE store_id IS NOT NULL
  LOOP
    -- Check if any default exists for this store
    SELECT id INTO default_register_id
    FROM registers
    WHERE store_id = store_record.store_id
      AND is_default = true
    LIMIT 1;
    
    -- If no default exists, set the earliest one
    IF default_register_id IS NULL THEN
      SELECT id INTO default_register_id
      FROM registers
      WHERE store_id = store_record.store_id
      ORDER BY created_at ASC
      LIMIT 1;
      
      IF default_register_id IS NOT NULL THEN
        UPDATE registers
        SET is_default = true
        WHERE id = default_register_id;
      END IF;
    END IF;
  END LOOP;
  
  -- Handle registers without store_id (legacy)
  FOR store_record IN 
    SELECT DISTINCT business_id
    FROM registers
    WHERE store_id IS NULL
  LOOP
    SELECT id INTO default_register_id
    FROM registers
    WHERE business_id = store_record.business_id
      AND store_id IS NULL
      AND is_default = true
    LIMIT 1;
    
    IF default_register_id IS NULL THEN
      SELECT id INTO default_register_id
      FROM registers
      WHERE business_id = store_record.business_id
        AND store_id IS NULL
      ORDER BY created_at ASC
      LIMIT 1;
      
      IF default_register_id IS NOT NULL THEN
        UPDATE registers
        SET is_default = true
        WHERE id = default_register_id;
      END IF;
    END IF;
  END LOOP;
END $$;



