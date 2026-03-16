-- ============================================================================
-- MIGRATION: Fix orders.customer_id to be nullable
-- ============================================================================
-- This migration makes customer_id nullable in the orders table.
-- 
-- Reason: Estimates may not always have a customer_id, and we use
-- ON DELETE SET NULL, which requires the column to be nullable.
-- ============================================================================

-- Make customer_id nullable
ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;



















