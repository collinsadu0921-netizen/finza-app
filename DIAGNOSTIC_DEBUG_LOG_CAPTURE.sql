-- ============================================================================
-- DIAGNOSTIC: Debug Log Capture & Verification
-- ============================================================================
-- Purpose: Verify debug logging is working and capture journal_lines JSONB
-- ============================================================================

-- ============================================================================
-- STEP 1: Verify Debug Log Table Exists and Has Data
-- ============================================================================

-- Check if table exists and count records
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'retail_posting_debug_log') 
    THEN 'EXISTS' 
    ELSE 'MISSING' 
  END AS table_status,
  COALESCE((SELECT COUNT(*) FROM retail_posting_debug_log), 0) AS total_records,
  COALESCE((SELECT COUNT(*) FROM retail_posting_debug_log WHERE created_at >= NOW() - INTERVAL '1 hour'), 0) AS recent_records;

-- ============================================================================
-- STEP 2: Check Most Recent Debug Log Entries
-- ============================================================================

SELECT
  id,
  created_at,
  sale_id,
  business_id,
  gross_total,
  net_total,
  total_tax_amount,
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  tax_shape,
  CASE 
    WHEN journal_lines IS NULL THEN 'NULL'
    WHEN jsonb_typeof(journal_lines) = 'array' THEN 'array (' || jsonb_array_length(journal_lines)::text || ' items)'
    ELSE jsonb_typeof(journal_lines)::text
  END AS journal_lines_status,
  note
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================================
-- STEP 3: Get journal_lines JSONB for Most Recent Failed Tests
-- ============================================================================

-- Get the actual journal_lines JSONB payloads
SELECT
  id,
  created_at,
  sale_id,
  journal_lines,
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  tax_shape,
  -- Break down each line for analysis
  jsonb_array_elements(journal_lines) AS line_item
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '2 hours'
  AND journal_lines IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;

-- ============================================================================
-- STEP 4: Extract journal_lines by Test Pattern (if sale descriptions match)
-- ============================================================================

-- Try to find TEST A, B, C entries if they have identifiable descriptions
-- This will match if test sales have descriptions like "TEST A:", "TEST B:", etc.
SELECT
  d.id,
  d.created_at,
  d.sale_id,
  s.description AS sale_description,
  d.journal_lines,
  d.line_count,
  d.debit_sum,
  d.credit_sum,
  d.credit_count,
  d.tax_shape
FROM retail_posting_debug_log d
LEFT JOIN sales s ON s.id = d.sale_id
WHERE d.created_at >= NOW() - INTERVAL '2 hours'
  AND d.journal_lines IS NOT NULL
  AND (s.description LIKE '%TEST A%' 
       OR s.description LIKE '%TEST B%' 
       OR s.description LIKE '%TEST C%'
       OR s.description LIKE '%Canonical%'
       OR s.description LIKE '%Parsed tax_lines%'
       OR s.description LIKE '%NULL tax_lines%')
ORDER BY d.created_at DESC;

-- ============================================================================
-- STEP 5: Detailed Line-by-Line Breakdown for Most Recent Entry
-- ============================================================================

-- Get detailed breakdown of most recent journal_lines
WITH latest_log AS (
  SELECT 
    id,
    sale_id,
    journal_lines,
    created_at
  FROM retail_posting_debug_log
  WHERE created_at >= NOW() - INTERVAL '2 hours'
    AND journal_lines IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  l.id AS log_id,
  l.sale_id,
  l.created_at,
  line_idx.idx AS line_number,
  line_idx.line->>'account_id' AS account_id,
  line_idx.line->>'debit' AS debit,
  line_idx.line->>'credit' AS credit,
  line_idx.line->>'description' AS description,
  CASE 
    WHEN (line_idx.line->>'debit') IS NOT NULL AND (line_idx.line->>'debit')::numeric > 0 THEN 'DEBIT'
    WHEN (line_idx.line->>'credit') IS NOT NULL AND (line_idx.line->>'credit')::numeric > 0 THEN 'CREDIT'
    ELSE 'EMPTY'
  END AS line_type
FROM latest_log l
CROSS JOIN LATERAL jsonb_array_elements(l.journal_lines) WITH ORDINALITY AS line_idx(line, idx)
ORDER BY line_idx.idx;

-- ============================================================================
-- STEP 6: Verify Debug Logging is Being Called (Check Function Definition)
-- ============================================================================

-- Check if current post_sale_to_ledger has debug logging
SELECT
  p.oid,
  p.proname,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.retail_posting_debug_log%' THEN '✅ HAS DEBUG LOGGING'
    ELSE '❌ NO DEBUG LOGGING'
  END AS logging_status,
  CASE
    WHEN pg_get_functiondef(p.oid) LIKE '%retail_posting_debug_log%' THEN 'YES'
    ELSE 'NO'
  END AS mentions_debug_log
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC
LIMIT 1;

-- ============================================================================
-- STEP 7: Manual journal_lines Extraction for Specific Sale IDs
-- ============================================================================
-- Run this after TEST A/B/C to get exact payloads
-- Replace SALE_ID_PLACEHOLDER with actual sale IDs from test failures

/*
SELECT
  d.id,
  d.created_at,
  d.sale_id,
  d.journal_lines,
  d.line_count,
  d.debit_sum,
  d.credit_sum,
  d.credit_count,
  -- Full JSONB payload (for copy/paste)
  d.journal_lines::text AS journal_lines_text
FROM retail_posting_debug_log d
WHERE d.sale_id IN (
  'SALE_ID_PLACEHOLDER'  -- Replace with actual sale_id from test
)
ORDER BY d.created_at DESC;
*/
