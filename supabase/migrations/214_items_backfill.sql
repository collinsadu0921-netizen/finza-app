-- ============================================================================
-- Phase 1 Step 2 (Option B): Backfill items from products and products_services
-- ============================================================================
-- Populates the canonical items table from existing sources. Read-only
-- behavior; no application code changes. Idempotent: safe to rerun.
--
-- Prerequisite: 213_items_canonical_table.sql
-- ============================================================================

DO $$
DECLARE
  inserted_from_products BIGINT;
  inserted_from_services BIGINT;
BEGIN
  -- 1. Backfill from products
  INSERT INTO items (business_id, name, type, track_stock, source_table, source_id)
  SELECT
    p.business_id,
    p.name,
    'product',
    COALESCE(p.track_stock, true),
    'products',
    p.id
  FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM items i
    WHERE i.source_table = 'products' AND i.source_id = p.id
  );
  GET DIAGNOSTICS inserted_from_products = ROW_COUNT;

  -- 2. Backfill from products_services
  INSERT INTO items (business_id, name, type, track_stock, source_table, source_id)
  SELECT
    ps.business_id,
    ps.name,
    ps.type,
    false,
    'products_services',
    ps.id
  FROM products_services ps
  WHERE NOT EXISTS (
    SELECT 1 FROM items i
    WHERE i.source_table = 'products_services' AND i.source_id = ps.id
  );
  GET DIAGNOSTICS inserted_from_services = ROW_COUNT;

  RAISE NOTICE 'items backfill: % inserted from products, % from products_services', inserted_from_products, inserted_from_services;
END $$;
