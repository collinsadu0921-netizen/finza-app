-- Migration: Separate Commercial State from Execution State in Orders
-- This migration introduces proper separation between commercial agreement (status) 
-- and fulfillment progress (execution_status) for orders

-- ============================================================================
-- ORDERS TABLE: Add execution_status and update status to commercial states
-- ============================================================================

-- Add execution_status column (fulfillment progress)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS execution_status TEXT DEFAULT 'pending' 
  CHECK (execution_status IN ('pending', 'active', 'completed'));

-- Drop old status constraint BEFORE updating data (so we can set 'issued' and 'converted')
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

-- Update existing orders: Map current status to execution_status
-- pending/active/completed -> execution_status
-- Then set status to 'issued' (they were already issued/commercial)
DO $$
BEGIN
  -- Orders with status 'pending' -> execution_status 'pending', status 'issued'
  UPDATE orders
  SET execution_status = 'pending',
      status = 'issued'
  WHERE status = 'pending';

  -- Orders with status 'active' -> execution_status 'active', status 'issued'
  UPDATE orders
  SET execution_status = 'active',
      status = 'issued'
  WHERE status = 'active';

  -- Orders with status 'completed' -> execution_status 'completed', status 'issued'
  UPDATE orders
  SET execution_status = 'completed',
      status = 'issued'
  WHERE status = 'completed';

  -- Orders with status 'invoiced' -> status 'converted' (terminal commercial state)
  UPDATE orders
  SET status = 'converted',
      execution_status = COALESCE(execution_status, 'completed')
  WHERE status = 'invoiced';

  -- New orders should start as 'draft' with execution_status 'pending'
  -- (This is handled by default values, but ensure existing drafts are correct)
  UPDATE orders
  SET execution_status = 'pending'
  WHERE status NOT IN ('issued', 'converted', 'cancelled') 
    AND execution_status IS NULL;
END $$;

-- Add new constraint for commercial states (after data migration is complete)
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('draft', 'issued', 'converted', 'cancelled'));

-- Create index for execution_status lookups
CREATE INDEX IF NOT EXISTS idx_orders_execution_status ON orders(execution_status) WHERE execution_status IS NOT NULL;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN orders.status IS 'Commercial state: draft (editable), issued (immutable commercial agreement), converted (to invoice), cancelled. Controls editability and billing.';
COMMENT ON COLUMN orders.execution_status IS 'Execution/fulfillment state: pending (not started), active (in progress), completed (fulfilled). Tracks fulfillment progress independently from commercial agreement.';
