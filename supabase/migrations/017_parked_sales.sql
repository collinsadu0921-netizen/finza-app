-- Create parked_sales table for temporarily saved sales
CREATE TABLE IF NOT EXISTS parked_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  cart_json jsonb NOT NULL,
  subtotal numeric NOT NULL,
  taxes numeric NOT NULL,
  total numeric NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_parked_sales_business_id ON parked_sales(business_id);
CREATE INDEX IF NOT EXISTS idx_parked_sales_cashier_id ON parked_sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_parked_sales_created_at ON parked_sales(created_at DESC);


