-- ============================================================================
-- RUN IN: The live DB the app actually hits (Supabase SQL Editor or psql).
-- Paste full output for Cursor to classify root cause A/B/C/D.
-- ============================================================================

-- STEP 1.1 — List columns on accounting_firms
SELECT 'STEP 1.1 columns' AS check_name;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'accounting_firms'
ORDER BY ordinal_position;

-- STEP 1.2 — Table OID
SELECT 'STEP 1.2 oid' AS check_name;
SELECT 'public.accounting_firms'::regclass::oid AS accounting_firms_oid;

-- STEP 1.3 — Schema/table (no accidental wrong schema)
SELECT 'STEP 1.3 tables named accounting_firms' AS check_name;
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name = 'accounting_firms'
ORDER BY table_schema;

-- STEP 2.A — Migration table exists?
SELECT 'STEP 2.A migration regclass' AS check_name;
SELECT to_regclass('supabase_migrations.schema_migrations') AS reg;

-- STEP 2.B — Any migration-like tables
SELECT 'STEP 2.B migration-like tables' AS check_name;
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name ILIKE '%migrat%'
ORDER BY table_schema, table_name;

-- STEP 2.C — Last 50 applied (if table exists)
SELECT 'STEP 2.C last 50 migrations' AS check_name;
SELECT *
FROM supabase_migrations.schema_migrations
ORDER BY inserted_at DESC
LIMIT 50;

-- STEP 2.C — 275 / 282 specifically
SELECT 'STEP 2.C 275 and 282' AS check_name;
SELECT *
FROM supabase_migrations.schema_migrations
WHERE version ILIKE '%275%' OR version ILIKE '%282%'
ORDER BY inserted_at DESC;
