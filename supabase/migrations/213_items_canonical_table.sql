-- ============================================================================
-- Phase 1 (Option B): Canonical Items Table — Foundation Only
-- ============================================================================
-- Introduces the canonical `items` model in parallel with existing
-- products / products_services. Read-only behavior; no application code
-- uses this table. No data migration, no triggers, no FKs from existing
-- tables.
--
-- See: UNIFIED_ITEM_MODEL_OPTION_B_SPEC.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service', 'product')),
  track_stock BOOLEAN NOT NULL DEFAULT false,
  source_table TEXT NOT NULL CHECK (source_table IN ('products', 'products_services')),
  source_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for tenant-scoped lookups and lineage resolution
CREATE INDEX IF NOT EXISTS idx_items_business_id ON items(business_id);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_table, source_id);
