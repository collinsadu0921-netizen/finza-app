-- Migration: Add confirmation metadata columns to orders table
-- These columns track when order confirmations are sent to customers

-- ============================================================================
-- ADD CONFIRMATION METADATA COLUMNS TO ORDERS TABLE
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS confirmation_sent_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS confirmation_sent_via TEXT;

-- Add index for confirmation_sent_at queries
CREATE INDEX IF NOT EXISTS idx_orders_confirmation_sent_at ON orders(confirmation_sent_at) WHERE confirmation_sent_at IS NOT NULL;

-- Add comments
COMMENT ON COLUMN orders.confirmation_sent_at IS 'Timestamp when order confirmation was sent to customer. NULL if not sent.';
COMMENT ON COLUMN orders.confirmation_sent_by IS 'User ID who sent the order confirmation. NULL if not sent or sent by system.';
COMMENT ON COLUMN orders.confirmation_sent_via IS 'Method used to send order confirmation: whatsapp, email, or link. NULL if not sent.';
