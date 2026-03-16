-- Migration: Add default expense categories support
-- This migration adds an is_default flag and seeds default categories for new businesses

-- Add is_default column to expense_categories table
ALTER TABLE expense_categories 
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

-- Create index for is_default column
CREATE INDEX IF NOT EXISTS idx_expense_categories_is_default ON expense_categories(is_default) WHERE is_default = true;

-- ============================================================================
-- FUNCTION: Seed default expense categories for a business
-- ============================================================================
CREATE OR REPLACE FUNCTION seed_default_expense_categories(business_uuid UUID)
RETURNS void AS $$
DECLARE
  default_categories TEXT[] := ARRAY[
    'Rent',
    'Utilities',
    'Office Supplies',
    'Transport / Fuel',
    'Marketing & Advertising',
    'Professional Services',
    'Repairs & Maintenance',
    'Equipment',
    'Insurance',
    'Internet & Phone',
    'Meals & Entertainment',
    'Miscellaneous'
  ];
  category_name TEXT;
BEGIN
  -- Only seed if business doesn't have any default categories yet
  IF NOT EXISTS (
    SELECT 1 FROM expense_categories 
    WHERE business_id = business_uuid AND is_default = true
  ) THEN
    -- Insert each default category
    FOREACH category_name IN ARRAY default_categories
    LOOP
      INSERT INTO expense_categories (business_id, name, is_default, created_at, updated_at)
      VALUES (business_uuid, category_name, true, NOW(), NOW())
      ON CONFLICT (business_id, name) DO NOTHING;
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Auto-seed default categories when business is created
-- Note: This will seed defaults for existing businesses on next category fetch
-- but we'll handle seeding in the API to ensure it happens when needed
-- ============================================================================

-- ============================================================================
-- Ensure existing businesses can still use custom categories
-- This migration does NOT modify or delete existing categories
-- ============================================================================













