-- ============================================================================
-- Migration 369: Bill line-item account overrides + inventory material linkage
-- ============================================================================
-- Standard bills: each line item can post to a specific account (e.g. 1450
--   Service Materials Inventory) instead of the hardcoded 5200 expense account.
-- Import bills: the whole bill can link to a material so post_bill_to_ledger()
--   updates service_material_inventory automatically when the bill is posted.
-- ============================================================================

-- Standard bills: per-line account and material overrides
ALTER TABLE bill_items
  ADD COLUMN IF NOT EXISTS account_id  UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES service_material_inventory(id);

-- Import bills: bill-level material and quantity
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES service_material_inventory(id),
  ADD COLUMN IF NOT EXISTS quantity    NUMERIC DEFAULT 1;
