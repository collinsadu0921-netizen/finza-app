-- Migration: Add source tracking to invoices for document lineage
-- This allows invoices to track their origin (e.g., created from order, estimate)

-- Add source_type and source_id columns to invoices table
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_type TEXT CHECK (source_type IN ('order', 'estimate', NULL)),
  ADD COLUMN IF NOT EXISTS source_id UUID;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(source_type, source_id) 
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN invoices.source_type IS 'Type of source document (order, estimate, etc.)';
COMMENT ON COLUMN invoices.source_id IS 'ID of the source document';













