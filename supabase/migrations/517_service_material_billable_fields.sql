-- ============================================================================
-- Migration 517: Billable pricing fields on service materials (PR A)
-- Additive. Extends inventory rows with optional customer-facing sales metadata.
-- Does not add material_id to invoice/estimate/proforma line tables (PR C/D).
-- Also widens movement_type CHECK to include bill_receipt (used by bill posting).
-- ============================================================================

ALTER TABLE public.service_material_inventory
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_name TEXT,
  ADD COLUMN IF NOT EXISTS sales_description TEXT,
  ADD COLUMN IF NOT EXISTS default_selling_price NUMERIC,
  ADD COLUMN IF NOT EXISTS sales_unit TEXT,
  ADD COLUMN IF NOT EXISTS sales_tax_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_notes TEXT;

COMMENT ON COLUMN public.service_material_inventory.is_billable IS
  'When true, material may appear on quote/proforma/invoice pickers (PR B+). Does not affect stock.';
COMMENT ON COLUMN public.service_material_inventory.sales_name IS
  'Customer-facing line name; falls back to inventory name when null.';
COMMENT ON COLUMN public.service_material_inventory.sales_description IS
  'Customer-facing description snapshotted onto document lines.';
COMMENT ON COLUMN public.service_material_inventory.default_selling_price IS
  'Default unit sell price for customer documents. Not average_cost.';
COMMENT ON COLUMN public.service_material_inventory.sales_unit IS
  'Unit shown on customer documents; falls back to stock unit when null.';
COMMENT ON COLUMN public.service_material_inventory.sales_tax_code IS
  'Optional tax code hint (same pattern as service_catalog.tax_code).';
COMMENT ON COLUMN public.service_material_inventory.sales_notes IS
  'Internal notes about billable pricing (not printed on documents).';

-- bill_receipt is inserted by post_bill_to_ledger when bills link materials
ALTER TABLE public.service_material_movements
  DROP CONSTRAINT IF EXISTS service_material_movements_movement_type_check;

ALTER TABLE public.service_material_movements
  ADD CONSTRAINT service_material_movements_movement_type_check
  CHECK (movement_type IN ('purchase', 'adjustment', 'job_usage', 'return', 'bill_receipt'));
