-- Create quick_keys table for POS quick access buttons
CREATE TABLE IF NOT EXISTS quick_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  display_name text,
  order_index integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  UNIQUE(business_id, product_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_quick_keys_business_id ON quick_keys(business_id);
CREATE INDEX IF NOT EXISTS idx_quick_keys_order_index ON quick_keys(business_id, order_index);


