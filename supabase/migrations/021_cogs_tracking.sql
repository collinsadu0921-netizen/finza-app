-- COGS (Cost of Goods Sold) and Gross Profit Tracking
-- Stage 28.5: Add cost_price and cogs to sale_items table

-- Add cost_price and cogs columns to sale_items table
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cogs numeric DEFAULT 0;

-- Add comment to document the fields
COMMENT ON COLUMN sale_items.cost_price IS 'Product cost price at time of sale (snapshot)';
COMMENT ON COLUMN sale_items.cogs IS 'Cost of Goods Sold = cost_price * qty';










