-- Migration: Add Document Revision Support
-- This migration adds revision tracking to estimates and orders tables
-- Enables immutable document versions with proper revision history

-- ============================================================================
-- ESTIMATES TABLE: Add Revision Support
-- ============================================================================

-- Add revision_number column (default 1 for existing records)
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

-- Add supersedes_id column (self-reference for revision chain)
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS supersedes_id UUID REFERENCES estimates(id) ON DELETE SET NULL;

-- Create index for revision lookups
CREATE INDEX IF NOT EXISTS idx_estimates_supersedes_id ON estimates(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_revision_number ON estimates(business_id, estimate_number, revision_number);

-- Backfill: Set revision_number = 1 for all existing estimates
UPDATE estimates
SET revision_number = 1
WHERE revision_number IS NULL OR revision_number = 0;

-- ============================================================================
-- ORDERS TABLE: Add Revision Support
-- ============================================================================

-- Add revision_number column (default 1 for existing records)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

-- Add supersedes_id column (self-reference for revision chain)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supersedes_id UUID REFERENCES orders(id) ON DELETE SET NULL;

-- Create index for revision lookups
CREATE INDEX IF NOT EXISTS idx_orders_supersedes_id ON orders(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_revision_number ON orders(business_id, revision_number);

-- Backfill: Set revision_number = 1 for all existing orders
UPDATE orders
SET revision_number = 1
WHERE revision_number IS NULL OR revision_number = 0;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN estimates.revision_number IS 'Revision number for this document version. Starts at 1. New revisions increment this number.';
COMMENT ON COLUMN estimates.supersedes_id IS 'ID of the previous revision this document supersedes. NULL for original documents.';
COMMENT ON COLUMN orders.revision_number IS 'Revision number for this document version. Starts at 1. New revisions increment this number.';
COMMENT ON COLUMN orders.supersedes_id IS 'ID of the previous revision this document supersedes. NULL for original documents.';
