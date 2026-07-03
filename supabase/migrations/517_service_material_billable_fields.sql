-- ============================================================================
-- Migration 517: Materials foundation — prices, stock metadata, movement types
-- Additive. Tenant UI uses cost/selling price; is_billable inferred from selling price.
-- Does not add material_id to customer document line tables (later PRs).
-- ============================================================================

ALTER TABLE public.service_material_inventory
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_cost_price NUMERIC,
  ADD COLUMN IF NOT EXISTS sales_name TEXT,
  ADD COLUMN IF NOT EXISTS sales_description TEXT,
  ADD COLUMN IF NOT EXISTS default_selling_price NUMERIC,
  ADD COLUMN IF NOT EXISTS sales_unit TEXT,
  ADD COLUMN IF NOT EXISTS sales_tax_code TEXT,
  ADD COLUMN IF NOT EXISTS sales_notes TEXT;

COMMENT ON COLUMN public.service_material_inventory.default_cost_price IS
  'Tenant-entered usual buy price. average_cost is calculated stock cost.';
COMMENT ON COLUMN public.service_material_inventory.is_billable IS
  'Inferred: true when default_selling_price is set. Used by future document pickers.';
COMMENT ON COLUMN public.service_material_inventory.sales_description IS
  'Customer-facing description for future quote/invoice lines.';
COMMENT ON COLUMN public.service_material_inventory.default_selling_price IS
  'Tenant-entered customer unit price. Not average_cost.';
COMMENT ON COLUMN public.service_material_inventory.sales_notes IS
  'Internal notes (tenant-facing "Notes").';

ALTER TABLE public.service_material_movements
  ADD COLUMN IF NOT EXISTS reason_code TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS movement_date DATE;

COMMENT ON COLUMN public.service_material_movements.reason_code IS
  'Tenant reason key e.g. bought_material, used_for_job.';
COMMENT ON COLUMN public.service_material_movements.note IS
  'Optional tenant note on manual stock actions.';
COMMENT ON COLUMN public.service_material_movements.movement_date IS
  'Optional tenant-selected date; defaults to created_at in UI.';

ALTER TABLE public.service_material_movements
  DROP CONSTRAINT IF EXISTS service_material_movements_movement_type_check;

ALTER TABLE public.service_material_movements
  ADD CONSTRAINT service_material_movements_movement_type_check
  CHECK (
    movement_type IN (
      'purchase',
      'adjustment',
      'job_usage',
      'return',
      'bill_receipt',
      'setup_stock',
      'stock_in',
      'stock_out',
      'write_off',
      'supplier_return'
    )
  );
