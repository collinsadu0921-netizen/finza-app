-- Ensure COGS column exists in sale_items
-- This migration ensures the cogs column exists even if 021_cogs_tracking.sql wasn't run

-- Add cost_price if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sale_items' AND column_name = 'cost_price'
  ) THEN
    ALTER TABLE sale_items ADD COLUMN cost_price numeric DEFAULT 0;
    COMMENT ON COLUMN sale_items.cost_price IS 'Product cost price at time of sale (snapshot)';
  END IF;
END $$;

-- Add cogs if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sale_items' AND column_name = 'cogs'
  ) THEN
    ALTER TABLE sale_items ADD COLUMN cogs numeric DEFAULT 0;
    COMMENT ON COLUMN sale_items.cogs IS 'Cost of Goods Sold = cost_price * qty';
  END IF;
END $$;







