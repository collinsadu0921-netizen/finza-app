-- Migration: Customer 360 Enhancements
-- Adds customer notes, tags, and internal notes for service workspace
-- Part of Service Workspace Gap Audit - Tier 1, Item 1

-- ============================================================================
-- CUSTOMER NOTES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_notes_business_id ON customer_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_id ON customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_deleted_at ON customer_notes(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- ADD TAGS AND INTERNAL NOTES TO CUSTOMERS TABLE
-- ============================================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- Comments
COMMENT ON COLUMN customers.tags IS 'Array of customer tags (e.g., VIP, preferred, problematic)';
COMMENT ON COLUMN customers.internal_notes IS 'Internal notes about customer (not visible to customer)';
COMMENT ON TABLE customer_notes IS 'Customer relationship notes - chronological history of interactions';
