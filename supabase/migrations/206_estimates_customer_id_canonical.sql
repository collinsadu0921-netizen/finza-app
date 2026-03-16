-- Migration: Enforce customer_id as canonical column in estimates table
-- This migration aligns the database schema with the canonical model (customer_id, not client_id)
-- In dev mode, we enforce the canonical model without backward compatibility

-- ============================================================================
-- ESTIMATES TABLE: client_id -> customer_id
-- ============================================================================

DO $$
BEGIN
  -- Rename client_id to customer_id if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'estimates' AND column_name = 'client_id'
  ) THEN
    -- Drop old index if it exists
    DROP INDEX IF EXISTS idx_estimates_client_id;
    
    -- Rename column
    ALTER TABLE estimates RENAME COLUMN client_id TO customer_id;
    
    -- Create new index with canonical name
    CREATE INDEX IF NOT EXISTS idx_estimates_customer_id ON estimates(customer_id);
  END IF;
  
  -- If customer_id doesn't exist and client_id was already renamed, ensure customer_id exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'estimates' AND column_name = 'customer_id'
  ) THEN
    -- Add customer_id column if it doesn't exist (shouldn't happen, but defensive)
    ALTER TABLE estimates 
      ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
    
    -- Create index
    CREATE INDEX IF NOT EXISTS idx_estimates_customer_id ON estimates(customer_id);
  END IF;
END $$;

-- Ensure the index exists (idempotent)
CREATE INDEX IF NOT EXISTS idx_estimates_customer_id ON estimates(customer_id);
