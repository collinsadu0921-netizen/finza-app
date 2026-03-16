-- ============================================================================
-- Phase 1 Step 3 (Option B): Harden items table integrity
-- ============================================================================
-- Adds UNIQUE on (source_table, source_id) and CHECK for service => !track_stock.
-- No data modification, no triggers, no changes to legacy tables.
--
-- Prerequisite: 213_items_canonical_table.sql, 214_items_backfill.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UNIQUE (source_table, source_id) — one item per source row
-- ----------------------------------------------------------------------------
ALTER TABLE items
  ADD CONSTRAINT items_source_unique UNIQUE (source_table, source_id);

-- ----------------------------------------------------------------------------
-- 2. CHECK: service items must have track_stock = false
-- ----------------------------------------------------------------------------
-- Add as NOT VALID to avoid blocking; then validate (existing backfill obeys this).
ALTER TABLE items
  ADD CONSTRAINT items_service_no_stock CHECK (
    (type <> 'service') OR (track_stock = false)
  ) NOT VALID;

ALTER TABLE items VALIDATE CONSTRAINT items_service_no_stock;

-- ----------------------------------------------------------------------------
-- 3. type ∈ ('service', 'product') — already enforced by 213 inline CHECK
--    No additional constraint needed.
--
-- ----------------------------------------------------------------------------
-- VERIFICATION QUERIES (run before or after migration; expect 0 rows)
-- ----------------------------------------------------------------------------
-- (1) Duplicate (source_table, source_id) — expect 0 rows:
--   SELECT source_table, source_id, COUNT(*) AS n
--   FROM items
--   GROUP BY source_table, source_id
--   HAVING COUNT(*) > 1;
--
-- (2) Service items with track_stock = true — expect 0 rows:
--   SELECT id, business_id, name, type, track_stock, source_table, source_id
--   FROM items
--   WHERE type = 'service' AND track_stock = true;
