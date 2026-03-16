-- Add VAT type to categories table
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS vat_type text DEFAULT 'standard' CHECK (vat_type IN ('standard', 'zero', 'exempt'));


















