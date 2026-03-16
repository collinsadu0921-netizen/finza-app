-- Create sale_items table to store individual items in each sale
CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,      -- snapshot of product name
  price numeric NOT NULL,  -- snapshot of product price
  qty int NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Enable RLS
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Enable read access for all users" ON sale_items FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON sale_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON sale_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON sale_items FOR DELETE USING (auth.uid() IS NOT NULL);


















