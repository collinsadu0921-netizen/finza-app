-- Ensure variant_id column exists in sale_items
-- This migration ensures the variant_id column exists even if 023_product_variants.sql wasn't run

-- Add variant_id if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sale_items' AND column_name = 'variant_id'
  ) THEN
    ALTER TABLE sale_items ADD COLUMN variant_id uuid;
    
    -- Add foreign key constraint if products_variants table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products_variants') THEN
      ALTER TABLE sale_items 
        ADD CONSTRAINT sale_items_variant_id_fkey 
        FOREIGN KEY (variant_id) REFERENCES products_variants(id) ON DELETE SET NULL;
    END IF;
    
    -- Create index
    CREATE INDEX IF NOT EXISTS idx_sale_items_variant_id ON sale_items(variant_id) WHERE variant_id IS NOT NULL;
    
    COMMENT ON COLUMN sale_items.variant_id IS 'Reference to products_variants if this sale item used a variant';
  END IF;
END $$;







