-- Fix products_stock foreign key issue
-- Run this BEFORE 030_ensure_multi_store_complete.sql if you get "products_variants does not exist" error
-- This safely drops the problematic foreign key constraint

-- Drop the foreign key constraint if it exists (using multiple possible names)
DO $$
BEGIN
  -- Try to drop common constraint names
  ALTER TABLE products_stock DROP CONSTRAINT IF EXISTS products_stock_variant_id_fkey;
EXCEPTION WHEN OTHERS THEN
  -- Ignore if constraint doesn't exist
  NULL;
END $$;

-- Alternative: Use dynamic SQL to find and drop any FK on variant_id
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'products_stock'::regclass
      AND contype = 'f'
      AND conkey::text LIKE '%variant_id%'
  ) LOOP
    BEGIN
      EXECUTE 'ALTER TABLE products_stock DROP CONSTRAINT ' || quote_ident(r.conname);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist, that's fine
  NULL;
END $$;



