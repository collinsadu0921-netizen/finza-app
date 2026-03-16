-- Migration: Add issued_at column to orders table
-- This column tracks when an order was issued (moved from draft to issued status)

-- ============================================================================
-- ADD issued_at COLUMN TO ORDERS TABLE
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP WITH TIME ZONE;

-- Add index for issued_at queries
CREATE INDEX IF NOT EXISTS idx_orders_issued_at ON orders(issued_at) WHERE issued_at IS NOT NULL;

-- Add comment
COMMENT ON COLUMN orders.issued_at IS 'Timestamp when order was issued (moved from draft to issued status). NULL for draft orders.';
