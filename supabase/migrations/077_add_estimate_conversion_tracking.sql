-- Migration: Add Estimate Conversion Tracking
-- This migration adds a converted_to field to track what an estimate was converted to
-- Prevents multiple conversions from the same estimate

-- ============================================================================
-- ADD CONVERTED_TO FIELD TO ESTIMATES
-- ============================================================================

-- Add converted_to column to track what the estimate was converted to
-- Values: NULL (not converted), 'order' (converted to order), 'invoice' (converted to invoice)
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS converted_to TEXT CHECK (converted_to IN ('order', 'invoice'));

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_estimates_converted_to ON estimates(converted_to) WHERE converted_to IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN estimates.converted_to IS 'Tracks what the estimate was converted to: NULL = not converted, order = converted to order, invoice = converted to invoice. Prevents multiple conversions.';













