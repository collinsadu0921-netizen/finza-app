-- ============================================================================
-- MIGRATION: Create Orders and Order Items Tables
-- ============================================================================
-- This migration adds the orders and order_items tables to support the
-- Estimate → Order → Invoice workflow in Service and Professional modes.
-- 
-- The structure matches the existing invoice_items and estimate_items tables
-- for consistency.
-- 
-- IDEMPOTENT: This migration is safe to run multiple times. If tables
-- already exist, they will be skipped.
-- ============================================================================

-- Migration is idempotent - all CREATE statements use IF NOT EXISTS checks
-- Safe to run multiple times

-- ============================================================================
-- ORDERS TABLE
-- ============================================================================
-- This migration is idempotent - safe to run multiple times
-- If tables already exist, they will be skipped
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'orders'
  ) THEN
    CREATE TABLE orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,
      invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'invoiced', 'cancelled')),
      subtotal NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_tax NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

-- Indexes for orders
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_estimate_id ON orders(estimate_id);
CREATE INDEX IF NOT EXISTS idx_orders_invoice_id ON orders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_business_id_created_at ON orders(business_id, created_at);

-- ============================================================================
-- ORDER_ITEMS TABLE
-- ============================================================================
-- Structure matches estimate_items and invoice_items for consistency
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'order_items'
  ) THEN
    CREATE TABLE order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity NUMERIC(18,3) NOT NULL DEFAULT 1,
      unit_price NUMERIC(18,2) NOT NULL DEFAULT 0,
      line_total NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

-- Indexes for order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_service_id ON order_items(product_service_id);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'orders'
  ) THEN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'order_items'
  ) THEN
    ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ============================================================================
-- RLS POLICIES - ORDERS
-- ============================================================================
DROP POLICY IF EXISTS "Users can view orders for their business" ON orders;
CREATE POLICY "Users can view orders for their business" ON orders
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert orders for their business" ON orders;
CREATE POLICY "Users can insert orders for their business" ON orders
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update orders for their business" ON orders;
CREATE POLICY "Users can update orders for their business" ON orders
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete orders for their business" ON orders;
CREATE POLICY "Users can delete orders for their business" ON orders
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - ORDER_ITEMS
-- ============================================================================
DROP POLICY IF EXISTS "Users can view order items for their business orders" ON order_items;
CREATE POLICY "Users can view order items for their business orders" ON order_items
  FOR SELECT USING (
    order_id IN (
      SELECT id FROM orders 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert order items for their business orders" ON order_items;
CREATE POLICY "Users can insert order items for their business orders" ON order_items
  FOR INSERT WITH CHECK (
    order_id IN (
      SELECT id FROM orders 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update order items for their business orders" ON order_items;
CREATE POLICY "Users can update order items for their business orders" ON order_items
  FOR UPDATE USING (
    order_id IN (
      SELECT id FROM orders 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete order items for their business orders" ON order_items;
CREATE POLICY "Users can delete order items for their business orders" ON order_items
  FOR DELETE USING (
    order_id IN (
      SELECT id FROM orders 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================
-- Ensure the update_updated_at_column function exists (create if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at on orders and order_items
DO $$ 
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'orders'
  ) THEN
    DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
    CREATE TRIGGER update_orders_updated_at 
      BEFORE UPDATE ON orders 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'order_items'
  ) THEN
    DROP TRIGGER IF EXISTS update_order_items_updated_at ON order_items;
    CREATE TRIGGER update_order_items_updated_at 
      BEFORE UPDATE ON order_items 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

